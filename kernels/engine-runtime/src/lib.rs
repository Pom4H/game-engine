//! Rust migration data plane, ABI v1. This is a batch-kernel runtime, NOT yet
//! a replacement for Scene, the structural/contact owner, audio or the renderer.
//! No JavaScript imports, per-element FFI, JSON, or allocations in execute().
//! One Wasm instance belongs to one worker. All writable buffers are borrowed;
//! callers must reacquire views after creation/disposal can grow/reuse memory.

pub mod geometry;
pub mod wheel;
use std::cell::{Cell, RefCell};

pub const ABI: u32 = 1;
pub const WHEELS: u32 = 1;
pub const HINGES: u32 = 2;
pub const SKIN: u32 = 4;
pub const DENTS: u32 = 8;
pub const NORMALS: u32 = 16;
pub const PACK: u32 = 32;
const ALL: u32 = WHEELS|HINGES|SKIN|DENTS|NORMALS|PACK;
const MAX_HANDLES: usize = 128;
const MAX_BYTES: usize = 128*1024*1024;
const MAX_GENERATION: u32 = 0x00ff_ffff;
const INVALID_HANDLE: u32 = 1;
const INVALID_ARGUMENT: u32 = 2;
const INVALID_BUFFER: u32 = 3;
const CAPACITY: u32 = 4;
const BUSY: u32 = 5;
const INVALID_FLAGS: u32 = 6;

thread_local! {
    static REGISTRY: RefCell<Registry> = RefCell::new(Registry::default());
    static LAST_ERROR: Cell<u32> = const {Cell::new(0)};
}
fn error(code: u32) -> u32 {LAST_ERROR.with(|e|e.set(code));code}
fn success() {LAST_ERROR.with(|e|e.set(0));}

