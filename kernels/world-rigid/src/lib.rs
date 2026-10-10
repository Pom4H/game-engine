//! Rigid-body narrowphase + sequential point-impulse solver.
//! Rust owns only fixed-size scratch. The JS PhysicsWorld owns body topology,
//! contact order, material policy, mass, and the authoritative dynamic state.
//! The Wasm entrypoints deliberately make no syscalls or hidden callbacks.

#[cfg(target_arch="wasm32")]
mod math {
    #[link(wasm_import_module="math")]
    extern "C" {
        #[link_name="hypot"] fn hypot3(x:f64,y:f64,z:f64)->f64;
        #[link_name="sin"] fn sin_import(x:f64)->f64;
        #[link_name="cos"] fn cos_import(x:f64)->f64;
    }
    // Fast finite-range Euclidean norm stays inside WebAssembly and avoids a
    // host FFI call for every SAT axis, friction tangent and angular impulse.
    // Preserve scaled Math.hypot for extreme magnitudes to avoid overflow.
    #[inline] pub fn hypot(x:f64,y:f64,z:f64)->f64{
        let largest=x.abs().max(y.abs()).max(z.abs());
        if largest>1e100 || (largest<1e-100 && largest>0.0){
            unsafe{hypot3(x,y,z)}
        }else{(x*x+y*y+z*z).sqrt()}
    }
    #[inline] pub fn sin(x:f64)->f64{unsafe{sin_import(x)}}
    #[inline] pub fn cos(x:f64)->f64{unsafe{cos_import(x)}}
}
#[cfg(not(target_arch="wasm32"))]
mod math {
    #[inline] pub fn hypot(x:f64,y:f64,z:f64)->f64{x.hypot(y).hypot(z)}
    #[inline] pub fn sin(x:f64)->f64{x.sin()}
    #[inline] pub fn cos(x:f64)->f64{x.cos()}
}

pub const STRIDE:usize=32;
pub const RESULT_LEN:usize=16;
pub const MAX_BATCH:usize=256;
pub const BATCH_OUTPUT_STRIDE:usize=16;
const EPSILON:f64=1e-12;

#[derive(Clone,Copy,Debug)]
struct V{x:f64,y:f64,z:f64}
impl V {
    const ZERO:Self=Self{x:0.0,y:0.0,z:0.0};
    const X:Self=Self{x:1.0,y:0.0,z:0.0};
    fn from(a:&[f64],index:usize)->Self{
        Self{x:a[index],y:a[index+1],z:a[index+2]}
    }
    fn write(self,a:&mut [f64],index:usize){
        a[index]=self.x;a[index+1]=self.y;a[index+2]=self.z;
    }
    #[inline] fn plus(self,b:Self)->Self{Self{x:self.x+b.x,y:self.y+b.y,z:self.z+b.z}}
    #[inline] fn minus(self,b:Self)->Self{Self{x:self.x-b.x,y:self.y-b.y,z:self.z-b.z}}
    #[inline] fn times(self,t:f64)->Self{Self{x:self.x*t,y:self.y*t,z:self.z*t}}
    #[inline] fn dot(self,b:Self)->f64{self.x*b.x+self.y*b.y+self.z*b.z}
    #[inline] fn cross(self,b:Self)->Self{
        Self{x:self.y*b.z-self.z*b.y,y:self.z*b.x-self.x*b.z,z:self.x*b.y-self.y*b.x}
    }
    #[inline] fn len(self)->f64{math::hypot(self.x,self.y,self.z)}
    #[inline] fn normalize(self)->Self{let n=self.len();if n>EPSILON{self.times(1.0/n)}else{Self::ZERO}}
    fn at(self,i:usize)->f64{match i{0=>self.x,1=>self.y,2=>self.z,_=>unreachable!()}}
    fn with(self,i:usize,v:f64)->Self{
        match i{0=>Self{x:v,..self},1=>Self{y:v,..self},2=>Self{z:v,..self},_=>unreachable!()}
    }
}

