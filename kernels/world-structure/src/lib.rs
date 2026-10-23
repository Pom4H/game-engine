//! Active XPBD structural solver for the engine.
//! State is owned by a single Wasm instance and shared as TypedArray views with
//! StructuralBody. No per-tick array marshalling. F64, fixed constraint order.
//! Keep parity with src/physics/structure.ts and the older C-Wasm experiment.
#[cfg(feature="simd-distance")]
mod distance_batch;
#[cfg(all(test,feature="simd-distance"))]
mod distance_batch_tests;

#[cfg(target_arch="wasm32")]
mod host {
    #[link(wasm_import_module="math")]
    extern "C" {
        #[link_name="hypot"] fn hypot3(x:f64,y:f64,z:f64)->f64;
        #[link_name="exp"] fn exp(x:f64)->f64;
        #[link_name="pow"] fn pow(x:f64,y:f64)->f64;
    }
    #[inline] pub fn norm(x:f64,y:f64,z:f64)->f64{unsafe{hypot3(x,y,z)}}
    #[inline] pub fn exponential(x:f64)->f64{unsafe{exp(x)}}
    #[inline] pub fn power(x:f64,y:f64)->f64{unsafe{pow(x,y)}}
}
#[cfg(not(target_arch="wasm32"))]
mod host {
    pub fn norm(x:f64,y:f64,z:f64)->f64{(x*x+y*y+z*z).sqrt()}
    pub fn exponential(x:f64)->f64{x.exp()}
    pub fn power(x:f64,y:f64)->f64{x.powf(y)}
}

const POSITION:usize=0;
const PREVIOUS:usize=1;
const VELOCITY:usize=2;
const FORCE:usize=3;
const MASS:usize=4;
const INVERSE:usize=5;
const ORIGINAL_POSITION:usize=6;
const ORIGINAL_REST:usize=7;
const REST:usize=8;
const COMPLIANCE:usize=9;
const YIELD_LIMIT:usize=10;
const BREAK_LIMIT:usize=11;
const PLASTICITY:usize=12;
const YIELD_FORCE:usize=13;
const LAMBDA:usize=14;
const PREDICTED:usize=15;
const IMPULSE_WEIGHTS:usize=16;

#[derive(Clone,Copy)]
struct V { x:f64,y:f64,z:f64 }
impl V {
    fn sub(self,rhs:Self)->Self{Self{x:self.x-rhs.x,y:self.y-rhs.y,z:self.z-rhs.z}}
    fn cross(self,b:Self)->Self{Self{x:self.y*b.z-self.z*b.y,y:self.z*b.x-self.x*b.z,z:self.x*b.y-self.y*b.x}}
    fn dot(self,b:Self)->f64{self.x*b.x+self.y*b.y+self.z*b.z}
    fn scale(self,a:f64)->Self{Self{x:self.x*a,y:self.y*a,z:self.z*a}}
}
fn point(p:&[f64],i:usize)->V{let j=i*3;V{x:p[j],y:p[j+1],z:p[j+2]}}
fn gradients(p:&[f64],a:usize,b:usize,c:usize,d:usize)->([V;4],f64){
    let aa=point(p,a);let bb=point(p,b);let cc=point(p,c);let dd=point(p,d);
    let gb=cc.sub(aa).cross(dd.sub(aa)).scale(1.0/6.0);
    let gc=dd.sub(aa).cross(bb.sub(aa)).scale(1.0/6.0);
    let gd=bb.sub(aa).cross(cc.sub(aa)).scale(1.0/6.0);
    let ga=V{x:-gb.x-gc.x-gd.x,y:-gb.y-gc.y-gd.y,z:-gb.z-gc.z-gd.z};
    let volume=bb.sub(aa).dot(cc.sub(aa).cross(dd.sub(aa)))/6.0;
    ([ga,gb,gc,gd],volume)
}
#[inline]
fn apply(p:&mut [f64],inverse:&[f64],i:usize,g:V,dl:f64){
    let j=i*3;let scale=inverse[i]*dl;
    p[j]+=g.x*scale;p[j+1]+=g.y*scale;p[j+2]+=g.z*scale;
}
#[inline]
fn volume(p:&[f64],a:usize,b:usize,c:usize,d:usize)->f64{
    let origin=point(p,a);
    point(p,b).sub(origin).dot(point(p,c).sub(origin).cross(point(p,d).sub(origin)))/6.0
}