#[derive(Clone, Copy, Debug)]
struct Config {wheels:usize,nodes:usize,hinges:usize,vertices:usize,influences:usize,triangles:usize,dents:usize}
impl Config {
    fn valid(self)->bool {
        self.wheels<=16384 && self.nodes<=65535 && self.hinges<=262144 &&
        self.vertices<=1_000_000 && self.triangles<=2_000_000 && self.dents<=1024 &&
        self.influences<=8 && (self.hinges==0 || self.nodes>0) &&
        (self.vertices==0 || self.nodes>0 && self.influences>0) &&
        (self.triangles==0 || self.vertices>0)
    }
    fn bytes(self)->Option<usize> {
        // Bounds above keep each product representable even on wasm32.
        let f64s=self.wheels*(wheel::INPUT_STRIDE+wheel::OUTPUT_STRIDE)+self.nodes*6+
            self.hinges*13+self.vertices*(9+self.influences)+self.dents*geometry::DENT_STRIDE;
        let u32s=self.hinges*4+self.vertices*self.influences+self.triangles*3;
        f64s.checked_mul(8)?.checked_add(u32s.checked_mul(4)?)?.checked_add(self.vertices.checked_mul(24)?)
    }
}
fn zeros<T: Default+Clone>(n:usize)->Result<Vec<T>,u32> {
    let mut v=Vec::new();v.try_reserve_exact(n).map_err(|_|CAPACITY)?;
    v.resize(n,T::default());Ok(v)
}
struct Batch {
    config:Config, bytes:usize,
    wheel_input:Vec<f64>,wheel_output:Vec<f64>,position:Vec<f64>,hinges:Vec<u32>,
    angles:Vec<f64>,gradients:Vec<f64>,skin_rest:Vec<f64>,node_rest:Vec<f64>,
    skin_nodes:Vec<u32>,skin_weights:Vec<f64>,skin_position:Vec<f64>,
    triangles:Vec<u32>,normals:Vec<f64>,dents:Vec<f64>,packed:Vec<f32>,
}
impl Batch {
    fn new(c:Config,bytes:usize)->Result<Self,u32> {
        Ok(Self {config:c,bytes,wheel_input:zeros(c.wheels*wheel::INPUT_STRIDE)?,
            wheel_output:zeros(c.wheels*wheel::OUTPUT_STRIDE)?,position:zeros(c.nodes*3)?,
            hinges:zeros(c.hinges*4)?,angles:zeros(c.hinges)?,gradients:zeros(c.hinges*12)?,
            skin_rest:zeros(c.vertices*3)?,node_rest:zeros(c.nodes*3)?,
            skin_nodes:zeros(c.vertices*c.influences)?,skin_weights:zeros(c.vertices*c.influences)?,
            skin_position:zeros(c.vertices*3)?,triangles:zeros(c.triangles*3)?,
            normals:zeros(c.vertices*3)?,dents:zeros(c.dents*geometry::DENT_STRIDE)?,packed:zeros(c.vertices*6)?})
    }
    /// No unchecked indexing across the FFI boundary: validate every relevant
    /// input before writing ANY output. JS can modify topology after creation.
    fn validate(&self,flags:u32)->Result<(),u32> {
        if flags&!ALL!=0 || flags&(DENTS|NORMALS|PACK)!=0 && flags&SKIN==0 ||
            flags&PACK!=0 && flags&NORMALS==0 {return Err(INVALID_FLAGS);}
        let finite=|a:&[f64]|a.iter().all(|x|x.is_finite() && x.abs()<=1e12);
        if flags&WHEELS!=0 {
            if !finite(&self.wheel_input) {return Err(INVALID_BUFFER);}
            for w in self.wheel_input.chunks_exact(wheel::INPUT_STRIDE) {
                if w[0]<=0.0 || w[0]>1.0/30.0 || w[1]<=0.0 || w[2]<=0.0 || w[6]<0.0 ||
                    w[8]<0.0 || w[9]<0.0 || w[12]<0.0 || w[12]>1.0 || w[13]<0.0 || w[14]<0.0 {
                    return Err(INVALID_BUFFER);
                }
            }
        }
        if flags&(HINGES|SKIN)!=0 && !finite(&self.position) {return Err(INVALID_BUFFER);}
        if flags&HINGES!=0 && self.hinges.iter().any(|&n|n as usize>=self.config.nodes) {return Err(INVALID_BUFFER);}
        if flags&SKIN!=0 && (!finite(&self.skin_rest) || !finite(&self.node_rest) ||
            !self.skin_weights.iter().all(|w|w.is_finite() && *w>=0.0 && *w<=1.0) ||
            self.skin_nodes.iter().any(|&n|n as usize>=self.config.nodes)) {return Err(INVALID_BUFFER);}
        if flags&DENTS!=0 {
            if !finite(&self.dents) {return Err(INVALID_BUFFER);}
            for d in self.dents.chunks_exact(geometry::DENT_STRIDE) {
                let n=d[3]*d[3]+d[4]*d[4]+d[5]*d[5];
                if d[6]<=0.0 || (n-1.0).abs()>1e-6 || d[8]!=0.0 && d[8]!=1.0 {return Err(INVALID_BUFFER);}
            }
        }
        if flags&NORMALS!=0 && self.triangles.iter().any(|&n|n as usize>=self.config.vertices) {return Err(INVALID_BUFFER);}
        Ok(())
    }
    fn execute(&mut self,flags:u32)->Result<(),u32> {
        self.validate(flags)?;
        if flags&WHEELS!=0 {
            for (input,out) in self.wheel_input.chunks_exact(wheel::INPUT_STRIDE)
                .zip(self.wheel_output.chunks_exact_mut(wheel::OUTPUT_STRIDE)) {wheel::solve(input,out);}
        }
        if flags&HINGES!=0 {
            for ((ids,angle),g) in self.hinges.chunks_exact(4).zip(self.angles.iter_mut())
                .zip(self.gradients.chunks_exact_mut(12)) {
                *angle=geometry::dihedral(&self.position,ids,g).unwrap_or(f64::NAN);
            }
        }
        if flags&SKIN!=0 {geometry::skin(&self.skin_rest,&self.node_rest,&self.position,
            &self.skin_nodes,&self.skin_weights,self.config.influences,&mut self.skin_position);}
        if flags&DENTS!=0 {geometry::dents(&mut self.skin_position,&self.dents);}
        if flags&NORMALS!=0 {geometry::normals(&self.skin_position,&self.triangles,&mut self.normals);}
        if flags&PACK!=0 {geometry::pack(&self.skin_position,&self.normals,&mut self.packed);}
        Ok(())
    }
    fn field(&self,id:u32)->Option<(usize,usize,u32)> {
        macro_rules! field {($name:ident,$kind:expr)=>{Some((self.$name.as_ptr() as usize,self.$name.len(),$kind))};}
        match id {
            1=>field!(wheel_input,1),2=>field!(wheel_output,1),3=>field!(position,1),
            4=>field!(hinges,2),5=>field!(angles,1),6=>field!(gradients,1),
            7=>field!(skin_rest,1),8=>field!(node_rest,1),9=>field!(skin_nodes,2),
            10=>field!(skin_weights,1),11=>field!(skin_position,1),12=>field!(triangles,2),
            13=>field!(normals,1),14=>field!(dents,1),15=>field!(packed,3),_=>None,
        }
    }
}
struct Slot {generation:u32,batch:Option<Batch>}
#[derive(Default)]
struct Registry {slots:Vec<Slot>,bytes:usize,live:usize}
impl Registry {
    fn slot(&self,handle:u32)->Option<usize> {
        let raw=(handle&255) as usize;
        if raw==0 {return None;}
        let i=raw-1;let slot=self.slots.get(i)?;
        (slot.generation==handle>>8 && slot.batch.is_some()).then_some(i)
    }
    fn create(&mut self,c:Config)->Result<u32,u32> {
        if !c.valid() {return Err(INVALID_ARGUMENT);}
        let bytes=c.bytes().ok_or(CAPACITY)?;
        if bytes>MAX_BYTES || self.bytes>MAX_BYTES-bytes || self.live==MAX_HANDLES {return Err(CAPACITY);}
        let reuse=self.slots.iter().position(|s|s.batch.is_none() && s.generation<MAX_GENERATION);
        if reuse.is_none() && self.slots.len()==MAX_HANDLES {return Err(CAPACITY);}
        let batch=Batch::new(c,bytes)?;
        let i=if let Some(i)=reuse {self.slots[i].batch=Some(batch);i} else {
            self.slots.try_reserve(1).map_err(|_|CAPACITY)?;
            self.slots.push(Slot {generation:1,batch:Some(batch)});self.slots.len()-1
        };
        self.bytes+=bytes;self.live+=1;
        Ok((self.slots[i].generation<<8)|(i as u32+1))
    }
    fn free(&mut self,handle:u32)->Result<(),u32> {
        let i=self.slot(handle).ok_or(INVALID_HANDLE)?;
        let s=&mut self.slots[i];let b=s.batch.take().ok_or(INVALID_HANDLE)?;
        self.bytes-=b.bytes;self.live-=1;
        // Never wrap a generation and accidentally revive an old handle.
        if s.generation<MAX_GENERATION {s.generation+=1;}
        Ok(())
    }
}
fn access<T:Default>(f:impl FnOnce(&mut Registry)->Result<T,u32>)->T {
    REGISTRY.with(|r|match r.try_borrow_mut() {
        Ok(mut registry)=>match f(&mut registry) {Ok(v)=>{success();v},Err(e)=>{error(e);T::default()}},
        Err(_)=>{error(BUSY);T::default()},
    })
}