fn rotation_basis(rotation:V)->[V;3]{
    let rx=rotation.x;let ry=rotation.y;let rz=rotation.z;
    let sx=math::sin(rx);let cx=math::cos(rx);
    let sy=math::sin(ry);let cy=math::cos(ry);
    let sz=math::sin(rz);let cz=math::cos(rz);
    [
        V{x:cy*cz,y:sx*sy*cz+cx*sz,z:-cx*sy*cz+sx*sz},
        V{x:-cy*sz,y:-sx*sy*sz+cx*cz,z:cx*sy*sz+sx*cz},
        V{x:sy,y:-sx*cy,z:cx*cy},
    ]
}
#[derive(Clone,Copy)]
struct Body {
    pos:V,rotation:V,axes:[V;3],velocity:V,omega:V,inv_mass:f64,inv_inertia:V,
    shape:u32,half:V,offset:V,restitution:f64,friction:f64,
}
impl Body {
    fn read(s:&[f64])->Self{
        let rotation=V::from(s,3);
        Self{
            pos:V::from(s,0),rotation,axes:rotation_basis(rotation),velocity:V::from(s,6),
            omega:V::from(s,9),inv_mass:s[12],inv_inertia:V::from(s,13),
            shape:s[16] as u32,half:V::from(s,17),offset:V::from(s,20),
            restitution:s[23],friction:s[24],
        }
    }
    fn write(self,s:&mut [f64]){
        self.pos.write(s,0);self.velocity.write(s,6);self.omega.write(s,9);
    }
    #[inline] fn basis(self)->[V;3]{self.axes}
    fn local_to_world(self,v:V)->V{
        let basis=self.basis();
        V{x:basis[0].x*v.x+basis[1].x*v.y+basis[2].x*v.z,
          y:basis[0].y*v.x+basis[1].y*v.y+basis[2].y*v.z,
          z:basis[0].z*v.x+basis[1].z*v.y+basis[2].z*v.z}
    }
    fn world_to_local(self,v:V)->V{
        let b=self.basis();V{x:v.dot(b[0]),y:v.dot(b[1]),z:v.dot(b[2])}
    }
    fn center(self)->V{self.pos.plus(self.local_to_world(self.offset))}
    fn support(self,dir:V)->V{
        if self.shape==0{return self.pos.plus(dir.normalize().times(self.half.x))}
        let basis=self.basis();
        let mut point=self.center();
        for i in 0..3{
            let projection=dir.dot(basis[i]);
            if projection.abs()>1e-8{
                let sign=if projection>0.0{1.0}else{-1.0};
                point=point.plus(basis[i].times(self.half.at(i)*sign));
            }
        }
        point
    }
    fn inv_inertia_world(self,v:V)->V{
        let local=self.world_to_local(v);
        self.local_to_world(V{
            x:local.x*self.inv_inertia.x,
            y:local.y*self.inv_inertia.y,
            z:local.z*self.inv_inertia.z,
        })
    }
    fn velocity_at(self,r:V)->V{self.velocity.plus(self.omega.cross(r))}
    fn impulse(self:&mut Self,direction:V,j:f64,point:V)->bool{
        if self.inv_mass==0.0 || j==0.0{return false}
        let r=point.minus(self.pos);
        let impulse=direction.times(j);
        let angular=r.cross(impulse);
        let dw=self.inv_inertia_world(angular);
        self.velocity=self.velocity.plus(impulse.times(self.inv_mass));
        self.omega=self.omega.plus(dw);
        true
    }
}
#[derive(Clone,Copy,Debug)]
struct Hit{normal:V,point:V,penetration:f64}