// Public ABI tags match src/physics/structure-wasm.ts.
#[derive(Clone,Copy)]
struct StaticBox{center:[f64;3],half:[f64;3]}
#[derive(Clone,Copy)]
struct Binding{nodes:[usize;3],weights:[f64;3],count:usize}
/// The identical position projection used by StructuralStaticContactSolver.
/// Both collision samples and static boxes are precompiled, outside the tick.
fn project_static(
    p:&mut [f64],previous:&[f64],inverse:&[f64],boxes:&[StaticBox],
    bindings:&[Binding],stats:&mut [f64;7],
){
    for binding in bindings{
        let mut point=[0.0;3];let mut prior=[0.0;3];
        for i in 0..binding.count{
            let j=binding.nodes[i]*3;let weight=binding.weights[i];
            for axis in 0..3{
                point[axis]+=p[j+axis]*weight;
                prior[axis]+=previous[j+axis]*weight;
            }
        }
        for (box_index,b) in boxes.iter().enumerate(){
            let local=[
                point[0]-b.center[0],point[1]-b.center[1],point[2]-b.center[2]
            ];
            if (0..3).any(|axis|local[axis].abs()>b.half[axis]){continue;}
            let mut crossed=None;
            for axis in 0..3{
                let before=prior[axis]-b.center[axis];
                if before>b.half[axis]&&local[axis]<=b.half[axis]{
                    crossed=Some((axis,1.0));break;
                }
                if before< -b.half[axis]&&local[axis]>= -b.half[axis]{
                    crossed=Some((axis,-1.0));break;
                }
            }
            let (axis,sign)=if let Some(crossed)=crossed{crossed}else{
                let gap=[
                    b.half[0]-local[0].abs(),
                    b.half[1]-local[1].abs(),
                    b.half[2]-local[2].abs(),
                ];
                let axis=if gap[0]<=gap[1]&&gap[0]<=gap[2]{0}
                    else if gap[1]<=gap[2]{1}else{2};
                (axis,if local[axis]>=0.0{1.0}else{-1.0})
            };
            let face=b.center[axis]+sign*b.half[axis];
            let penetration=(face-point[axis]).abs().max(0.0);
            let mut effective=0.0;
            for i in 0..binding.count{
                let weight=binding.weights[i];
                effective+=weight*weight*inverse[binding.nodes[i]];
            }
            if effective<=1e-14{continue;}
            let lambda=penetration/effective;
            for i in 0..binding.count{
                let node=binding.nodes[i];let j=node*3;
                let scale=inverse[node]*binding.weights[i]*lambda;
                p[j+axis]+=sign*scale;
            }
            stats[0]+=1.0;stats[2]+=1.0;
            if penetration>stats[1]{
                stats[1]=penetration;
                stats[3]=box_index as f64;
                stats[4]=point[0];stats[5]=point[1];stats[6]=point[2];
            }
        }
    }
}