#[no_mangle] pub extern "C" fn rom4_abi_version()->u32 {ABI}
#[no_mangle] pub extern "C" fn rom4_last_error()->u32 {LAST_ERROR.with(Cell::get)}
#[no_mangle] pub extern "C" fn rom4_create(wheels:u32,nodes:u32,hinges:u32,vertices:u32,
    influences:u32,triangles:u32,dents:u32)->u32 {
    access(|r|r.create(Config {wheels:wheels as usize,nodes:nodes as usize,hinges:hinges as usize,
        vertices:vertices as usize,influences:influences as usize,triangles:triangles as usize,dents:dents as usize}))
}
/// Return 1 on success; zero on failure (read last_error immediately).
#[no_mangle] pub extern "C" fn rom4_free(handle:u32)->u32 {access(|r|{r.free(handle)?;Ok(1)})}
#[no_mangle] pub extern "C" fn rom4_execute(handle:u32,flags:u32)->u32 {
    access(|r|{let i=r.slot(handle).ok_or(INVALID_HANDLE)?;
        r.slots[i].batch.as_mut().ok_or(INVALID_HANDLE)?.execute(flags)?;Ok(1)})
}
fn field(handle:u32,id:u32)->Option<(usize,usize,u32)> {
    access(|r|{let i=r.slot(handle).ok_or(INVALID_HANDLE)?;
        Ok(Some(r.slots[i].batch.as_ref().ok_or(INVALID_HANDLE)?.field(id).ok_or(INVALID_ARGUMENT)?))})
}
#[no_mangle] pub extern "C" fn rom4_field_ptr(handle:u32,id:u32)->usize {field(handle,id).map_or(0,|f|f.0)}
#[no_mangle] pub extern "C" fn rom4_field_len(handle:u32,id:u32)->usize {field(handle,id).map_or(0,|f|f.1)}
#[no_mangle] pub extern "C" fn rom4_field_kind(handle:u32,id:u32)->u32 {field(handle,id).map_or(0,|f|f.2)}
#[no_mangle] pub extern "C" fn rom4_live_handles()->usize {access(|r|Ok(r.live))}
#[no_mangle] pub extern "C" fn rom4_live_bytes()->usize {access(|r|Ok(r.bytes))}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty()->Config {Config {wheels:0,nodes:0,hinges:0,vertices:0,influences:0,triangles:0,dents:0}}
    #[test] fn handles_reject_double_free_and_stale_generation() {
        let mut r=Registry::default();let a=r.create(empty()).unwrap();r.free(a).unwrap();
        assert_eq!(r.free(a),Err(INVALID_HANDLE));let b=r.create(empty()).unwrap();
        assert_ne!(a,b);assert_eq!(r.slot(a),None);r.free(b).unwrap();assert_eq!(r.live,0);assert_eq!(r.bytes,0);
    }
    #[test] fn capacity_rejection_does_not_mutate_registry() {
        let mut r=Registry::default();let mut c=empty();c.nodes=1;c.vertices=1_000_000;c.influences=8;
        assert_eq!(r.create(c),Err(CAPACITY));assert_eq!(r.live,0);assert_eq!(r.bytes,0);
    }
    #[test] fn invalid_later_input_does_not_partially_commit_output() {
        let mut c=empty();c.wheels=2;let mut b=Batch::new(c,c.bytes().unwrap()).unwrap();
        b.wheel_output.fill(42.0);b.wheel_input[0]=1.0/120.0;b.wheel_input[1]=0.3;b.wheel_input[2]=1.0;
        assert_eq!(b.execute(WHEELS),Err(INVALID_BUFFER));assert!(b.wheel_output.iter().all(|&v|v==42.0));
    }
    #[test] fn step_cannot_accumulate_projection_dents_without_reskinning() {
        let c=empty();let mut b=Batch::new(c,0).unwrap();assert_eq!(b.execute(DENTS),Err(INVALID_FLAGS));
        assert_eq!(b.execute(SKIN|PACK),Err(INVALID_FLAGS));
    }
    #[test] fn all_mutable_indices_are_checked_before_geometry_runs() {
        let mut c=empty();c.nodes=4;c.hinges=1;
        let mut b=Batch::new(c,c.bytes().unwrap()).unwrap();b.angles[0]=9.0;b.hinges[3]=u32::MAX;
        assert_eq!(b.execute(HINGES),Err(INVALID_BUFFER));assert_eq!(b.angles[0],9.0);
    }
    #[test] fn successful_execution_does_not_move_or_resize_buffers() {
        let mut c=empty();c.nodes=4;c.hinges=1;
        let mut b=Batch::new(c,c.bytes().unwrap()).unwrap();b.hinges.copy_from_slice(&[0,1,2,3]);
        b.position.copy_from_slice(&[-0.5,0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.1,0.0,-1.0,0.2]);
        let ptr=b.gradients.as_ptr();let capacity=b.gradients.capacity();
        for _ in 0..1000 {b.execute(HINGES).unwrap();}
        assert_eq!(b.gradients.as_ptr(),ptr);assert_eq!(b.gradients.capacity(),capacity);assert!(b.angles[0].is_finite());
    }
}