fn sphere_sphere(a:Body,b:Body)->Option<Hit>{
    let d=b.pos.minus(a.pos);let distance=d.len();let radius=a.half.x+b.half.x;
    if distance>=radius{return None}
    let normal=if distance>1e-8{d.times(1.0/distance)}else{V::X};
    Some(Hit{normal,penetration:radius-distance,point:a.pos.plus(normal.times(a.half.x))})
}
fn projected_radius(half:V,basis:[V;3],axis:V)->f64{
    half.x*basis[0].dot(axis).abs()+half.y*basis[1].dot(axis).abs()+half.z*basis[2].dot(axis).abs()
}
fn box_box(a:Body,b:Body)->Option<Hit>{
    let ab=a.basis();let bb=b.basis();
    let center=b.center().minus(a.center());
    let mut axes=[V::ZERO;15];axes[..3].copy_from_slice(&ab);axes[3..6].copy_from_slice(&bb);
    let mut count=6usize;
    for aa in ab{for ba in bb{
        let cross=aa.cross(ba);
        if cross.len()>1e-8{axes[count]=cross.normalize();count+=1;}
    }}
    let mut penetration=f64::INFINITY;let mut normal=V::X;
    for raw in axes.into_iter().take(count){
        let axis=raw.normalize();
        if axis.len()<1e-8{continue;}
        let ra=projected_radius(a.half,ab,axis);let rb=projected_radius(b.half,bb,axis);
        let signed=center.dot(axis);let overlap=ra+rb-signed.abs();
        if overlap<=0.0{return None}
        if overlap<penetration{
            penetration=overlap;normal=if signed>=0.0{axis}else{axis.times(-1.0)};
        }
    }
    let pa=a.support(normal);let pb=b.support(normal.times(-1.0));
    Some(Hit{normal,penetration,point:pa.plus(pb).times(0.5)})
}
fn sign_or_one(x:f64)->f64{
    if x>0.0{1.0}else if x<0.0{-1.0}else{1.0}
}
fn sphere_box(sphere:Body,b:Body,invert:bool)->Option<Hit>{
    let radius=sphere.half.x;
    let center=b.center();
    let local=b.world_to_local(sphere.pos.minus(center));
    let closest=V{
        x:local.x.max(-b.half.x).min(b.half.x),
        y:local.y.max(-b.half.y).min(b.half.y),
        z:local.z.max(-b.half.z).min(b.half.z),
    };
    let world_closest=center.plus(b.local_to_world(closest));
    let delta=world_closest.minus(sphere.pos);
    let distance=delta.len();
    if distance>=radius{return None}
    let (mut normal,penetration,point);
    if distance<1e-8{
        let gaps=V{x:b.half.x-local.x.abs(),y:b.half.y-local.y.abs(),z:b.half.z-local.z.abs()};
        let axis=if gaps.x<=gaps.y&&gaps.x<=gaps.z{0}
            else if gaps.y<=gaps.z{1}else{2};
        let rel=b.world_to_local(sphere.velocity.minus(b.velocity));
        let sign=if local.at(axis).abs()>1e-7{sign_or_one(local.at(axis))}
            else{sign_or_one(-rel.at(axis))};
        let local_normal=V::ZERO.with(axis,sign);
        normal=b.local_to_world(local_normal).times(-1.0);
        penetration=radius+gaps.at(axis);
        point=center.plus(b.local_to_world(local.with(axis,sign*b.half.at(axis))));
    }else{
        normal=delta.times(1.0/distance);
        penetration=radius-distance;
        point=world_closest;
    }
    if invert{normal=normal.times(-1.0);}
    Some(Hit{normal,penetration,point})
}
fn intersect(a:Body,b:Body)->Option<Hit>{
    if a.shape==0&&b.shape==0{sphere_sphere(a,b)}
    else if a.shape==1&&b.shape==1{box_box(a,b)}
    else if a.shape==0{sphere_box(a,b,false)}
    else{sphere_box(b,a,true)}
}
fn denominator(a:Body,b:Body,ra:V,rb:V,direction:V)->f64{
    let mut d=a.inv_mass+b.inv_mass;
    if a.inv_mass!=0.0{
        let rn=ra.cross(direction);
        d+=direction.dot(a.inv_inertia_world(rn).cross(ra));
    }
    if b.inv_mass!=0.0{
        let rn=rb.cross(direction);
        d+=direction.dot(b.inv_inertia_world(rn).cross(rb));
    }
    d
}
fn contact_values(a:Body,b:Body,hit:Hit)->(f64,f64,f64){
    let ra=hit.point.minus(a.pos);let rb=hit.point.minus(b.pos);
    let va=a.velocity_at(ra);let vb=b.velocity_at(rb);
    let rv=vb.minus(va);
    let approach=(-rv.dot(hit.normal)).max(0.0);
    let denominator=denominator(a,b,ra,rb,hit.normal);
    let mass=if denominator>1e-12{1.0/denominator}else{0.0};
    (approach,mass,0.5*mass*approach*approach)
}
fn resolve(mut a:Body,mut b:Body,hit:Hit,approach:f64,effective_mass:f64)->(Body,Body,f64,bool,bool){
    let inv=a.inv_mass+b.inv_mass;
    if inv<=0.0{return (a,b,0.0,false,false)}
    let correction=(hit.penetration-0.0005).max(0.0)*0.8/inv;
    if a.inv_mass!=0.0{a.pos=a.pos.minus(hit.normal.times(correction*a.inv_mass));}
    if b.inv_mass!=0.0{b.pos=b.pos.plus(hit.normal.times(correction*b.inv_mass));}
    let mut impulse=0.0;
    let mut wake_a=false;let mut wake_b=false;
    if approach>0.0&&effective_mass>0.0{
        let restitution=a.restitution.min(b.restitution);
        let j=(1.0+restitution)*approach*effective_mass;
        impulse=j;
        wake_a|=a.impulse(hit.normal,-j,hit.point);
        wake_b|=b.impulse(hit.normal,j,hit.point);
        // Tangent is recomputed from new positions after normal impulse,
        // exactly like PhysicsWorld.resolvePair.
        let ra=hit.point.minus(a.pos);let rb=hit.point.minus(b.pos);
        let post=b.velocity_at(rb).minus(a.velocity_at(ra));
        let normal_speed=post.dot(hit.normal);
        let tangent_raw=post.minus(hit.normal.times(normal_speed));
        let length=tangent_raw.len();
        if length>1e-8{
            let tangent=tangent_raw.times(1.0/length);
            let denom=denominator(a,b,ra,rb,tangent);
            let limit=j*(a.friction*b.friction).sqrt();
            if denom>1e-12{
                let wanted=-post.dot(tangent)/denom;
                let jt=wanted.max(-limit).min(limit);
                wake_a|=a.impulse(tangent,-jt,hit.point);
                wake_b|=b.impulse(tangent,jt,hit.point);
            }
        }
    }
    (a,b,impulse,wake_a,wake_b)
}
// One A body against its ordered broadphase candidates. Each B is distinct.
 // Full sequential impulses are evaluated in Rust, but only when no contact
 // policy/trace participates; coupled systems retain synchronous JS decisions.
