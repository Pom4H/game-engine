//! Experimental order-preserving XPBD distance pair, not a second solver.
//! All writes target the existing authoritative position/lambda slices.
//! No allocations, topology cache, graph reordering, approximate reciprocal,
//! relaxed SIMD or FMA. A rejected pair has no side effects.

pub const AVAILABLE: bool = cfg!(any(
    target_arch = "x86_64",
    all(target_arch = "wasm32", target_feature = "simd128")
));

#[cfg(target_arch = "x86_64")]
mod vector {
    use std::arch::x86_64::*;
    #[derive(Clone, Copy)]
    pub struct Pair(__m128d);
    impl Pair {
        #[inline(always)]
        pub fn new(a: [f64; 2]) -> Self {
            // SAFETY: SSE2 is part of the x86_64 baseline; no optional ISA.
            Self(unsafe { _mm_set_pd(a[1], a[0]) })
        }
        #[inline(always)]
        pub fn lanes(self) -> [f64; 2] {
            let mut out = [0.0; 2];
            // SAFETY: two writable f64 values; storeu has no alignment condition.
            unsafe { _mm_storeu_pd(out.as_mut_ptr(), self.0) };
            out
        }
        #[inline(always)]
        pub fn sqrt(self) -> Self { Self(unsafe { _mm_sqrt_pd(self.0) }) }
    }
    macro_rules! op {
        ($trait:ident, $method:ident, $intrinsic:ident) => {
            impl std::ops::$trait for Pair {
                type Output = Self;
                #[inline(always)]
                fn $method(self, rhs: Self) -> Self {
                    // SAFETY: SSE2 is guaranteed on this target.
                    Self(unsafe { $intrinsic(self.0, rhs.0) })
                }
            }
        };
    }
    op!(Add, add, _mm_add_pd);
    op!(Sub, sub, _mm_sub_pd);
    op!(Mul, mul, _mm_mul_pd);
    op!(Div, div, _mm_div_pd);
    impl std::ops::Neg for Pair {
        type Output = Self;
        #[inline(always)]
        fn neg(self) -> Self {
            // Toggle signs, including signed zero, without a subtraction.
            Self(unsafe { _mm_xor_pd(self.0, _mm_set1_pd(-0.0)) })
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod vector {
    use std::arch::wasm32::*;
    #[derive(Clone, Copy)]
    pub struct Pair(v128);
    impl Pair {
        #[inline(always)]
        pub fn new(a: [f64; 2]) -> Self { Self(f64x2(a[0], a[1])) }
        #[inline(always)]
        pub fn lanes(self) -> [f64; 2] {
            [f64x2_extract_lane::<0>(self.0), f64x2_extract_lane::<1>(self.0)]
        }
        #[inline(always)]
        pub fn sqrt(self) -> Self { Self(f64x2_sqrt(self.0)) }
    }
    macro_rules! op {
        ($trait:ident, $method:ident, $intrinsic:ident) => {
            impl std::ops::$trait for Pair {
                type Output = Self;
                #[inline(always)]
                fn $method(self, rhs: Self) -> Self { Self($intrinsic(self.0, rhs.0)) }
            }
        };
    }
    op!(Add, add, f64x2_add);
    op!(Sub, sub, f64x2_sub);
    op!(Mul, mul, f64x2_mul);
    op!(Div, div, f64x2_div);
    impl std::ops::Neg for Pair {
        type Output = Self;
        #[inline(always)]
        fn neg(self) -> Self { Self(f64x2_neg(self.0)) }
    }
}

// Keeps the module portable; AVAILABLE=false means the existing solver is used.
#[cfg(not(any(target_arch = "x86_64", all(target_arch = "wasm32", target_feature = "simd128"))))]
mod vector {
    #[derive(Clone, Copy)]
    pub struct Pair([f64; 2]);
    impl Pair {
        #[inline(always)] pub fn new(a: [f64; 2]) -> Self { Self(a) }
        #[inline(always)] pub fn lanes(self) -> [f64; 2] { self.0 }
        #[inline(always)] pub fn sqrt(self) -> Self { Self(self.0.map(f64::sqrt)) }
    }
    macro_rules! op {
        ($trait:ident, $method:ident, $token:tt) => {
            impl std::ops::$trait for Pair {
                type Output = Self;
                #[inline(always)]
                fn $method(self, rhs: Self) -> Self {
                    Self([self.0[0] $token rhs.0[0], self.0[1] $token rhs.0[1]])
                }
            }
        };
    }
    op!(Add, add, +); op!(Sub, sub, -); op!(Mul, mul, *); op!(Div, div, /);
    impl std::ops::Neg for Pair {
        type Output = Self;
        #[inline(always)] fn neg(self) -> Self { Self([-self.0[0], -self.0[1]]) }
    }
}
use vector::Pair;

/// Attempt exactly two adjacent constraints, retaining Gauss-Seidel order.
/// `false` means no writes occurred: the caller must run its existing scalar path.
/// No topology is cached because host TypedArray views are externally mutable.
/// Different nodes are required even for zero-inverse-mass endpoints.
#[inline(always)]
#[allow(clippy::too_many_arguments)]
pub fn try_solve_pair(
    i: usize, p: &mut [f64], inverse: &[f64], kind: &[u8],
    ia: &[u16], ib: &[u16], broken: &[u8], rest: &[f64],
    compliance: &[f64], lambda: &mut [f64], dt: f64, thermal: f64,
) -> bool {
    if !AVAILABLE { return false; }
    let Some(j) = i.checked_add(1) else { return false; };
    if j >= kind.len() || j >= ia.len() || j >= ib.len() || j >= broken.len()
        || j >= rest.len() || j >= compliance.len() || j >= lambda.len()
        || kind[i] != 0 || kind[j] != 0 || broken[i] != 0 || broken[j] != 0 {
        return false;
    }
    let a = [ia[i] as usize, ia[j] as usize];
    let b = [ib[i] as usize, ib[j] as usize];
    if a[0] == b[0] || a[1] == b[1] || a[0] == a[1] || a[0] == b[1]
        || b[0] == a[1] || b[0] == b[1] {
        return false;
    }
    let max_node = a[0].max(a[1]).max(b[0]).max(b[1]);
    if max_node >= inverse.len() || max_node >= p.len() / 3 {
        return false;
    }
    if !dt.is_finite() || dt <= 0.0 || !thermal.is_finite() || thermal <= 0.0 {
        return false;
    }
    let pa = std::array::from_fn::<_, 3, _>(|axis|
        Pair::new([p[a[0] * 3 + axis], p[a[1] * 3 + axis]]));
    let pb = std::array::from_fn::<_, 3, _>(|axis|
        Pair::new([p[b[0] * 3 + axis], p[b[1] * 3 + axis]]));
    let d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    // Same association as the native reference. Unlike Math.hypot this is not
    // scaled; overflow/degenerate pairs fall back BEFORE any state is changed.
    let length = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
    if length.lanes().iter().any(|v| !v.is_finite() || *v < 1e-10) {
        return false;
    }
    let inv_a = Pair::new([inverse[a[0]], inverse[a[1]]]);
    let inv_b = Pair::new([inverse[b[0]], inverse[b[1]]]);
    let alpha = Pair::new([compliance[i], compliance[j]]) / Pair::new([dt * dt; 2]);
    let denom = inv_a + inv_b + alpha;
    if denom.lanes().iter().any(|v| !v.is_finite() || *v <= 1e-14) {
        return false;
    }
    let c = length - Pair::new([rest[i], rest[j]]) * Pair::new([thermal; 2]);
    let old_lambda = Pair::new([lambda[i], lambda[j]]);
    let dl = (-c - alpha * old_lambda) / denom;
    if dl.lanes().iter().any(|v| !v.is_finite()) { return false; }
    let wa = inv_a * dl;
    let wb = inv_b * dl;
    let new_lambda = (old_lambda + dl).lanes();
    // The two edges have disjoint endpoint sets. Packed evaluation therefore
    // observes exactly the same inputs as the original sequential two solves.
    for axis in 0..3 {
        let normal = d[axis] / length;
        let out_a = (pa[axis] - normal * wa).lanes();
        let out_b = (pb[axis] + normal * wb).lanes();
        p[a[0] * 3 + axis] = out_a[0]; p[a[1] * 3 + axis] = out_a[1];
        p[b[0] * 3 + axis] = out_b[0]; p[b[1] * 3 + axis] = out_b[1];
    }
    lambda[i] = new_lambda[0]; lambda[j] = new_lambda[1];
    true
}
