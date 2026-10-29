//! Ports of the checkpoint's geometry, not a substitute physical material law.
//! All positions and derivatives remain f64. Only GPU staging is f32.

// A scaled norm avoids overflow/underflow without importing Math.hypot.
// libm/JS rounding can differ by ulps; parity is tolerance-based, not bitwise.
fn norm3(x:f64,y:f64,z:f64)->f64 {
    let scale=x.abs().max(y.abs()).max(z.abs());
    if scale==0.0 {return 0.0;}
    let (a,b,c)=(x/scale,y/scale,z/scale);
    scale*(a*a+b*b+c*c).sqrt()
}

/// Signed hinge and its exact first derivative, following the convention in
/// src/physics/dihedral.ts (Tamstorf, Disney TR201307, 2013).
/// Degenerate hinges have no angle and a zero gradient. This is NOT a Hessian.
pub fn dihedral(p: &[f64], ids: &[u32], g: &mut [f64]) -> Option<f64> {
    debug_assert_eq!(ids.len(), 4);
    debug_assert_eq!(g.len(), 12);
    let (a, b, c, d) = (ids[0] as usize * 3, ids[1] as usize * 3,
        ids[2] as usize * 3, ids[3] as usize * 3);
    let (ex, ey, ez) = (p[b]-p[a], p[b+1]-p[a+1], p[b+2]-p[a+2]);
    let (cx, cy, cz) = (p[c]-p[a], p[c+1]-p[a+1], p[c+2]-p[a+2]);
    let (dx, dy, dz) = (p[d]-p[a], p[d+1]-p[a+1], p[d+2]-p[a+2]);
    let l2 = ex*ex+ey*ey+ez*ez;
    let (nx, ny, nz) = (ey*cz-ez*cy, ez*cx-ex*cz, ex*cy-ey*cx);
    let (mx, my, mz) = (dy*ez-dz*ey, dz*ex-dx*ez, dx*ey-dy*ex);
    let n = nx*nx+ny*ny+nz*nz;
    let m = mx*mx+my*my+mz*mz;
    if l2 <= 1e-24 || n <= 1e-24*l2 || m <= 1e-24*l2 {
        g.fill(0.0);
        return None;
    }
    let l = l2.sqrt();
    let s = (cx*ex+cy*ey+cz*ez)/l2;
    let t = (dx*ex+dy*ey+dz*ez)/l2;
    g[6]=-l*nx/n; g[7]=-l*ny/n; g[8]=-l*nz/n;
    g[9]=-l*mx/m; g[10]=-l*my/m; g[11]=-l*mz/m;
    for k in 0..3 {
        g[3+k]=-s*g[6+k]-t*g[9+k];
        g[k]=-g[3+k]-g[6+k]-g[9+k];
    }
    Some(((ex*(ny*mz-nz*my)+ey*(nz*mx-nx*mz)+ez*(nx*my-ny*mx))/l)
        .atan2(nx*mx+ny*my+nz*mz))
}

/// Sparse cage skinning. Loop/reduction order matches applyStructuralSkin.
/// The caller validates dimensions and indices BEFORE entering this kernel.
pub fn skin(rest: &[f64], node_rest: &[f64], position: &[f64],
            nodes: &[u32], weights: &[f64], influences: usize, out: &mut [f64]) {
    for (v, xyz) in out.chunks_exact_mut(3).enumerate() {
        let base = v*3;
        let (mut x, mut y, mut z) = (rest[base],rest[base+1],rest[base+2]);
        for slot in 0..influences {
            let link = v*influences+slot;
            let n = nodes[link] as usize*3;
            let w = weights[link];
            x+=(position[n]-node_rest[n])*w;
            y+=(position[n+1]-node_rest[n+1])*w;
            z+=(position[n+2]-node_rest[n+2])*w;
        }
        xyz.copy_from_slice(&[x,y,z]);
    }
}

/// Row: point[3], outward normal[3], radius, depth, mode.
/// mode 0 = reduced persistent dent (positive inward depth), matching
/// deformation.ts. mode 1 = signed elastic+plastic panel displacement,
/// matching interaction-physics.ts. These are geometry projections ONLY;
/// they neither create energy nor replace the authoritative contact solver.
pub const DENT_STRIDE: usize = 9;
pub fn dents(positions: &mut [f64], rows: &[f64]) {
    for xyz in positions.chunks_exact_mut(3) {
        for d in rows.chunks_exact(DENT_STRIDE) {
            let dx=xyz[0]-d[0]; let dy=xyz[1]-d[1]; let dz=xyz[2]-d[2];
            let axial=dx*d[3]+dy*d[4]+dz*d[5];
            let rx=dx-d[3]*axial; let ry=dy-d[4]*axial; let rz=dz-d[5]*axial;
            // Both TypeScript projections use Math.hypot; no host callback here.
            let r=norm3(rx,ry,rz);
            let (rc,ac,radial,axial_scale,depth)=if d[8]==0.0 {
                (1.55,1.15,2.6,3.4,-d[7])
            } else { (1.65,0.9,3.1,4.0,d[7]) };
            if r>d[6]*rc || axial.abs()>d[6]*ac {continue;}
            let q=r/d[6];
            let weight=(-radial*(q*q)).exp()*(-axial_scale*axial.abs()/d[6]).exp();
            let displacement=depth*weight;
            xyz[0]+=d[3]*displacement; xyz[1]+=d[4]*displacement; xyz[2]+=d[5]*displacement;
        }
    }
}

