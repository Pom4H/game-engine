// Frozen production implementation before identity-retained pass membership (0437d2c5). Only import paths changed.
import { multiply4Into } from '../../dist/math.js';
import { renderPrimitive } from '../../dist/render/frame.js';
import { intersectsClip } from '../../dist/render/visibility.js';
import { MAX_SURFACE_DISPLACEMENT_M } from '../../dist/environment/deformable-surface.js';
const CAMERA_OPAQUE = 1, CAMERA_TRANSPARENT = 2, REFLECTION = 4, STATIC_SHADOW = 8, DYNAMIC_SHADOW = 16, ALL = 31;
export function castsRenderShadow(entity) {
    const emission = entity.material.emissive;
    return entity.material.color[3] >= .98 && entity.material.groundCover !== 'grass-blade' && !entity.material.decal && !(emission && Math.max(...emission) > 1);
}
const sameMatrix = (a, b) => a !== null && a.every((value, index) => value === b[index]);
const staticRoles = (roles, mover) => roles & (mover ? STATIC_SHADOW : ALL ^ DYNAMIC_SHADOW);
/** A pass owns only its current candidates and latest static projection. View
 * matrices are copied: callers can reuse their uniform buffers in place. */
class VisibilityPass {
    role;
    statics = [];
    movers = [];
    visibleStatics = [];
    matrix = null;
    staticDirty = true;
    sourceBuilds = 0;
    staticBuilds = 0;
    tests = 0;
    lastTests = 0;
    scratch = new Float32Array(16);
    revision = 0;
    constructor(role) {
        this.role = role;
    }
    configure(entries, moverOrder) {
        const statics = [], movers = [];
        for (const entry of entries) {
            if (!(entry.roles & this.role))
                continue;
            const moving = this.role === DYNAMIC_SHADOW || (this.role !== STATIC_SHADOW && entry.mover);
            (moving ? movers : statics).push(entry);
        }
        movers.sort((a, b) => (moverOrder.get(a.entity.id) ?? -1) - (moverOrder.get(b.entity.id) ?? -1));
        if (statics.length !== this.statics.length || statics.some((entry, index) => entry !== this.statics[index]))
            this.staticDirty = true;
        this.statics = statics;
        this.movers = movers;
        this.sourceBuilds++;
    }
    invalidateStatics() { this.staticDirty = true; }
    project(matrix, boundsFor) {
        this.lastTests = 0;
        if (!sameMatrix(this.matrix, matrix)) {
            this.matrix = new Float32Array(matrix);
            this.staticDirty = true;
        }
        const displacement = { projection: matrix, worldY: MAX_SURFACE_DISPLACEMENT_M };
        const visible = (entry) => {
            this.lastTests++;
            this.tests++;
            multiply4Into(matrix, entry.model, this.scratch);
            return intersectsClip(boundsFor(entry.primitive), this.scratch, entry.deformed ? displacement : undefined);
        };
        if (this.staticDirty) {
            this.visibleStatics = this.statics.filter(visible).map(entry => entry.entity);
            this.staticDirty = false;
            this.staticBuilds++;
            this.revision++;
        }
        if (!this.movers.length)
            return this.visibleStatics;
        const result = this.visibleStatics.slice();
        for (const entry of this.movers)
            if (visible(entry))
                result.push(entry.entity);
        return result;
    }
    inspect() { return { staticCandidates: this.statics.length, movingCandidates: this.movers.length, sourceBuilds: this.sourceBuilds, staticBuilds: this.staticBuilds, tests: this.tests, lastTests: this.lastTests, revision: this.revision }; }
    clear() { this.statics = []; this.movers = []; this.visibleStatics = []; this.matrix = null; this.staticDirty = true; }
}
/** Compile membership once per relevant cause, then project independent views.
 * Camera motion cannot invalidate the light's static projection. Model identity
 * comes from RenderFrameCache; geometry and numeric material classification are
 * observed every frame, including direct edits and newly posed visual objects.
 * This is a renderer-owned projection, never a second physical world. */
