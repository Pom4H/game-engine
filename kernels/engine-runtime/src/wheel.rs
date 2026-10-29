//! Port of src/physics/wheel-contact.ts, retaining the 17-iteration bounded
//! implicit scalar solve. Independent wheels may be batched; contacts coupled
//! through a shared chassis must still be scheduled by their owning solver.
pub const INPUT_STRIDE: usize = 15;
pub const OUTPUT_STRIDE: usize = 7;

/// Input: dt,radius,inertia,omega,velocity,sideSlip,limit,drive,brake,
/// inverseSupportedMass,previousForce,previousSide,relaxation,longStiffness,sideStiffness.
/// Output: force,sideForce,speed,slip,brake,targetForce,targetSide.
pub fn solve(input: &[f64], out: &mut [f64]) {
    let (dt,radius,inertia,omega,velocity,side_slip,limit,drive,brake,inverse,
        previous_force,previous_side,relaxation,long_stiffness,side_stiffness)=
        (input[0],input[1],input[2],input[3],input[4],input[5],input[6],input[7],
         input[8],input[9],input[10],input[11],input[12],input[13],input[14]);
    let gain=radius*dt/inertia.max(1e-12);let brake_delta=brake*gain;
    let (mut lo,mut hi,mut f_lo,mut f_hi)=(-limit,limit,-2.0*limit,2.0*limit);
    let (mut force,mut target,mut side,mut slip,mut next)=(0.0,0.0,0.0,0.0,omega);
    for i in 0..=16 {
        force=if i==16 && f_hi>f_lo {lo+(hi-lo)*(-f_lo)/(f_hi-f_lo)}else{(lo+hi)*0.5};
        let free=omega+(drive-force)*gain;
        // f64::signum(0) is +1, unlike Math.sign(0); make that case explicit.
        let sign=if free>0.0 {1.0}else if free<0.0 {-1.0}else{0.0};
        next=sign*(free.abs()-brake_delta).max(0.0);
        let road=velocity+force*dt*inverse;let wheel=next*radius;
        slip=(wheel-road)/(1.25f64.max(road.abs()).max(wheel.abs()));
        let x=slip*long_stiffness;let y=side_slip*side_stiffness;
        let magnitude=x.hypot(y);
        let falloff=1.0-0.12*((magnitude-2.0)/8.0).clamp(0.0,1.0);
        let scale=limit*falloff/(1.0+x*x+y*y).sqrt();target=x*scale;side=y*scale;
        let residual=force-(previous_force+(target-previous_force)*relaxation);
        if residual.abs()<1e-7 {break;}
        if residual<0.0 {lo=force;f_lo=residual;}else{hi=force;f_hi=residual;}
    }
    let fy=previous_side+(side-previous_side)*relaxation;
    let lateral=(limit*limit-force*force).max(0.0).sqrt();
    out.copy_from_slice(&[force,fy.clamp(-lateral,lateral),if next==0.0{0.0}else{next},
        slip,(omega+(drive-force)*gain-next)/gain,target,side]);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stationary_wheel_has_no_force() {
        let mut out=[0.0;OUTPUT_STRIDE];
        solve(&[1.0/120.0,0.33,1.2,0.0,0.0,0.0,4000.0,0.0,0.0,0.001,0.0,0.0,1.0,12.0,9.5],&mut out);
        assert_eq!(out,[0.0;OUTPUT_STRIDE]);
    }
    #[test]
    fn friction_circle_is_respected() {
        let mut out=[0.0;OUTPUT_STRIDE];
        for omega in [-100.0,-2.0,0.0,20.0,200.0] {
            solve(&[1.0/120.0,0.33,1.2,omega,10.0,0.4,3000.0,500.0,300.0,0.001,0.0,0.0,0.25,12.0,9.5],&mut out);
            assert!(out.iter().all(|x|x.is_finite()));
            assert!(out[0]*out[0]+out[1]*out[1]<=3000.0*3000.0+1e-6);
        }
    }
}