pub struct Kernel {
    input:[f64;STRIDE*2],output:[f64;RESULT_LEN],
    batch_input:Vec<f64>,batch_output:Vec<f64>,
}
impl Kernel {
    fn new()->Self{Self{
        input:[0.0;STRIDE*2],output:[0.0;RESULT_LEN],
        batch_input:vec![0.0;(MAX_BATCH+1)*STRIDE],
        batch_output:vec![0.0;MAX_BATCH*BATCH_OUTPUT_STRIDE],
    }}
    fn bodies(&self)->(Body,Body){(Body::read(&self.input[..STRIDE]),Body::read(&self.input[STRIDE..]))}
    fn test(&mut self)->u32{
        let (a,b)=self.bodies();
        if a.inv_mass+b.inv_mass<=0.0{return 0;}
        let Some(hit)=intersect(a,b)else{return 0};
        let (approach,mass,energy)=contact_values(a,b,hit);
        hit.normal.write(&mut self.output,0);
        self.output[3]=hit.penetration;
        hit.point.write(&mut self.output,4);
        self.output[7]=approach;self.output[8]=mass;self.output[9]=energy;
        1
    }
    /// A's broadphase query has already been evaluated by the owning world.
    /// Resolve B candidates in that *exact* sequence, updating A after every
    /// contact. No allocations, callbacks, or growth during this call.
    fn solve_batch(&mut self,count:usize)->u32{
        if count>MAX_BATCH{return u32::MAX;}
        let mut a=Body::read(&self.batch_input[..STRIDE]);
        let mut hits=0u32;
        for i in 0..count{
            let base=(i+1)*STRIDE;
            let result=i*BATCH_OUTPUT_STRIDE;
            self.batch_output[result..result+BATCH_OUTPUT_STRIDE].fill(0.0);
            let b=Body::read(&self.batch_input[base..base+STRIDE]);
            if a.inv_mass+b.inv_mass<=0.0{continue;}
            let Some(hit)=intersect(a,b)else{continue;};
            let (approach,mass,energy)=contact_values(a,b,hit);
            let (next_a,next_b,impulse,wake_a,wake_b)=resolve(a,b,hit,approach,mass);
            a=next_a;
            next_b.write(&mut self.batch_input[base..base+STRIDE]);
            let output=&mut self.batch_output[result..result+BATCH_OUTPUT_STRIDE];
            output[0]=1.0;
            hit.normal.write(output,1);
            output[4]=hit.penetration;
            hit.point.write(output,5);
            output[8]=approach;
            output[9]=energy;
            output[10]=impulse;
            output[13]=mass;
            output[11]=wake_a as u32 as f64;
            output[12]=wake_b as u32 as f64;
            hits+=1;
        }
        a.write(&mut self.batch_input[..STRIDE]);
        hits
    }

