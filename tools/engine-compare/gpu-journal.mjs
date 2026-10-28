import {writeBufferBytes, emptyWork, mergeWork, requireHardware} from './metrics.mjs';

/** Benchmark-only WebGPU hooks. Every backend uses the same non-blocking timestamp
 * ring and transfer/draw accounting; renderer-specific profilers are disabled.
 * Work in render bundles is counted on executeBundles, including cached bundles. */
export function installGPUJournal(options={}) {
  const original = GPUAdapter.prototype.requestDevice;
  const journals = [];
  GPUAdapter.prototype.requestDevice = async function(descriptor = {}) {
    if (!this.features.has('timestamp-query')) throw new Error('Hardware GPU timestamps required');
    const requiredFeatures = [...new Set([...(descriptor.requiredFeatures ?? []), 'timestamp-query'])];
    const device = await original.call(this, {...descriptor, requiredFeatures});
    const adapter = this.info;
    const info = {vendor: adapter.vendor, architecture: adapter.architecture, device: adapter.device, description: adapter.description, isFallbackAdapter: this.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false};
    requireHardware(info);
    journals.push(new GPUJournal(device, info,options));
    return device;
  };
  return {journals, uninstall() { GPUAdapter.prototype.requestDevice = original; }};
}

export class GPUJournal {
  constructor(device, adapter,{cpuApiTimings=false,clock=()=>performance.now()}={}) {
    this.device = device;
    this.adapter = adapter;
    this.cpuApiTimings=cpuApiTimings;this.clock=clock;this.cpuApiStack=[];this.cpuApiMethods=new Set();
    this.active = null;
    this.pending = new Set();
    this.errors = [];
    this.errorCount = 0;
    this.bundles = new WeakMap();
    this.capacity = 256;
    this.slots = Array.from({length: 8}, () => ({
      busy: false,
      query: device.createQuerySet({type: 'timestamp', count: this.capacity}),
      resolve: device.createBuffer({size: this.capacity * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC}),
      read: device.createBuffer({size: this.capacity * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ}),
    }));
    this.nativeEncoder = device.createCommandEncoder.bind(device);
    this.nativeSubmit = device.queue.submit.bind(device.queue);
    this.hook(device.queue, 'writeBuffer', (original, args) => {
      if (this.active) {this.active.bufferUploadBytes += writeBufferBytes(args[2], args[3], args[4]);this.active.writeBufferCalls++;}
      return original(...args);
    });
    this.hook(device.queue, 'writeTexture', (original, args) => {
      if (this.active) this.active.textureUploadBytes += args[1].byteLength;
      return original(...args);
    });
    this.hook(device.queue, 'copyExternalImageToTexture', (original, args) => {
      const extent = args[2];
      if (this.active) this.active.externalImageEstimatedBytes += (extent.width ?? extent[0]) * (extent.height ?? extent[1] ?? 1) * 4;
      return original(...args);
    });
    this.hook(device.queue, 'submit', (original, args) => {
      if (this.active) this.active.submissions++;
      return original(...args);
    });
    this.hook(device, 'createCommandEncoder', (original, args) => this.wrapEncoder(original(...args)));
    this.hook(device, 'createRenderBundleEncoder', (original, args) => {
      const encoder = original(...args), work = emptyWork();
      this.wrapDraws(encoder, () => work);
      if(cpuApiTimings)for(const method of ['setPipeline','setBindGroup','setVertexBuffer','setIndexBuffer'])this.timeMethod(encoder,method);
      this.hook(encoder, 'finish', (finish, parameters) => {
        const bundle = finish(...parameters);
        this.bundles.set(bundle, {...work});
        return bundle;
      });
      return encoder;
    });
    if(cpuApiTimings){
      for(const method of ['createBuffer','createBindGroup','createBindGroupLayout','createPipelineLayout','createRenderPipeline','createComputePipeline'])this.timeMethod(device,method);
      if(typeof device.createTexture==='function')this.hook(device,'createTexture',(original,args)=>{const texture=original(...args);this.timeMethod(texture,'createView');return texture;});
    }
    device.addEventListener('uncapturederror', event => this.recordError(event.error.message));
    device.lost.then(info => {if (info.reason !== 'destroyed') this.recordError('Device lost: ' + info.message);});
  }

  recordError(message) {this.errorCount++;if (this.errors.length < 64) this.errors.push(String(message));}

  hook(object, method, wrap) {
    const native = object[method].bind(object),original=this.cpuApiTimings?(...args)=>this.timeNative(method,native,args):native;
    if(this.cpuApiTimings)this.cpuApiMethods.add(method);
    object[method] = (...args) => wrap(original, args);
  }

  timeNative(method,native,args){
    const frame=this.active;if(!frame)return native(...args);
    const entry={children:0};this.cpuApiStack.push(entry);const start=this.clock();
    try{return native(...args);}finally{
      const elapsed=this.clock()-start;this.cpuApiStack.pop();const parent=this.cpuApiStack.at(-1);if(parent)parent.children+=elapsed;
      const exclusive=Math.max(0,elapsed-entry.children),stats=frame.cpuApi.methods[method]??={calls:0,exclusiveMs:0,inclusiveMs:0,maxInclusiveMs:0};
      stats.calls++;stats.exclusiveMs+=exclusive;stats.inclusiveMs+=elapsed;stats.maxInclusiveMs=Math.max(stats.maxInclusiveMs,elapsed);frame.cpuApi.totalMs+=exclusive;
    }
  }
  timeMethod(object,method){if(typeof object[method]==='function')this.hook(object,method,(original,args)=>original(...args));}

