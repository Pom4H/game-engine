/** Optional numerical backend; importing this does not replace Scene ownership. */
export {createRustKernelRuntime,RustKernelRuntime,RustKernelBatch,RustKernelPass,RustKernelLayout} from './runtime/rust-kernels.js';
export type {RustBatchConfig,RustBatchBuffers} from './runtime/rust-kernels.js';
