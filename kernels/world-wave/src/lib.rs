//! World acoustic FDTD kernel. No JS hooks, hidden coefficients, or step allocations.
//! Authoritative buffers are shared with JS as views into the Wasm linear memory.
//! Each wasm instance owns exactly one field; a second instance shares compiled code,
//! never the memory. Coordinates: x fastest, then y, then z; staggered velocity faces.
const MAX_CELLS: usize = 2_000_000;
const ROW_ALIGNMENT_BYTES: usize = 256;

struct Wave {
    nx: usize, ny: usize, nz: usize,
    pressure: Vec<f64>, vx: Vec<f64>, vy: Vec<f64>, vz: Vec<f64>,
    solid: Vec<u8>,
    // r32float 2D texture: X horizontal, Z vertical; Y is chosen on upload.
    // Bytes per row are padded to 256 for GPUQueue.writeTexture.
    staging: Vec<f32>,
    staging_stride_f32: usize,
}

impl Wave {
    fn create(nx: usize, ny: usize, nz: usize) -> Option<Self> {
        if nx < 2 || ny < 2 || nz < 2 { return None; }
        let cells = nx.checked_mul(ny)?.checked_mul(nz)?;
        if cells > MAX_CELLS { return None; }
        let xfaces = (nx + 1).checked_mul(ny)?.checked_mul(nz)?;
        let yfaces = nx.checked_mul(ny + 1)?.checked_mul(nz)?;
        let zfaces = nx.checked_mul(ny)?.checked_mul(nz + 1)?;
        let row_bytes = nx.checked_mul(4)?.checked_add(ROW_ALIGNMENT_BYTES - 1)?
            / ROW_ALIGNMENT_BYTES * ROW_ALIGNMENT_BYTES;
        let stride = row_bytes / 4;
        Some(Self {
            nx, ny, nz,
            pressure: vec![0.0; cells],
            vx: vec![0.0; xfaces], vy: vec![0.0; yfaces], vz: vec![0.0; zfaces],
            solid: vec![0; cells],
            staging: vec![0.0; stride.checked_mul(nz)?],
            staging_stride_f32: stride,
        })
    }

    /// Same leapfrog update and loop ordering as AcousticWaveField.step.
    /// velocity_scale = exp(-drag*dt) is computed in JS once, preserving the
    /// reference Math.exp contract across host implementations.
    fn step(&mut self, velocity_scale: f64, velocity_kick: f64, pressure_kick: f64) {
        let nx = self.nx;
        let ny = self.ny;
        let nz = self.nz;
        let nx1 = nx + 1;
        let ny1 = ny + 1;
        // X-face velocity: x=1..nx-1.
        for z in 0..nz {
            for y in 0..ny {
                for x in 1..nx {
                    let left = x - 1 + nx * (y + ny * z);
                    let right = left + 1;
                    let face = x + nx1 * (y + ny * z);
                    self.vx[face] = if self.solid[left] != 0 || self.solid[right] != 0 {
                        0.0
                    } else {
                        velocity_scale * self.vx[face] -
                            velocity_kick * (self.pressure[right] - self.pressure[left])
                    };
                }
            }
        }
        // Y-face velocity: y=1..ny-1.
        for z in 0..nz {
            for y in 1..ny {
                for x in 0..nx {
                    let below = x + nx * (y - 1 + ny * z);
                    let above = below + nx;
                    let face = x + nx * (y + ny1 * z);
                    self.vy[face] = if self.solid[below] != 0 || self.solid[above] != 0 {
                        0.0
                    } else {
                        velocity_scale * self.vy[face] -
                            velocity_kick * (self.pressure[above] - self.pressure[below])
                    };
                }
            }
        }
        // Z-face velocity: z=1..nz-1.
        for z in 1..nz {
            for y in 0..ny {
                for x in 0..nx {
                    let back = x + nx * (y + ny * (z - 1));
                    let front = back + nx * ny;
                    let face = x + nx * (y + ny * z);
                    self.vz[face] = if self.solid[back] != 0 || self.solid[front] != 0 {
                        0.0
                    } else {
                        velocity_scale * self.vz[face] -
                            velocity_kick * (self.pressure[front] - self.pressure[back])
                    };
                }
            }
        }
        // Pressure: fluid centres, no update in solid cells.
        for z in 0..nz {
            for y in 0..ny {
                for x in 0..nx {
                    let at = x + nx * (y + ny * z);
                    if self.solid[at] != 0 {
                        self.pressure[at] = 0.0;
                        continue;
                    }
                    let fx = x + nx1 * (y + ny * z);
                    let fy = x + nx * (y + ny1 * z);
                    let fz = at;
                    let div =
                        self.vx[fx + 1] - self.vx[fx] +
                        self.vy[fy + nx] - self.vy[fy] +
                        self.vz[fz + nx * ny] - self.vz[fz];
                    self.pressure[at] -= pressure_kick * div;
                }
            }
        }
    }