/// Area-weighted normals; triangle accumulation is sequential/deterministic.
/// Degenerate/isolated vertices receive a zero normal, never NaN.
pub fn normals(p: &[f64], triangles: &[u32], out: &mut [f64]) {
    out.fill(0.0);
    for t in triangles.chunks_exact(3) {
        let (a,b,c)=(t[0] as usize*3,t[1] as usize*3,t[2] as usize*3);
        let (ux,uy,uz)=(p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]);
        let (vx,vy,vz)=(p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]);
        let (nx,ny,nz)=(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
        for j in [a,b,c] {out[j]+=nx;out[j+1]+=ny;out[j+2]+=nz;}
    }
    for n in out.chunks_exact_mut(3) {
        let length=norm3(n[0],n[1],n[2]);
        if length>0.0 {n[0]/=length;n[1]/=length;n[2]/=length;}
    }
}

/// Packed position/normal stream, ready for one GPU writeBuffer operation.
pub fn pack(p: &[f64], n: &[f64], out: &mut [f32]) {
    for (v, dst) in out.chunks_exact_mut(6).enumerate() {
        for axis in 0..3 {dst[axis]=p[v*3+axis] as f32;dst[3+axis]=n[v*3+axis] as f32;}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scaled_norm_handles_extreme_finite_values() {
        assert_eq!(norm3(3.0,4.0,0.0),5.0);
        assert_eq!(norm3(0.0,0.0,0.0),0.0);
        assert!((norm3(1e200,1e200,0.0)/1e200-2.0f64.sqrt()).abs()<1e-14);
        assert!((norm3(1e-300,1e-300,0.0)/1e-300-2.0f64.sqrt()).abs()<1e-14);
    }
    #[test]
    fn hinge_derivative_matches_central_difference_and_translation_nullspace() {
        for z in [0.0,0.1,-0.3] {
            let p=[-0.5,0.0,0.0,0.5,0.0,0.0,0.1,0.7,z,-0.1,-0.8,0.2];
            let mut g=[0.0;12];dihedral(&p,&[0,1,2,3],&mut g).unwrap();
            for i in 0..12 {
                let mut plus=p;let mut minus=p;plus[i]+=1e-6;minus[i]-=1e-6;
                let mut scratch=[0.0;12];
                let a=dihedral(&plus,&[0,1,2,3],&mut scratch).unwrap();
                let b=dihedral(&minus,&[0,1,2,3],&mut scratch).unwrap();
                assert!(((a-b)/2e-6-g[i]).abs()<2e-8,"derivative {i}");
            }
            for k in 0..3 {assert!((g[k]+g[k+3]+g[k+6]+g[k+9]).abs()<1e-12);}
        }
    }
    #[test]
    fn collapsed_hinge_is_explicit() {
        let mut g=[1.0;12];assert_eq!(dihedral(&[0.0;12],&[0,1,2,3],&mut g),None);
        assert_eq!(g,[0.0;12]);
    }
    #[test]
    fn rigid_translation_survives_skinning() {
        let rest=[0.25,0.0,0.0];let nr=[0.0,0.0,0.0,1.0,0.0,0.0];
        let p=[3.0,2.0,-1.0,4.0,2.0,-1.0];let mut out=[0.0;3];
        skin(&rest,&nr,&p,&[0,1],&[0.75,0.25],2,&mut out);
        assert_eq!(out,[3.25,2.0,-1.0]);
    }
    #[test]
    fn dents_do_not_touch_distant_vertices_and_reduced_depth_is_inward() {
        let mut p=[0.0,0.0,0.0,10.0,0.0,0.0];
        dents(&mut p,&[0.0,0.0,0.0,0.0,1.0,0.0,1.0,0.2,0.0]);
        assert_eq!(p,[0.0,-0.2,0.0,10.0,0.0,0.0]);
    }
    #[test]
    fn normals_and_float_staging() {
        let p=[0.0,0.0,0.0,1.0,0.0,0.0,0.0,1.0,0.0];let mut n=[0.0;9];
        normals(&p,&[0,1,2],&mut n);assert_eq!(n,[0.0,0.0,1.0,0.0,0.0,1.0,0.0,0.0,1.0]);
        let mut out=[0.0f32;18];pack(&p,&n,&mut out);assert_eq!(&out[6..12],&[1.0,0.0,0.0,0.0,0.0,1.0]);
    }
}
