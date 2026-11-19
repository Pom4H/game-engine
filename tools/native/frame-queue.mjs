/** Bound submitted GPU frames without serializing every frame on completion. */
export class GPUFrameQueue {
  constructor(device, capacity = 2) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 2) throw new RangeError('GPU frame capacity must be 1 or 2');
    this.device = device; this.capacity = capacity; this.entries = []; this.failure = null; this.peak = 0; this.submitted = 0; this.waits = 0;
  }
  check() { if (this.failure) throw this.failure; }
  reap() { this.entries = this.entries.filter(entry => !entry.done); }
  async acquire() {
    this.check(); this.reap();
    while (this.entries.length >= this.capacity) { this.waits++; await this.entries[0].promise; this.check(); this.reap(); }
  }
  submittedFrame() {
    this.check(); this.reap();
    if (this.entries.length >= this.capacity) throw new Error('GPU frame queue exceeded its capacity');
    const entry = { done: false, promise: null };
    // Attach rejection immediately: device loss is surfaced at the next boundary.
    entry.promise = Promise.resolve(this.device.queue.onSubmittedWorkDone()).then(() => { entry.done = true; }, error => { entry.done = true; this.failure ??= error instanceof Error ? error : new Error(String(error)); });
    this.entries.push(entry); this.submitted++; this.peak = Math.max(this.peak, this.entries.length);
  }
  async drain() { await Promise.all(this.entries.map(entry => entry.promise)); this.reap(); this.check(); }
  inspect() { this.reap(); return { capacity: this.capacity, pending: this.entries.length, peak: this.peak, submitted: this.submitted, waits: this.waits }; }
}