const N_FIELDS:usize=23;
pub struct Structure {
    #[cfg(feature="simd-distance")]
    distance_simd:bool,
    n:usize,m:usize,
    floats:Vec<Vec<f64>>,kind:Vec<u8>,ia:Vec<u16>,ib:Vec<u16>,ic:Vec<u16>,id:Vec<u16>,broken:Vec<u8>,
    /// [plasticWorkJ, quietTimeSeconds, steps].
    scalars:[f64;3],
    boxes:Vec<StaticBox>,bindings:Vec<Binding>,sampled_nodes:Vec<bool>,
    /// [contact count, maximum penetration, projected samples, deepest box index,
    ///  deepest point xyz]; index -1 means no deepest box.
    contact_stats:[f64;7],
}
impl Structure {
    fn new(n:usize,m:usize)->Option<Self>{
        if !(2..=2048).contains(&n)||!(1..=16384).contains(&m){return None;}
        let lengths=[n*3,n*3,n*3,n*3,n,n,n*3,m,m,m,m,m,m,m,m,m,n];
        Some(Self{
            #[cfg(feature="simd-distance")]
            distance_simd:true,
            n,m,
            floats:lengths.iter().map(|len|vec![0.0;*len]).collect(),
            kind:vec![0;m],ia:vec![0;m],ib:vec![0;m],ic:vec![0;m],id:vec![0;m],broken:vec![0;m],
            scalars:[0.0;3],boxes:Vec::new(),bindings:Vec::new(),
            sampled_nodes:vec![false;n],contact_stats:[0.,0.,0.,-1.,0.,0.,0.],
        })
    }
    fn add_box(&mut self,center:[f64;3],half:[f64;3])->bool{
        if self.boxes.len()>=1024 ||!center.iter().chain(half.iter()).all(|x|x.is_finite())
          ||half.iter().any(|x|*x<=0.0){return false;}
        self.boxes.push(StaticBox{center,half});true
    }
    fn add_triangle(&mut self,a:usize,b:usize,c:usize)->bool{
        if self.bindings.len()>=16384||a>=self.n||b>=self.n||c>=self.n||a==b||a==c||b==c{return false;}
        self.bindings.push(Binding{nodes:[a,b,c],weights:[1.0/3.0;3],count:3});
        self.sampled_nodes[a]=true;self.sampled_nodes[b]=true;self.sampled_nodes[c]=true;
        true
    }
    fn finish_contacts(&mut self){
        for node in 0..self.n{
            if self.sampled_nodes[node]{
                self.bindings.push(Binding{nodes:[node,0,0],weights:[1.0,0.0,0.0],count:1});
            }
        }
    }
    fn f64_field(&mut self,kind:usize)->*mut f64{self.floats[kind].as_mut_ptr()}
    fn ptr(&mut self,kind:usize)->u32{
        match kind {
            0..=6=>self.f64_field(kind) as usize as u32,
            7=>self.kind.as_mut_ptr() as usize as u32,
            8=>self.ia.as_mut_ptr() as usize as u32,
            9=>self.ib.as_mut_ptr() as usize as u32,
            10=>self.ic.as_mut_ptr() as usize as u32,
            11=>self.id.as_mut_ptr() as usize as u32,
            12..=21=>self.f64_field(kind-5) as usize as u32,
            22=>self.broken.as_mut_ptr() as usize as u32,
            _=>0,
        }
    }
    fn step(&mut self,iterations:usize,dt:f64,gravity:V,damping:f64,thermal:f64,sleep_speed:f64,sleep_delay:f64,contact:bool)->u32{
        let [p,prev,v,force,_mass,inverse,_original_position,original,rest,compliance,yield_limit,
        break_limit,plasticity,yield_force,lambda,predicted,_impulse_weights]=self.floats.as_mut_slice() else{unreachable!()};
        let kind=&self.kind;let ia=&self.ia;let ib=&self.ib;let ic=&self.ic;let id=&self.id;let broken=&mut self.broken;
        let n=self.n;let m=self.m;
        prev.copy_from_slice(p);
        for i in 0..n{
            let j=i*3;let w=inverse[i];
            v[j]+=dt*(gravity.x+force[j]*w);
            v[j+1]+=dt*(gravity.y+force[j+1]*w);
            v[j+2]+=dt*(gravity.z+force[j+2]*w);
            p[j]+=dt*v[j];p[j+1]+=dt*v[j+1];p[j+2]+=dt*v[j+2];
            force[j]=0.0;force[j+1]=0.0;force[j+2]=0.0;
        }
        // Contact projector runs before strain capture and after each iteration,
        // in exactly the order of the TS implementation.
        if contact{project_static(p,prev,inverse,&self.boxes,&self.bindings,&mut self.contact_stats);}
        for i in 0..m{
            lambda[i]=0.0;
            if broken[i]!=0{continue;}
            let a=ia[i] as usize;let b=ib[i] as usize;
            if kind[i]==0{
                let aa=a*3;let bb=b*3;
                predicted[i]=host::norm(p[bb]-p[aa],p[bb+1]-p[aa+1],p[bb+2]-p[aa+2]);
            }else{
                predicted[i]=volume(p,a,b,ic[i] as usize,id[i] as usize);
            }
        }
        let thermal_cubed=host::power(thermal,3.0);
        for iteration in 0..iterations{
            #[cfg(feature="simd-distance")]
            let mut paired_until=0;
            for i in 0..m{
                #[cfg(feature="simd-distance")]
                {
                    if i<paired_until{continue;}
                    if self.distance_simd && distance_batch::try_solve_pair(
                        i,p,inverse,kind,ia,ib,broken,rest,compliance,lambda,dt,thermal,
                    ){
                        paired_until=i+2;
                        continue;
                    }
                }
                if broken[i]!=0{continue;}
                let a=ia[i] as usize;let b=ib[i] as usize;
                let alpha=compliance[i]/(dt*dt);
                if kind[i]==0{
                    let aa=a*3;let bb=b*3;
                    let dx=p[bb]-p[aa];let dy=p[bb+1]-p[aa+1];let dz=p[bb+2]-p[aa+2];
                    let length=host::norm(dx,dy,dz);if length<1e-10{continue;}
                    let nx=dx/length;let ny=dy/length;let nz=dz/length;
                    let c=length-rest[i]*thermal;
                    let denom=inverse[a]+inverse[b]+alpha;if denom<=1e-14{continue;}
                    let dl=(-c-alpha*lambda[i])/denom;lambda[i]+=dl;
                    let wa=inverse[a]*dl;let wb=inverse[b]*dl;
                    p[aa]-=nx*wa;p[aa+1]-=ny*wa;p[aa+2]-=nz*wa;
                    p[bb]+=nx*wb;p[bb+1]+=ny*wb;p[bb+2]+=nz*wb;
                }else{
                    let c=ic[i] as usize;let d=id[i] as usize;
                    let (g,vol)=gradients(p,a,b,c,d);
                    let constraint=vol-rest[i]*thermal_cubed;
                    let denom=inverse[a]*g[0].dot(g[0])+inverse[b]*g[1].dot(g[1])
                             +inverse[c]*g[2].dot(g[2])+inverse[d]*g[3].dot(g[3])+alpha;
                    if denom<=1e-14{continue;}
                    let dl=(-constraint-alpha*lambda[i])/denom;lambda[i]+=dl;
                    apply(p,inverse,a,g[0],dl);apply(p,inverse,b,g[1],dl);
                    apply(p,inverse,c,g[2],dl);apply(p,inverse,d,g[3],dl);
                }
            }
            if contact{let _=iteration;project_static(p,prev,inverse,&self.boxes,&self.bindings,&mut self.contact_stats);}
        }
        let inv_dt=1.0/dt;
        for i in 0..n*3{v[i]=(p[i]-prev[i])*inv_dt;}
        for i in 0..m{
            if broken[i]!=0{continue;}
            let thermal_power=if kind[i]==0{thermal}else{thermal_cubed};
            let effective_original=original[i]*thermal_power;
            let effective_rest=rest[i]*thermal_power;
            let divisor=(if kind[i]==0{1e-9_f64}else{1e-12_f64}).max(effective_original.abs());
            let trial_strain=(predicted[i]-effective_rest)/divisor;
            let original_strain=(predicted[i]-effective_original)/divisor;
            if original_strain.abs()>break_limit[i]{broken[i]=1;continue;}
            if trial_strain.abs()>yield_limit[i]&&plasticity[i]>0.0{
                let sign=if trial_strain>0.0{1.0}else if trial_strain<0.0{-1.0}else{0.0};
                let elastic=sign*yield_limit[i]*effective_original.abs();
                let target_effective=predicted[i]-elastic;
                let target_base=target_effective/thermal_power;
                let delta=(target_base-rest[i])*plasticity[i];
                if kind[i]==0{
                    if delta.abs()>1e-12{
                        rest[i]=(original[i].abs()*0.04).max(rest[i]+delta);
                        self.scalars[0]+=(delta*thermal_power).abs()*yield_force[i];
                    }
                }else if delta.abs()>1e-15{rest[i]+=delta;}
            }
        }
        if damping>0.0{
            let gain=1.0-host::exponential(-damping*dt);
            for i in 0..m{
                if broken[i]!=0||kind[i]!=0{continue;}
                let a=ia[i] as usize;let b=ib[i] as usize;let aa=a*3;let bb=b*3;
                let dx=p[bb]-p[aa];let dy=p[bb+1]-p[aa+1];let dz=p[bb+2]-p[aa+2];
                let length=host::norm(dx,dy,dz);if length<1e-10{continue;}
                let nx=dx/length;let ny=dy/length;let nz=dz/length;
                let relative=(v[bb]-v[aa])*nx+(v[bb+1]-v[aa+1])*ny+(v[bb+2]-v[aa+2])*nz;
                let denom=inverse[a]+inverse[b];if denom<=1e-14{continue;}
                let impulse=-relative*gain/denom;
                let wa=inverse[a]*impulse;let wb=inverse[b]*impulse;
                v[aa]-=nx*wa;v[aa+1]-=ny*wa;v[aa+2]-=nz*wa;
                v[bb]+=nx*wb;v[bb+1]+=ny*wb;v[bb+2]+=nz*wb;
            }
        }
        let mut peak=0.0_f64;
        for i in 0..m{
            if broken[i]!=0{continue;}
            let a=ia[i] as usize;let b=ib[i] as usize;
            if kind[i]==0{
                let aa=a*3;let bb=b*3;
                let dx=p[bb]-p[aa];let dy=p[bb+1]-p[aa+1];let dz=p[bb+2]-p[aa+2];
                let length=host::norm(dx,dy,dz);if length<1e-10{continue;}
                let relative=((v[bb]-v[aa])*dx+(v[bb+1]-v[aa+1])*dy+(v[bb+2]-v[aa+2])*dz)/length;
                peak=peak.max(relative.abs());
            }else{
                let (g,_)=gradients(p,a,b,ic[i] as usize,id[i] as usize);
                let rate=g[0].dot(point(v,a))+g[1].dot(point(v,b))
                    +g[2].dot(point(v,ic[i] as usize))+g[3].dot(point(v,id[i] as usize));
                let area=1e-9_f64.max(host::power(rest[i].abs(),2.0/3.0));
                peak=peak.max(rate.abs()/area);
            }
        }
        self.scalars[2]+=1.0;
        self.scalars[1]=if peak<sleep_speed{self.scalars[1]+dt}else{0.0};
        if self.scalars[1]>=sleep_delay{2}else{1}
    }
}