export class RenderVisibilityPlan {
    scene = null;
    entries = [];
    entriesByEntity = new WeakMap();
    sourceBuilds = 0;
    moverIds = null;
    cameraOpaque = new VisibilityPass(CAMERA_OPAQUE);
    cameraTransparent = new VisibilityPass(CAMERA_TRANSPARENT);
    reflection = new VisibilityPass(REFLECTION);
    staticShadow = new VisibilityPass(STATIC_SHADOW);
    dynamicShadow = new VisibilityPass(DYNAMIC_SHADOW);
    passes = [this.cameraOpaque, this.cameraTransparent, this.reflection, this.staticShadow, this.dynamicShadow];
    prepare(scene, entities, movers, batches, modelFor, changes) {
        if (this.scene !== scene) {
            this.clear();
            this.scene = scene;
        }
        let membershipDirty = this.moverIds !== movers ? ALL ^ STATIC_SHADOW : 0, staticDirty = 0, index = 0;
        this.moverIds = movers;
        for (const entity of entities) {
            const primitive = renderPrimitive(entity);
            if (!primitive)
                continue;
            const existing = this.entries[index], model = changes !== undefined && existing?.entity === entity ? existing.model : modelFor(entity), mover = movers.has(entity.id), opaque = entity.material.color[3] >= .98, batched = batches.has(entity.id);
            const kind = entity.material.kind, emission = entity.material.emissive;
            const texture = entity.material.texture, heightUrl = texture?.heightUrl, reliefDepth = heightUrl ? texture?.heightScaleM ?? 0 : 0, reliefSize = heightUrl ? texture?.sizeM ?? 1 : 1;
            const castsShadow = castsRenderShadow(entity);
            const deformed = !!scene.surfaces.field?.(entity.id)?.deformation.hasStampedDeformation;
            // Stamped surface geometry keeps evolving without a model/mesh revision.
            // Move it out of the resident static map once; subsequent stamps and
            // relaxation then reach the dynamic map without redrawing other statics.
            const staticCaster = !mover && !deformed && (!entity.body || (!entity.body.kinematic && entity.body.invMass === 0));
            const roles = (batched || entity.renderCameraVisible === false ? 0 : opaque ? CAMERA_OPAQUE : CAMERA_TRANSPARENT) | (!batched && opaque && kind !== 'snow' && kind !== 'asphalt' ? REFLECTION : 0) | (castsShadow ? (staticCaster ? STATIC_SHADOW : DYNAMIC_SHADOW) : 0);
            let entry = this.entries[index++];
            if (!entry || entry.entity !== entity) {
                if (entry)
                    membershipDirty |= entry.roles;
                entry = { entity, primitive, model, roles, mover, deformed, heightUrl, reliefDepth, reliefSize };
                this.entries[index - 1] = entry;
                membershipDirty |= roles;
                this.entriesByEntity.set(entity, entry);
            }
            else {
                membershipDirty |= entry.roles ^ roles;
                if (entry.mover !== mover)
                    membershipDirty |= (entry.roles | roles) & (CAMERA_OPAQUE | CAMERA_TRANSPARENT | REFLECTION);
                if (entry.model !== model || entry.primitive !== primitive || entry.deformed !== deformed)
                    staticDirty |= staticRoles(entry.roles, entry.mover) | staticRoles(roles, mover);
                if (entry.heightUrl !== heightUrl || entry.reliefDepth !== reliefDepth || entry.reliefSize !== reliefSize)
                    staticDirty |= (entry.roles | roles) & STATIC_SHADOW;
                entry.primitive = primitive;
                entry.model = model;
                entry.roles = roles;
                entry.mover = mover;
                entry.deformed = deformed;
                entry.heightUrl = heightUrl;
                entry.reliefDepth = reliefDepth;
                entry.reliefSize = reliefSize;
            }
        }
        for (let i = index; i < this.entries.length; i++)
            membershipDirty |= this.entries[i].roles;
        this.entries.length = index;
        if (changes)
            for (const { entity, model } of changes) {
                const entry = this.entriesByEntity.get(entity);
                if (entry && entry.model !== model) {
                    staticDirty |= staticRoles(entry.roles, entry.mover);
                    entry.model = model;
                }
            }
        if (membershipDirty) {
            const order = new Map([...movers].map((id, index) => [id, index]));
            for (const pass of this.passes)
                if (pass.role & membershipDirty)
                    pass.configure(this.entries, order);
            this.sourceBuilds++;
        }
        for (const pass of this.passes)
            if (pass.role & staticDirty)
                pass.invalidateStatics();
    }
    project(views, position, boundsFor) {
        const distance = (entity) => (entity.position[0] - position[0]) ** 2 + (entity.position[1] - position[1]) ** 2 + (entity.position[2] - position[2]) ** 2;
        const cameraOpaque = this.cameraOpaque.project(views.camera, boundsFor).slice().sort((a, b) => distance(a) - distance(b));
        const cameraTransparent = this.cameraTransparent.project(views.camera, boundsFor).slice().sort((a, b) => distance(b) - distance(a));
        const reflectedObjects = views.reflection ? this.reflection.project(views.reflection, boundsFor) : [];
        const staticShadowDrawables = this.staticShadow.project(views.light, boundsFor), dynamicShadowDrawables = this.dynamicShadow.project(views.light, boundsFor);
        return { cameraOpaque, cameraTransparent, reflectedObjects, staticShadowDrawables, dynamicShadowDrawables, shadowRevision: this.staticShadow.revision };
    }
    inspect() { return { entries: this.entries.length, sourceBuilds: this.sourceBuilds, passes: { cameraOpaque: this.cameraOpaque.inspect(), cameraTransparent: this.cameraTransparent.inspect(), reflection: this.reflection.inspect(), staticShadow: this.staticShadow.inspect(), dynamicShadow: this.dynamicShadow.inspect() } }; }
    clear() { this.scene = null; this.entries = []; this.entriesByEntity = new WeakMap(); this.moverIds = null; for (const pass of this.passes)
        pass.clear(); }
}
//# sourceMappingURL=visibility-plan.js.map
