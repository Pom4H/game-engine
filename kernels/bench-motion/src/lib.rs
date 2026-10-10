//! Upstream webgl-engine-bench Sim3D motion kernel; production renderer unchanged.
//! https://github.com/KilledByAPixel/webgl-engine-bench (MIT).
use std::cell::RefCell;

const FIELDS: usize = 15;
const MAX_CAPACITY: usize = 300_000;
const DT: f64 = 1.0 / 60.0;

thread_local! {
    static STORAGE: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

/// Persistent SoA arrays: x y z vx vy vz rx ry rz sx sy sz r g b.
#[no_mangle]
pub extern "C" fn reserve(capacity: u32) -> u32 {
    let cap = capacity as usize;
    if cap == 0 || cap > MAX_CAPACITY { return 0; }
    STORAGE.with(|storage| {
        let mut data = storage.borrow_mut();
        data.resize(cap * FIELDS, 0.0);
        data.as_mut_ptr() as u32
    })
}

fn bounded_step(data: &mut [f32], capacity: usize, count: usize) {
    // JS typed-array writes round to f32, arithmetic runs in f64.
    for i in 0..count {
        for axis in 0..3 {
            let p = axis * capacity + i;
            let v = (axis + 3) * capacity + i;
            let boundary = match axis { 0 => 28.0, 1 => 15.0, _ => 0.0 };
            let min = if axis == 2 { -20.0 } else { -boundary };
            let max = if axis == 2 { 8.0 } else { boundary };
            let next = (data[p] as f64 + data[v] as f64 * DT) as f32;
            if next < min {
                data[p] = min;
                data[v] = -data[v];
            } else if next > max {
                data[p] = max;
                data[v] = -data[v];
            } else { data[p] = next; }
            let rotation = (axis + 6) * capacity + i;
            let spin = (axis + 9) * capacity + i;
            data[rotation] = (data[rotation] as f64 + data[spin] as f64 * DT) as f32;
        }
    }
}
#[no_mangle]
pub extern "C" fn step(count: u32) -> u32 {
    STORAGE.with(|storage| {
        let mut data = storage.borrow_mut();
        let capacity = data.len() / FIELDS;
        if capacity == 0 || count as usize > capacity { return 0; }
        bounded_step(&mut data, capacity, count as usize);
        1
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn walls_reflect_and_tints_do_not_change() {
        let mut arr = vec![0.0; 15 * 2];
        arr[0] = 27.99;
        arr[3 * 2] = 4.0;
        arr[12 * 2] = 0.8;
        bounded_step(&mut arr, 2, 1);
        assert_eq!(arr[0], 28.0);
        assert_eq!(arr[6], -4.0);
        assert_eq!(arr[24], 0.8);
    }
    #[test]
    fn rejected_capacities() {
        assert_eq!(reserve(0), 0);
        assert_eq!(reserve((MAX_CAPACITY + 1) as u32), 0);
    }
}
