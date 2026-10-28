// Frozen pre-optimization renderer batching oracle (2026-10-18).
// It intentionally scans every temporal member on every call.
import {renderPrimitive} from '../../dist/render/frame.js';
import {InstanceStream,INSTANCE_FLOATS,CURRENT_INSTANCE_FLOATS} from '../../dist/render/gpu-visibility.js';
import {ShadowInstanceIndices} from '../../dist/render/instancing.js';
function canCullBack(entity){return ['box','sphere','cylinder','torus','polygon-prism'].includes(renderPrimitive(entity)?.kind);}
function materialCode(kind){return kind==='glass'?1:kind==='steel'?2:kind==='wood'?3:kind==='concrete'?4:kind==='asphalt'?5:kind==='snow'?6:kind==='rubber'?7:kind==='plastic'?8:kind==='aluminum'?9:kind==='mirror'?10:0;}
function stableSeed(value){let h=2166136261>>>0;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0)/4294967295;}
function surfaceUseCode(use){return use==='road'?1:use==='sidewalk'?2:use==='curb'?3:0;}
export function prepareCameraBatchesReference(entities, modelFor, changes) {
    if (!this.gpu.visibility)
      return [];
    const scene = this.lastScene, causes = this.cameraBatchCauses ??= [], surfacePresence = scene.renderSurfaceStatePresence;
    let rebuild = this.cameraBatchScene !== scene || causes.length !== entities.length;
    for (let index = 0;index < entities.length; index++) {
      const entity = entities[index], primitive = renderPrimitive(entity), material = entity.material, surfaceUse = surfaceUseCode(entity.environmental?.surfaceUse), eligible = entity.renderCameraVisible !== !1 && !!primitive && !material.texture && !material.label && !material.decal && !(surfacePresence ? surfacePresence(entity.id) : scene.surfaces.field?.(entity.id) || scene.surfaceStateForRender(entity.id) || scene.surfaces.body(entity.id)), cause = causes[index];
      if (!cause || cause.entity !== entity || cause.primitive !== primitive || cause.material !== material || cause.surfaceUse !== surfaceUse || cause.eligible !== eligible) {
        causes[index] = { entity, primitive, material, surfaceUse, eligible };
        rebuild = !0;
      }
    }
    causes.length = entities.length;
    if (rebuild) {
      this.cameraBatchScene = scene;
      this.cameraBatchPlanBuilds = (this.cameraBatchPlanBuilds ?? 0) + 1;
      const groups = new Map;
      for (const { entity, eligible } of causes) {
        if (!eligible)
          continue;
        let metadata = this.instanceMetadata.get(entity);
        if (!metadata || metadata.material !== entity.material) {
          let materialKey = this.materialBatchKeys.get(entity.material);
          if (materialKey === void 0) {
            const { color, variationSeed, ...shared } = entity.material;
            materialKey = JSON.stringify(shared);
            this.materialBatchKeys.set(entity.material, materialKey);
          }
          metadata = { material: entity.material, key: materialKey, weather: new Float32Array([entity.material.surface.dirt, entity.material.surface.wear, entity.material.variationSeed ?? stableSeed(entity.id), materialCode(entity.material.kind)]) };
          this.instanceMetadata.set(entity, metadata);
        }
        const mesh = this.mesh(renderPrimitive(entity)), culled = canCullBack(entity), key = mesh.key + "|" + Number(culled) + "|" + metadata.key + "|" + surfaceUseCode(entity.environmental?.surfaceUse);
        let group = groups.get(key);
        if (!group) {
          group = { items: [], mesh, code: materialCode(entity.material.kind), culled };
          groups.set(key, group);
        }
        group.items.push(entity);
      }
      const used = new Set, members = new Set, plans = [], instanceFloats = this.gpu.visibility.instanceFloats ?? INSTANCE_FLOATS, instanceBytes = instanceFloats * 4, maxCapacity = Math.min(Math.floor((this.device.limits?.maxStorageBufferBindingSize ?? 134217728) / instanceBytes), Math.floor((this.device.limits?.maxBufferSize ?? 268435456) / instanceBytes), (this.device.limits?.maxComputeWorkgroupsPerDimension ?? 65535) * 64);
      for (const [key, group] of groups) {
        if (group.items.length < 4 || group.items.length > maxCapacity)
          continue;
        used.add(key);
        let batch = this.cameraBatches.get(key);
        if (!batch || batch.stream.capacity < group.items.length) {
          batch?.visibility.destroy();
          batch?.reflection?.visibility.destroy();
          for (const view of Object.values(batch?.shadows ?? {}))
            view.destroy();
          batch?.buffer.destroy();
          let capacity = 1;
          while (capacity < group.items.length)
            capacity *= 2;
          capacity = Math.min(capacity, maxCapacity);
          const buffer = this.device.createBuffer({ label: "camera instance stream", size: capacity * instanceBytes, usage: 136 }), visibility = this.gpu.visibility.createBatch(buffer, capacity), bind = this.device.createBindGroup({ layout: this.gpu.instanceLayout, entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: visibility.visibleIndices } }] });
          batch = { buffer, stream: new InstanceStream(capacity, instanceFloats), visibility, bind, records: [], ...group };
          this.cameraBatches.set(key, batch);
          if ((this.pipelinePlan?.features.planarReflections ?? !0) && group.items[0].material.kind !== "snow" && group.items[0].material.kind !== "asphalt") {
            const reflectionVisibility = this.gpu.visibility.createBatch(buffer, capacity, "reflection"), reflectionBind = this.device.createBindGroup({ layout: this.gpu.instanceLayout, entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: reflectionVisibility.visibleIndices } }] });
            batch.reflection = { visibility: reflectionVisibility, bind: reflectionBind };
          }
        }
        batch.items = group.items;
        batch.mesh = group.mesh;
        batch.code = group.code;
        batch.culled = group.culled;
        for (const entity of group.items)
          members.add(entity.id);
        batch.records.length = group.items.length;
        plans.push(batch);
      }
      for (const [key, batch] of this.cameraBatches)
        if (!used.has(key)) {
          batch.visibility.destroy();
          batch.reflection?.visibility.destroy();
          for (const view of Object.values(batch.shadows ?? {}))
            view.destroy();
          batch.buffer.destroy();
          this.cameraBatches.delete(key);
        }
      this.cameraBatchMembers.clear();
      for (const id of members)
        this.cameraBatchMembers.add(id);
      this.cameraBatchLocations ??= new Map;
      this.cameraBatchLocations.clear();
      for (const batch of plans)
        batch.items.forEach((entity, index) => this.cameraBatchLocations.set(entity.id, { batch, index }));
      this.cameraBatchPlans = plans;
    }
    const changedOnly = !rebuild && changes !== void 0 && this.gpu.visibility.instanceFloats === CURRENT_INSTANCE_FLOATS;
    if (changedOnly)
      for (const { entity, model } of changes) {
        const location = this.cameraBatchLocations.get(entity.id);
        if (!location || location.batch.items[location.index] !== entity)
          continue;
        const { batch, index } = location;
        batch.stream.set(index, model, model, entity.material.color, this.instanceMetadata.get(entity).weather);
        const record = batch.records[index];
        if (record && record.entity === entity) {
          record.model = model;
          record.previous = model;
          record.material = entity.material;
        } else
          batch.records[index] = { entity, model, previous: model, material: entity.material };
      }
    for (const batch of this.cameraBatchPlans) {
      if (!changedOnly)
        for (let index = 0;index < batch.items.length; index++) {
          const entity = batch.items[index], model = modelFor(entity), previous = batch.stream.floats === CURRENT_INSTANCE_FLOATS ? model : this.previousModels.get(entity.id, entity) ?? model, record = batch.records[index];
          if (!record || record.entity !== entity || record.model !== model || record.previous !== previous || record.material !== entity.material) {
            batch.stream.set(index, model, previous, entity.material.color, this.instanceMetadata.get(entity).weather);
            if (record && record.entity === entity) {
              record.model = model;
              record.previous = previous;
              record.material = entity.material;
            } else
              batch.records[index] = { entity, model, previous, material: entity.material };
          }
        }
      this.profiler.addUpload(batch.stream.upload(this.device.queue, batch.buffer, batch.items.length), "instance");
    }
    return this.cameraBatchPlans;
  }