    fn pack_pressure_plane(&mut self, y: usize) -> bool {
        if y >= self.ny { return false; }
        let nx = self.nx;
        let ny = self.ny;
        for z in 0..self.nz {
            let start = z * self.staging_stride_f32;
            for x in 0..nx {
                let index = x + nx * (y + ny * z);
                self.staging[start + x] =
                    if self.solid[index] == 0 { self.pressure[index] as f32 } else { 0.0 };
            }
            // Padded texels are zeroed deterministically, including after edits.
            self.staging[start + nx..start + self.staging_stride_f32].fill(0.0);
        }
        true
    }
}

// Only exported on wasm32: raw pointers are 32-bit byte offsets in Wasm memory.
#[cfg(target_arch = "wasm32")]
mod abi {
    use super::Wave;
    #[no_mangle]
    pub extern "C" fn world_wave_new(nx: u32, ny: u32, nz: u32) -> u32 {
        Wave::create(nx as usize, ny as usize, nz as usize)
            .map(|wave| Box::into_raw(Box::new(wave)) as u32).unwrap_or(0)
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_free(handle: u32) {
        if handle != 0 { drop(Box::from_raw(handle as *mut Wave)); }
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_step(
        handle: u32, velocity_scale: f64, velocity_kick: f64, pressure_kick: f64,
    ) -> u32 {
        if handle == 0 || !velocity_scale.is_finite() || !velocity_kick.is_finite()
            || !pressure_kick.is_finite() { return 0; }
        let wave = &mut *(handle as *mut Wave);
        wave.step(velocity_scale, velocity_kick, pressure_kick);
        1
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_pressure(handle: u32) -> u32 {
        (&mut *(handle as *mut Wave)).pressure.as_mut_ptr() as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_vx(handle: u32) -> u32 {
        (&mut *(handle as *mut Wave)).vx.as_mut_ptr() as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_vy(handle: u32) -> u32 {
        (&mut *(handle as *mut Wave)).vy.as_mut_ptr() as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_vz(handle: u32) -> u32 {
        (&mut *(handle as *mut Wave)).vz.as_mut_ptr() as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_solid(handle: u32) -> u32 {
        (&mut *(handle as *mut Wave)).solid.as_mut_ptr() as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_pack_y(handle: u32, y: u32) -> u32 {
        let wave = &mut *(handle as *mut Wave);
        if !wave.pack_pressure_plane(y as usize) { return 0; }
        wave.staging.as_mut_ptr() as u32
    }
    #[no_mangle]
    pub unsafe extern "C" fn world_wave_stride_bytes(handle: u32) -> u32 {
        ((&*(handle as *mut Wave)).staging_stride_f32 * 4) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finite_wave_propagation_and_hard_wall() {
        let mut wave = Wave::create(9, 3, 3).unwrap();
        let at = |x: usize, y: usize, z: usize| x + 9 * (y + 3 * z);
        wave.pressure[at(2, 1, 1)] = 100.0;
        wave.step(1.0, 0.5, 0.5);
        assert!(wave.pressure[at(3, 1, 1)] > 0.0);
        assert_eq!(wave.pressure[at(4, 1, 1)], 0.0);
        for z in 0..3 { for y in 0..3 { wave.solid[at(5, y, z)] = 1; } }
        for _ in 0..12 { wave.step(1.0, 0.5, 0.5); }
        assert_eq!(wave.pressure[at(7, 1, 1)], 0.0);
    }
    #[test]
    fn gpu_plane_has_256_byte_row_alignment_and_correct_order() {
        let mut wave = Wave::create(11, 4, 5).unwrap();
        wave.pressure[3 + 11 * (2 + 4 * 4)] = 12.5;
        wave.solid[4 + 11 * (2 + 4 * 4)] = 1;
        wave.pressure[4 + 11 * (2 + 4 * 4)] = 20.0;
        assert!(wave.pack_pressure_plane(2));
        assert_eq!(wave.staging_stride_f32 * 4, 256);
        assert_eq!(wave.staging[4 * wave.staging_stride_f32 + 3], 12.5);
        assert_eq!(wave.staging[4 * wave.staging_stride_f32 + 4], 0.0);
        assert!(!wave.pack_pressure_plane(4));
    }
    #[test]
    fn reject_impossible_fields() {
        assert!(Wave::create(1, 2, 2).is_none());
        assert!(Wave::create(5000, 5000, 5000).is_none());
    }
}
