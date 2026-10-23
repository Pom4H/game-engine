import { compose } from '../../dist/math.js';
import { primitiveMesh } from '../../dist/procedural/mesh.js';
export function renderPrimitive(entity) { return entity.renderMesh ?? entity.mesh; }
export function renderProxyPrimitive(entity) { return entity.mesh; }
export function primitiveBaseScale(primitive) {
    if (!primitive)
        return [1, 1, 1];
    if (primitive.kind === 'box' || primitive.kind === 'shard') {
        const s = primitive.size ?? [1, 1, 1];
        return [s[0], s[1], s[2]];
    }
    if (primitive.kind === 'sphere') {
        const d = 2 * (primitive.radius ?? 1);
        return [d, d, d];
    }
    if (primitive.kind === 'plane')
        return [primitive.size?.[0] ?? 1, 1, primitive.size?.[1] ?? 1];
    return [1, 1, 1];
}
export function renderModel(entity) {
    const primitive = renderPrimitive(entity), base = primitiveBaseScale(primitive);
    return compose(entity.position, entity.rotation, [entity.scale[0] * base[0], entity.scale[1] * base[1], entity.scale[2] * base[2]]);
}
function buildFrame(scene, camera, primitiveFor, includeMeshes = false) {
    const objects = [], lights = [];
    for (const entity of scene.entities.values()) {
        if (entity.light)
            lights.push(entity);
        const primitive = primitiveFor(entity);
        if (!primitive)
            continue;
        const base = primitiveBaseScale(primitive), model = primitive === renderPrimitive(entity) ? renderModel(entity) : compose(entity.position, entity.rotation, [entity.scale[0] * base[0], entity.scale[1] * base[1], entity.scale[2] * base[2]]);
        objects.push({ entity, primitive, ...(includeMeshes ? { mesh: primitiveMesh(primitive) } : {}), model });
    }
    return { scene, camera, objects, objectsById: new Map(objects.map(object => [object.entity.id, object])), lights };
}
export function buildRenderFrame(scene, camera = scene.camera, options = {}) {
    return buildFrame(scene, camera, renderPrimitive, options.includeMeshes ?? false);
}
export function buildProxyRenderFrame(scene, camera = scene.camera, options = {}) {
    return buildFrame(scene, camera, renderProxyPrimitive, options.includeMeshes ?? false);
}
export function buildDormantRenderFrame(scene, camera = scene.camera) {
    return { scene, camera, objects: Object.freeze([]), objectsById: new Map(), lights: Object.freeze([]) };
}
/** Renderer-owned live projection. Pure buildRenderFrame snapshots stay independent;
 * this bounded working set reuses topology and replaces matrices only after motion. */
export class RenderFrameCache {
    scene = null;
    builder = null;
    entries = [];
    objects = [];
    objectsById = new Map();
    lights = [];
    builds = 0;
    modelUpdates = 0;
    build(scene, camera, builder = buildRenderFrame, observer) {
        try {
            observer?.begin(scene, builder === buildRenderFrame || builder === buildProxyRenderFrame);
            const result = this.buildProjection(scene, camera, builder, observer);
            observer?.end();
            return result;
        }
        catch (error) {
            observer?.abort();
            throw error;
        }
    }
    buildProjection(scene, camera, builder, observer) {
        if (builder !== buildRenderFrame && builder !== buildProxyRenderFrame && builder !== buildDormantRenderFrame) {
            this.clear();
            return builder(scene, camera);
        }
        if (this.scene !== scene || this.builder !== builder) {
            this.clear();
            this.scene = scene;
            this.builder = builder;
        }
        const primitiveFor = builder === buildProxyRenderFrame ? renderProxyPrimitive : renderPrimitive;
        let index = 0, lightIndex = 0, topologyChanged = false;
        if (builder !== buildDormantRenderFrame)
            for (const entity of scene.entities.values()) {
                if (entity.light)
                    this.lights[lightIndex++] = entity;
                const primitive = primitiveFor(entity);
                if (!primitive)
                    continue;
                let entry = this.entries[index];
                if (!entry || entry.entity !== entity || entry.primitive !== primitive) {
                    entry = { entity, primitive, base: primitiveBaseScale(primitive), pose: new Float64Array(9).fill(NaN), object: null };
                    this.entries[index] = entry;
                    topologyChanged = true;
                }
                const p = entity.position, r = entity.rotation, s = entity.scale, pose = entry.pose;
                if (pose[0] !== p[0] || pose[1] !== p[1] || pose[2] !== p[2] || pose[3] !== r[0] || pose[4] !== r[1] || pose[5] !== r[2] || pose[6] !== s[0] || pose[7] !== s[1] || pose[8] !== s[2]) {
                    pose.set(p, 0);
                    pose.set(r, 3);
                    pose.set(s, 6);
                    entry.object = { entity, primitive, model: compose(p, r, [s[0] * entry.base[0], s[1] * entry.base[1], s[2] * entry.base[2]]) };
                    this.modelUpdates++;
                    this.objectsById.set(entity.id, entry.object);
                }
                this.objects[index++] = entry.object;
                observer?.observe(entity, entry.object.model);
            }
        if (this.entries.length !== index)
            topologyChanged = true;
        this.entries.length = index;
        this.objects.length = index;
        this.lights.length = lightIndex;
        if (topologyChanged) {
            this.objectsById.clear();
            for (const object of this.objects)
                this.objectsById.set(object.entity.id, object);
            this.builds++;
        }
        return { scene, camera, objects: this.objects, objectsById: this.objectsById, lights: this.lights };
    }
    inspect() { return { entries: this.entries.length, lights: this.lights.length, builds: this.builds, modelUpdates: this.modelUpdates }; }
    clear() { this.scene = null; this.builder = null; this.entries.length = 0; this.objects.length = 0; this.objectsById.clear(); this.lights.length = 0; }
}
//# sourceMappingURL=frame.js.map