  wrapDraws(encoder, getWork, passWork) {
    for (const method of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) {
      this.hook(encoder, method, (original, args) => {
        const work = getWork();
        if (work) {
          work.drawCalls++;
          if (method.endsWith('Indirect')) work.indirectDrawCalls++;
          else work.trianglesDirect += args[0] * (args[1] ?? 1) / 3;
          if (passWork) {
            passWork.drawCalls++;
            if (method.endsWith('Indirect')) passWork.indirectDrawCalls++;
            else passWork.trianglesDirect += args[0] * (args[1] ?? 1) / 3;
          }
        }
        return original(...args);
      });
    }
  }

  wrapEncoder(encoder) {
    if(this.cpuApiTimings)for(const method of ['finish','copyBufferToBuffer','copyTextureToBuffer','copyBufferToTexture','copyTextureToTexture','clearBuffer','resolveQuerySet'])this.timeMethod(encoder,method);
    for (const [method, kind] of [['beginRenderPass', 'render'], ['beginComputePass', 'compute']]) {
      this.hook(encoder, method, (original, args) => {
        const frame = this.active;
        const passWork = {kind, label: args[0]?.label ?? kind, ...emptyWork()};
        let descriptor = args[0] ?? {};
        if (frame) {
          if (frame.passes.length >= this.capacity / 2) throw new Error('GPU pass count exceeds the bounded timestamp capacity');
          frame.passes.push(passWork);
          if (descriptor.timestampWrites) throw new Error('Disable the renderer timestamp profiler before the common journal');
          if (frame.slot && frame.passes.length * 2 <= this.capacity) {
            const first = (frame.passes.length - 1) * 2;
            descriptor = {...descriptor, timestampWrites: {querySet: frame.slot.query, beginningOfPassWriteIndex: first, endOfPassWriteIndex: first + 1}};
          } else frame.timestampUnavailable = true;
        }
        const pass = original(descriptor);
        if (kind === 'render') {
          this.wrapDraws(pass, () => frame, passWork);
          this.hook(pass, 'executeBundles', (execute, parameters) => {
            // Copy iterables once: forwarding an exhausted iterator would change rendering.
            const bundles = [...parameters[0]];
            if (frame) for (const bundle of bundles) {
              const work = this.bundles.get(bundle);
              if (!work) throw new Error('Uninstrumented render bundle');
              mergeWork(frame, work);
              mergeWork(passWork, work);
            }
            return execute(bundles);
          });
        } else for (const dispatch of ['dispatchWorkgroups', 'dispatchWorkgroupsIndirect']) {
          this.hook(pass, dispatch, (execute, parameters) => {if (frame) {frame.dispatches++;passWork.dispatches++;}return execute(...parameters);});
        }
        if(this.cpuApiTimings)for(const method of ['setPipeline','setBindGroup','setVertexBuffer','setIndexBuffer','setViewport','setScissorRect','setBlendConstant','setStencilReference','end'])this.timeMethod(pass,method);
        return pass;
      });
    }
    return encoder;
  }

  beginFrame(index) {
    if (this.active) throw new Error('Overlapping journal frames');
    const slot = this.slots.find(slot => !slot.busy);
    if (slot) slot.busy = true;
    const frame = {index, slot, passes: [], ...emptyWork(), bufferUploadBytes: 0, writeBufferCalls: 0, textureUploadBytes: 0, externalImageEstimatedBytes: 0, submissions: 0, timestampUnavailable: !slot};
    if(this.cpuApiTimings)frame.cpuApi={totalMs:0,methods:{}};
    this.active = frame;
    return frame;
  }

  endFrame() {
    const frame = this.active;
    if (!frame) throw new Error('No active frame');
    this.active = null;
    const slot = frame.slot;
    delete frame.slot;
    if (!slot) return frame;
    if (!frame.passes.length || frame.timestampUnavailable) {slot.busy = false;return frame;}
    // Ordered after all renderer submissions, without fencing the next RAF frame.
    const encoder = this.nativeEncoder({label: 'common benchmark timestamps'}), count = frame.passes.length * 2;
    encoder.resolveQuerySet(slot.query, 0, count, slot.resolve, 0);
    encoder.copyBufferToBuffer(slot.resolve, 0, slot.read, 0, count * 8);
    this.nativeSubmit([encoder.finish()]);
    const promise = slot.read.mapAsync(GPUMapMode.READ).then(() => {
      const stamps = new BigUint64Array(slot.read.getMappedRange(0, count * 8));
      frame.gpuMs = 0;
      for (let n = 0; n < frame.passes.length; n++) {
        if (stamps[n * 2 + 1] < stamps[n * 2]) throw new Error('Invalid GPU timestamp ordering');
        frame.passes[n].gpuMs = Number(stamps[n * 2 + 1] - stamps[n * 2]) / 1e6;
        frame.gpuMs += frame.passes[n].gpuMs;
      }
    }).catch(error => this.recordError(error)).finally(() => {slot.read.unmap();slot.busy = false;this.pending.delete(promise);});
    this.pending.add(promise);
    return frame;
  }

  async flush() {await this.device.queue.onSubmittedWorkDone();await Promise.all([...this.pending]);if (this.errors.length) throw new Error(this.errors.join('\n') + (this.errorCount > this.errors.length ? '\nAdditional GPU errors: ' + (this.errorCount - this.errors.length) : ''));}
  async dispose() {await this.flush();for (const slot of this.slots) {slot.query.destroy();slot.resolve.destroy();slot.read.destroy();}}
}
