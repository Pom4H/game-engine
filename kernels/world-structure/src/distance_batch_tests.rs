use super::*;
use distance_batch::{try_solve_pair, AVAILABLE};

#[derive(Clone)]
struct PairFixture {
    p: Vec<f64>, w: Vec<f64>, kind: Vec<u8>, a: Vec<u16>, b: Vec<u16>,
    broken: Vec<u8>, rest: Vec<f64>, compliance: Vec<f64>, lambda: Vec<f64>,
}
impl PairFixture {
    fn new() -> Self {
        Self { p: vec![0.,0.,0., 1.2,0.1,0., 0.,2.,0., 1.3,2.,0.2],
            w: vec![1.,0.5,0.,2.], kind: vec![0;2], a: vec![0,2], b: vec![1,3],
            broken: vec![0;2], rest: vec![1.;2], compliance: vec![1e-5;2],
            lambda: vec![0.01,-0.02] }
    }
    fn pair(&mut self, i: usize, dt: f64, thermal: f64) -> bool {
        try_solve_pair(i, &mut self.p, &self.w, &self.kind, &self.a, &self.b,
            &self.broken, &self.rest, &self.compliance, &mut self.lambda, dt, thermal)
    }
    // Independent transcription of the existing native distance projection.
    fn scalar(&mut self, i: usize, dt: f64, thermal: f64) {
        let a = self.a[i] as usize; let b = self.b[i] as usize;
        let aa = a*3; let bb = b*3;
        let d = [self.p[bb]-self.p[aa], self.p[bb+1]-self.p[aa+1], self.p[bb+2]-self.p[aa+2]];
        let len = host::norm(d[0],d[1],d[2]);
        if len < 1e-10 { return; }
        let alpha = self.compliance[i]/(dt*dt);
        let denom = self.w[a]+self.w[b]+alpha;
        if denom <= 1e-14 { return; }
        let dl = (-(len-self.rest[i]*thermal)-alpha*self.lambda[i])/denom;
        self.lambda[i] += dl;
        let wa = self.w[a]*dl; let wb = self.w[b]*dl;
        for axis in 0..3 {
            let normal=d[axis]/len;
            self.p[aa+axis]-=normal*wa; self.p[bb+axis]+=normal*wb;
        }
    }
    fn assert_rejected_without_writes(mut self, i: usize, dt: f64, thermal: f64) {
        let old=self.clone();
        assert!(!self.pair(i,dt,thermal));
        assert_eq!(self.p.iter().map(|x|x.to_bits()).collect::<Vec<_>>(),
            old.p.iter().map(|x|x.to_bits()).collect::<Vec<_>>());
        assert_eq!(self.lambda,old.lambda);
    }
}
fn close(a:&[f64],b:&[f64],eps:f64) {
    assert_eq!(a.len(),b.len());
    for (i,(&x,&y)) in a.iter().zip(b).enumerate() {
        assert!(x.is_finite() && y.is_finite(),"nonfinite at {i}: {x}, {y}");
        assert!((x-y).abs()<=eps*(1.0+x.abs().max(y.abs())),"at {i}: {x} != {y}");
    }
}