#[cfg(target_arch="wasm32")]
mod abi {
    use super::*;
    #[no_mangle]
    pub extern "C" fn world_structure_new(n:u32,m:u32)->u32{
        Structure::new(n as usize,m as usize)
            .map(|body|Box::into_raw(Box::new(body)) as u32).unwrap_or(0)
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_structure_free(handle:u32){
        if handle!=0{drop(Box::from_raw(handle as *mut Structure));}
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_structure_field(handle:u32,kind:u32)->u32{
        if handle==0||kind as usize>=N_FIELDS{return 0;}
        (&mut *(handle as *mut Structure)).ptr(kind as usize)
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_structure_add_box(
        handle:u32,cx:f64,cy:f64,cz:f64,hx:f64,hy:f64,hz:f64
    )->u32{
        if handle==0{return 0;}
        (&mut *(handle as *mut Structure))
            .add_box([cx,cy,cz],[hx,hy,hz]) as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_structure_add_triangle(handle:u32,a:u32,b:u32,c:u32)->u32{
        if handle==0{return 0;}
        (&mut *(handle as *mut Structure)).add_triangle(a as usize,b as usize,c as usize) as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_structure_finish_contacts(handle:u32)->u32{
        if handle==0{return 0;}
        (&mut *(handle as *mut Structure)).finish_contacts();
        1
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_structure_contact_stats(handle:u32)->u32{
        if handle==0{return 0;}
        (&mut *(handle as *mut Structure)).contact_stats.as_mut_ptr() as u32
    }

    #[no_mangle]
    pub unsafe extern "C" fn world_structure_scalars(handle:u32)->u32{
        if handle==0{return 0;}
        (&mut *(handle as *mut Structure)).scalars.as_mut_ptr() as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_structure_step(
        handle:u32,iterations:u32,dt:f64,gx:f64,gy:f64,gz:f64,
        damping:f64,thermal:f64,sleep_speed:f64,sleep_delay:f64,contacts:u32,
    )->u32{
        if handle==0||!(1..=32).contains(&iterations)||!dt.is_finite()||dt<=0.0||dt>1.0/30.0
          ||![gx,gy,gz,damping,thermal,sleep_speed,sleep_delay].iter().all(|x|x.is_finite()){
            return 0;
        }
        (&mut *(handle as *mut Structure)).step(
            iterations as usize,dt,V{x:gx,y:gy,z:gz},damping,thermal,
            sleep_speed,sleep_delay,contacts!=0,
        )
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn simple_body_remains_finite_and_preserves_uniform_motion(){
        let mut s=Structure::new(2,1).unwrap();
        s.floats[POSITION]=vec![0.,0.,0.,1.,0.,0.];
        s.floats[VELOCITY]=vec![2.,0.,0.,2.,0.,0.];
        s.floats[INVERSE]=vec![1.,1.];s.floats[REST]=vec![1.];
        s.floats[ORIGINAL_REST]=vec![1.];
        s.floats[COMPLIANCE]=vec![1e-5];
        s.floats[YIELD_LIMIT]=vec![0.1];s.floats[BREAK_LIMIT]=vec![1.0];
        s.ia[0]=0;s.ib[0]=1;
        for _ in 0..100{assert_eq!(s.step(8,1.0/120.0,V{x:0.,y:0.,z:0.},0.,1.,0.001,10.,false),1);}
        assert!((s.floats[POSITION][0]-2.0*100.0/120.0).abs()<1e-10);
        assert!((s.floats[POSITION][3]-s.floats[POSITION][0]-1.0).abs()<1e-9);
    }
    #[test]
    fn abi_fields_have_expected_lengths(){
        let mut s=Structure::new(8,10).unwrap();
        assert_eq!(s.floats.len(),17);
        assert_eq!(s.floats[IMPULSE_WEIGHTS].len(),8);
        assert_eq!(s.floats[REST].len(),10);
        assert_eq!(s.kind.len(),10);assert_eq!(s.broken.len(),10);
        assert_eq!(N_FIELDS,23);
    }
}