    fn solve(&mut self)->u32{
        let (a,b)=self.bodies();
        let hit=Hit{normal:V::from(&self.output,0),penetration:self.output[3],point:V::from(&self.output,4)};
        if !hit.penetration.is_finite()||!self.output[7].is_finite()||!self.output[8].is_finite(){return 0}
        let (a,b,impulse,wake_a,wake_b)=resolve(a,b,hit,self.output[7],self.output[8]);
        a.write(&mut self.input[..STRIDE]);b.write(&mut self.input[STRIDE..]);
        self.output[10]=impulse;self.output[11]=wake_a as u32 as f64;
        self.output[12]=wake_b as u32 as f64;
        1
    }
}
#[cfg(target_arch="wasm32")]
mod abi {
    use super::Kernel;
    #[no_mangle]pub extern "C" fn world_rigid_new()->u32{Box::into_raw(Box::new(Kernel::new())) as u32}
    #[no_mangle]pub unsafe extern "C" fn world_rigid_free(handle:u32){if handle!=0{drop(Box::from_raw(handle as *mut Kernel));}}
    #[no_mangle]pub unsafe extern "C" fn world_rigid_input(handle:u32)->u32{
        if handle==0{return 0;}(&mut *(handle as *mut Kernel)).input.as_mut_ptr() as u32
    }
    #[no_mangle]pub unsafe extern "C" fn world_rigid_output(handle:u32)->u32{
        if handle==0{return 0;}(&mut *(handle as *mut Kernel)).output.as_mut_ptr() as u32
    }
    #[no_mangle]pub unsafe extern "C" fn world_rigid_intersect(handle:u32)->u32{
        if handle==0{return 0;}(&mut *(handle as *mut Kernel)).test()
    }
    #[no_mangle]pub unsafe extern "C" fn world_rigid_resolve(handle:u32)->u32{
        if handle==0{return 0;}(&mut *(handle as *mut Kernel)).solve()
    }
    #[no_mangle]pub unsafe extern "C" fn world_rigid_batch_input(handle:u32)->u32{
        if handle==0{return 0;}(&mut *(handle as *mut Kernel)).batch_input.as_mut_ptr() as u32
    }
    #[no_mangle]pub unsafe extern "C" fn world_rigid_batch_output(handle:u32)->u32{
        if handle==0{return 0;}(&mut *(handle as *mut Kernel)).batch_output.as_mut_ptr() as u32
    }
    #[no_mangle]pub unsafe extern "C" fn world_rigid_batch_resolve(handle:u32,count:u32)->u32{
        if handle==0||count as usize>super::MAX_BATCH{return u32::MAX;}
        (&mut *(handle as *mut Kernel)).solve_batch(count as usize)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn ball(x:f64,velocity:f64)->Body{
        Body{pos:V{x,y:0.,z:0.},rotation:V::ZERO,axes:rotation_basis(V::ZERO),
            velocity:V{x:velocity,y:0.,z:0.},omega:V::ZERO,
            inv_mass:1.,inv_inertia:V{x:2.5,y:2.5,z:2.5},shape:0,
            half:V{x:0.5,y:0.,z:0.},offset:V::ZERO,restitution:0.,friction:0.}
    }
    fn box_body(x:f64,y:f64)->Body{
        Body{pos:V{x,y,z:0.},rotation:V::ZERO,axes:rotation_basis(V::ZERO),velocity:V::ZERO,
            omega:V::ZERO,inv_mass:1.,inv_inertia:V{x:1.,y:1.,z:1.},
            shape:1,half:V{x:0.5,y:0.5,z:0.5},offset:V::ZERO,restitution:0.,friction:0.}
    }
    #[test]fn head_on_sphere_momentum(){
        let a=ball(-0.4,1.);let b=ball(0.4,-1.);
        let hit=intersect(a,b).expect("sphere collision");
        let (approach,mass,_)=contact_values(a,b,hit);
        let (a,b,j,_,_)=resolve(a,b,hit,approach,mass);
        assert_eq!(hit.normal.x,1.);
        assert!(j>0.);
        assert!((a.velocity.x+b.velocity.x).abs()<1e-10);
        assert!(a.velocity.x.abs()<1e-9 && b.velocity.x.abs()<1e-9);
    }
    #[test]fn moving_boxes_with_off_center_impact(){
        let mut a=box_body(-0.45,0.2);let mut b=box_body(0.45,0.);
        a.velocity.x=5.;b.velocity.x=-1.;
        let hit=intersect(a,b).expect("box overlap");
        let (approach,mass,_)=contact_values(a,b,hit);
        let (a,b,j,_,_)=resolve(a,b,hit,approach,mass);
        assert!(j>0.);
        assert!((a.velocity.x+b.velocity.x-4.).abs()<1e-10);
        assert!(a.omega.z.abs()+b.omega.z.abs()>0.);
    }
    #[test]fn rotated_obb_sat(){
        let mut rail=box_body(0.,0.);
        rail.half=V{x:2.,y:0.25,z:0.25};rail.rotation.y=std::f64::consts::FRAC_PI_2;rail.axes=rotation_basis(rail.rotation);
        let mut mover=box_body(0.15,0.);
        mover.pos.z=1.7;
        assert!(intersect(rail,mover).is_some());
        mover.pos.x=3.;
        assert!(intersect(rail,mover).is_none());
    }

    #[test]fn batched_matches_ordered_pair_resolution_including_misses(){
        let mut kern=Kernel::new();
        let a=ball(-0.4,1.0);
        let b=ball(0.4,-1.0);
        let miss=ball(100.0,0.0);
        // Third body is not a "B": it cannot share ownership of pair state.
        let mut write=|index:usize, body:Body|{
            let at=index*STRIDE;
            body.pos.write(&mut kern.batch_input,at);
            body.rotation.write(&mut kern.batch_input,at+3);
            body.velocity.write(&mut kern.batch_input,at+6);
            body.omega.write(&mut kern.batch_input,at+9);
            kern.batch_input[at+12]=body.inv_mass;
            body.inv_inertia.write(&mut kern.batch_input,at+13);
            kern.batch_input[at+16]=body.shape as f64;
            body.half.write(&mut kern.batch_input,at+17);
            body.offset.write(&mut kern.batch_input,at+20);
            kern.batch_input[at+23]=body.restitution;
            kern.batch_input[at+24]=body.friction;
        };
        write(0,a);write(1,b);write(2,miss);
        assert_eq!(kern.solve_batch(2),1);
        assert_eq!(kern.batch_output[0],1.0);
        assert_eq!(kern.batch_output[BATCH_OUTPUT_STRIDE],0.0);
        let hit=intersect(a,b).unwrap();
        let (approach,mass,_)=contact_values(a,b,hit);
        let (expected_a,expected_b,_,_,_)=resolve(a,b,hit,approach,mass);
        assert!((kern.batch_input[6]-expected_a.velocity.x).abs()<1e-12);
        assert!((kern.batch_input[STRIDE+6]-expected_b.velocity.x).abs()<1e-12);
    }
    #[test]fn sphere_inside_box_chooses_incoming_face(){
        let mut b=box_body(0.,0.);b.inv_mass=0.;
        let mut s=ball(0.,2.);s.half.x=0.25;
        let hit=intersect(s,b).unwrap();
        assert!(hit.normal.x>0.);
    }
}