#[test]
fn adjacent_disjoint_pair_matches_existing_formula() {
    if !AVAILABLE { return; }
    let mut s=PairFixture::new(); let mut v=s.clone();
    s.scalar(0,1./120.,1.02); s.scalar(1,1./120.,1.02);
    assert!(v.pair(0,1./120.,1.02));
    close(&s.p,&v.p,1e-13); close(&s.lambda,&v.lambda,1e-13);
    // Third node has inverse mass zero: no correction is permitted.
    assert_eq!(&v.p[6..9],&[0.,2.,0.]);
}
#[test]
fn every_shared_endpoint_is_a_barrier() {
    for endpoint in 0..2 {
        for node in [0,1] {
            let mut f=PairFixture::new();
            if endpoint==0 {f.a[1]=node;} else {f.b[1]=node;}
            f.assert_rejected_without_writes(0,1./120.,1.);
        }
    }
    let mut f=PairFixture::new(); f.b[0]=f.a[0];
    f.assert_rejected_without_writes(0,1./120.,1.);
}
#[test]
fn volume_broken_and_odd_tail_are_barriers() {
    for lane in 0..2 {
        let mut f=PairFixture::new(); f.kind[lane]=1;
        f.assert_rejected_without_writes(0,1./120.,1.);
        let mut f=PairFixture::new(); f.broken[lane]=1;
        f.assert_rejected_without_writes(0,1./120.,1.);
    }
    PairFixture::new().assert_rejected_without_writes(1,1./120.,1.);
    PairFixture::new().assert_rejected_without_writes(usize::MAX,1./120.,1.);
}
#[test]
fn malformed_views_are_rejected_without_unsafe_indexing() {
    let mut f=PairFixture::new(); f.b[1]=u16::MAX;
    f.assert_rejected_without_writes(0,1./120.,1.);
    let mut f=PairFixture::new(); f.w.truncate(2);
    f.assert_rejected_without_writes(0,1./120.,1.);
    let mut f=PairFixture::new(); f.compliance.clear();
    f.assert_rejected_without_writes(0,1./120.,1.);
}
#[test]
fn degeneracy_and_overflow_return_to_reference_before_writing() {
    let mut f=PairFixture::new(); f.p[3..6].fill(0.);
    f.assert_rejected_without_writes(0,1./120.,1.);
    let mut f=PairFixture::new(); f.w.fill(0.); f.compliance.fill(0.);
    f.assert_rejected_without_writes(0,1./120.,1.);
    let mut f=PairFixture::new(); f.p[3]=1e200;
    f.assert_rejected_without_writes(0,1./120.,1.);
    let mut f=PairFixture::new(); f.p[3]=f64::NAN;
    f.assert_rejected_without_writes(0,1./120.,1.);
    for dt in [0.,-1.,f64::NAN,f64::INFINITY] {
        PairFixture::new().assert_rejected_without_writes(0,dt,1.);
    }
    PairFixture::new().assert_rejected_without_writes(0,1./120.,f64::NAN);
}
#[test]
fn topology_is_rechecked_after_host_mutation() {
    if !AVAILABLE { return; }
    let mut f=PairFixture::new(); assert!(f.pair(0,1./120.,1.));
    f.a[1]=f.b[0]; f.assert_rejected_without_writes(0,1./120.,1.);
}
#[test]
fn deterministic_random_pairs_match_reference() {
    if !AVAILABLE { return; }
    let mut seed=0x3edcba9876543210_u64;
    let mut next=|| {
        seed=seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        ((seed>>11) as f64)/((1_u64<<53) as f64)
    };
    for _ in 0..10_000 {
        let mut s=PairFixture::new();
        for v in &mut s.p {*v=next()*20.-10.;}
        for w in &mut s.w {*w=next()*3.;}
        for c in &mut s.compliance {*c=next()*0.001;}
        for r in &mut s.rest {*r=0.1+next()*3.;}
        for l in &mut s.lambda {*l=next()*0.1-0.05;}
        let dt=0.001+next()*0.02; let thermal=0.8+next()*0.4;
        let mut v=s.clone(); s.scalar(0,dt,thermal); s.scalar(1,dt,thermal);
        assert!(v.pair(0,dt,thermal));
        close(&s.p,&v.p,1e-12); close(&s.lambda,&v.lambda,1e-12);
    }
}
#[test]
fn internal_pair_preserves_mass_weighted_center() {
    if !AVAILABLE { return; }
    let mut f=PairFixture::new(); f.w[2]=0.7;
    let center=|f:&PairFixture| -> [f64;3] {
        std::array::from_fn(|axis| (0..4).map(|i|f.p[i*3+axis]/f.w[i]).sum())
    };
    let before=center(&f); assert!(f.pair(0,1./120.,1.));
    close(&before,&center(&f),1e-13);
}

fn mixed_body(simd:bool) -> Structure {
    let mut s=Structure::new(8,9).unwrap(); s.distance_simd=simd;
    s.floats[POSITION]=vec![0.,0.,0., 1.,0.,0., 0.,1.,0., 1.,1.,0.,
        0.,0.,1., 1.,0.,1., 0.,1.,1., 1.,1.,1.];
    s.floats[INVERSE].fill(1.); s.floats[MASS].fill(1.);
    for (i,(a,b)) in [(0,1),(2,3),(1,2),(4,5),(6,7),(3,4),(0,7),(0,1),(5,6)].into_iter().enumerate() {
        s.ia[i]=a; s.ib[i]=b;
        let pa=point(&s.floats[POSITION],a as usize); let pb=point(&s.floats[POSITION],b as usize);
        let d=pb.sub(pa); s.floats[REST][i]=host::norm(d.x,d.y,d.z);
    }
    s.kind[7]=1; s.ic[7]=2; s.id[7]=4;
    s.floats[REST][7]=volume(&s.floats[POSITION],0,1,2,4);
    s.floats[ORIGINAL_REST]=s.floats[REST].clone();
    s.floats[COMPLIANCE].fill(1e-5); s.floats[YIELD_LIMIT].fill(0.001);
    s.floats[BREAK_LIMIT].fill(5.); s.floats[BREAK_LIMIT][6]=0.00001;
    s.floats[PLASTICITY].fill(0.1); s.floats[YIELD_FORCE].fill(20.);
    s.floats[POSITION][3]+=0.08; s.floats[POSITION][21]+=0.08;
    s.add_box([0.5,-0.1,0.5],[2.,0.1,2.]);
    s.add_triangle(0,1,4); s.finish_contacts(); s
}
#[test]
fn full_steps_keep_volume_fracture_plasticity_damping_and_contacts_in_order() {
    if !AVAILABLE { return; }
    let mut scalar=mixed_body(false); let mut simd=mixed_body(true);
    for _ in 0..120 {
        let a=scalar.step(8,1./120.,V{x:0.,y:-9.81,z:0.},0.2,1.,0.001,10.,true);
        let b=simd.step(8,1./120.,V{x:0.,y:-9.81,z:0.},0.2,1.,0.001,10.,true);
        assert_eq!(a,b); assert_eq!(scalar.broken,simd.broken);
        for (a,b) in scalar.floats.iter().zip(&simd.floats) {close(a,b,1e-9);}
        close(&scalar.scalars,&simd.scalars,1e-9);
        close(&scalar.contact_stats,&simd.contact_stats,1e-9);
    }
    assert!(scalar.scalars[0]>0.,"fixture must exercise plastic work");
    assert!(scalar.broken.iter().any(|&v|v!=0),"fixture must exercise fracture");
    assert!(scalar.contact_stats[0]>0.,"fixture must exercise static contact");
}
