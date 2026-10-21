//! Distance-projection microbenchmark, NOT engine FPS or a complete physics step.
//! Compile the same source module that is used by the production opt-in path.
#[path = "../src/distance_batch.rs"]
mod distance_batch;
use std::{alloc::{GlobalAlloc, Layout, System}, hint::black_box,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering}, time::Instant};
static COUNTING: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);
struct Allocator;
unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {ALLOCATIONS.fetch_add(1, Ordering::Relaxed);}
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, p: *mut u8, layout: Layout) {System.dealloc(p, layout)}
    unsafe fn realloc(&self, p: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {ALLOCATIONS.fetch_add(1, Ordering::Relaxed);}
        System.realloc(p, layout, size)
    }
}
#[global_allocator]
static ALLOCATOR: Allocator = Allocator;

#[derive(Clone)]
pub struct Fixture {
    p: Vec<f64>, w: Vec<f64>, a: Vec<u16>, b: Vec<u16>, kind: Vec<u8>,
    broken: Vec<u8>, rest: Vec<f64>, compliance: Vec<f64>, lambda: Vec<f64>,
}
impl Fixture {
    fn new(chain: bool) -> Self {
        let m=512; let n=if chain {m+1} else {m*2};
        let mut p=vec![0.;n*3];
        for i in 0..n {
            p[i*3]=i as f64*1.1; p[i*3+1]=(i%7) as f64*0.03;
            p[i*3+2]=(i%3) as f64*0.07;
        }
        let a=(0..m).map(|i|if chain {i as u16} else {(i*2) as u16}).collect();
        let b=(0..m).map(|i|if chain {(i+1) as u16} else {(i*2+1) as u16}).collect();
        Self{p,w:vec![1.;n],a,b,kind:vec![0;m],broken:vec![0;m],
            rest:vec![1.;m],compliance:vec![1e-5;m],lambda:vec![0.;m]}
    }
    #[inline(always)]
    fn scalar(&mut self, i:usize) {
        if self.broken[i]!=0 {return;}
        let a=self.a[i] as usize; let b=self.b[i] as usize; let aa=a*3; let bb=b*3;
        let dx=self.p[bb]-self.p[aa]; let dy=self.p[bb+1]-self.p[aa+1]; let dz=self.p[bb+2]-self.p[aa+2];
        let len=(dx*dx+dy*dy+dz*dz).sqrt(); if len<1e-10 {return;}
        let dt=1./120.; let alpha=self.compliance[i]/(dt*dt);
        let denom=self.w[a]+self.w[b]+alpha; if denom<=1e-14 {return;}
        let dl=(-(len-self.rest[i])-alpha*self.lambda[i])/denom; self.lambda[i]+=dl;
        let wa=self.w[a]*dl; let wb=self.w[b]*dl;
        let normal=[dx/len,dy/len,dz/len];
        for axis in 0..3 {self.p[aa+axis]-=normal[axis]*wa; self.p[bb+axis]+=normal[axis]*wb;}
    }
}
// Stable assembly audit symbols. Neither function allocates.
#[no_mangle]
#[inline(never)]
pub fn structure_scalar_sweep(f:&mut Fixture) {
    for i in 0..f.a.len() {f.scalar(i);}
}
#[no_mangle]
#[inline(never)]
pub fn structure_simd_sweep(f:&mut Fixture) {
    let mut i=0;
    while i<f.a.len() {
        if distance_batch::try_solve_pair(i,&mut f.p,&f.w,&f.kind,&f.a,&f.b,
            &f.broken,&f.rest,&f.compliance,&mut f.lambda,1./120.,1.) {i+=2;}
        else {f.scalar(i);i+=1;}
    }
}
fn parity(seed:&Fixture) -> f64 {
    let mut a=seed.clone();let mut b=seed.clone();
    for _ in 0..64 {structure_scalar_sweep(&mut a);structure_simd_sweep(&mut b);}
    let mut max=0.0_f64;
    for (&x,&y) in a.p.iter().chain(&a.lambda).zip(b.p.iter().chain(&b.lambda)) {
        assert!(x.is_finite() && y.is_finite());
        assert!((x-y).abs()<=1e-11*(1.+x.abs().max(y.abs())),"parity failed: {x}, {y}");
        max=max.max((x-y).abs());
    }
    max
}
fn sample(seed:&Fixture, simd:bool) -> (f64,f64) {
    let mut f=seed.clone(); // allocation/reset excluded, identical for both paths
    let run=if simd {structure_simd_sweep} else {structure_scalar_sweep};
    ALLOCATIONS.store(0,Ordering::Relaxed);
    let start=Instant::now();
    COUNTING.store(true,Ordering::Relaxed);
    for _ in 0..512 {run(black_box(&mut f));}
    COUNTING.store(false,Ordering::Relaxed);
    let elapsed=start.elapsed().as_secs_f64()*1e9/(512.*f.a.len() as f64);
    assert_eq!(ALLOCATIONS.load(Ordering::Relaxed),0,"allocation in timed solver");
    (elapsed,black_box(f.p.iter().sum::<f64>()+f.lambda.iter().sum::<f64>()))
}
fn main() {
    if !distance_batch::AVAILABLE {eprintln!("No measured SIMD backend for this target");std::process::exit(2);}
    println!("scenario,mode,samples,p50_ns_per_constraint,p95_ns_per_constraint,max_abs_error,allocations_in_solve,checksum");
    for chain in [false,true] {
        let seed=Fixture::new(chain);let error=parity(&seed);
        let _=sample(&seed,false);let _=sample(&seed,true); // warm-up excluded
        let mut times=[Vec::with_capacity(19),Vec::with_capacity(19)];let mut checksum=[0.;2];
        for trial in 0..19 {
            for offset in 0..2 { // alternate order to reduce systematic bias
                let mode=(trial+offset)%2;let (ns,sum)=sample(&seed,mode==1);
                times[mode].push(ns);checksum[mode]=sum;
            }
        }
        for mode in 0..2 {
            times[mode].sort_by(f64::total_cmp);
            println!("{},{},19,{:.6},{:.6},{:.6e},0,{:.12e}",
                if chain {"dependent-chain"} else {"independent-pairs"},
                if mode==0 {"scalar"} else {"simd-attempt-with-fallback"},
                times[mode][9],times[mode][18],error,checksum[mode]);
        }
    }
}
