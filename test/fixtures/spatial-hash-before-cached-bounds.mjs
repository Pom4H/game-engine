// Frozen complete implementation before the numeric cached-bounds shortcut.
// Source SHA256 cab53a0f49a8125cc42a62a738bb00f64132b45839859f9c8f7ddd2437640c98.
export const SPATIAL_QUERY_CAPACITY = 128, SPATIAL_QUERY_REFERENCES = 16384, SPATIAL_MAX_ITEM_CELLS = 64;
function defaultRadius(item) {
  const width = "w" in item && typeof item.w === "number" ? item.w : 1, length = "l" in item && typeof item.l === "number" ? item.l : 1;
  return Math.hypot(width, length) / 2;
}

export class SpatialHash {
  size;
  options;
  buckets = new Map;
  memberships = new WeakMap;
  oversized = new Map;
  queries = new Map;
  cachedReferences = 0;
  cacheHits = 0;
  cacheMisses = 0;
  batchDepth = 0;
  batchDirty = !1;
  orderBounds = new WeakMap;
  nextSerial = 0;
  constructor(size = 32, options = {}) {
    this.size = size;
    this.options = options;
    if (!Number.isFinite(size) || size <= 0)
      throw RangeError("Spatial cell size must be positive and finite");
  }
  add(item, radius = defaultRadius(item)) {
    this.validate(item.x, item.z, radius);
    this.remove(item);
    const minX = Math.floor((item.x - radius) / this.size), maxX = Math.floor((item.x + radius) / this.size), minZ = Math.floor((item.z - radius) / this.size), maxZ = Math.floor((item.z + radius) / this.size);
    if (this.options.cellOrder)
      this.orderBounds.set(item, { minX, minZ, serial: ++this.nextSerial });
    const width = maxX - minX + 1, height = maxZ - minZ + 1;
    if (width > SPATIAL_MAX_ITEM_CELLS / height) {
      this.oversized.set(item, { minX, maxX, minZ, maxZ });
      this.invalidateQueries();
      return;
    }
    const keys = [];
    for (let x = minX;x <= maxX; x++)
      for (let z = minZ;z <= maxZ; z++) {
        const key = `${x},${z}`;
        let bucket = this.buckets.get(key);
        if (!bucket)
          this.buckets.set(key, bucket = []);
        bucket.push(item);
        keys.push(key);
      }
    this.memberships.set(item, keys);
    this.invalidateQueries();
  }
  remove(item) {
    if (this.oversized.delete(item)) {
      this.invalidateQueries();
      return !0;
    }
    const keys = this.memberships.get(item);
    if (!keys)
      return !1;
    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (!bucket)
        continue;
      const i = bucket.indexOf(item);
      if (i >= 0)
        bucket.splice(i, 1);
      if (!bucket.length)
        this.buckets.delete(key);
    }
    this.memberships.delete(item);
    this.invalidateQueries();
    return !0;
  }
  clear() {
    this.buckets.clear();
    this.oversized.clear();
    this.memberships = new WeakMap;
    this.orderBounds = new WeakMap;
    this.nextSerial = 0;
    this.invalidateQueries();
  }
  near(x, z, radius = 8, out, orderRadius = radius) {
    const source = this.#querySource(x, z, radius, orderRadius);
    if (!out)
      return source.slice();
    out.length = 0;
    for (const item of source)
      out.push(item);
    return out;
  }
  nearOwned(x, z, radius, out, orderRadius = radius) {
    const near = this.near;
    if (near !== nativeNear)
      return Reflect.apply(near, this, [x, z, radius, out, orderRadius]);
    const source = this.#querySource(x, z, radius, orderRadius);
    for (let i = 0;i < source.length; i++)
      out[i] = source[i];
    out.length = source.length;
    return out;
  }
  #querySource(x, z, radius, orderRadius) {
    this.validate(x, z, radius);
    if (orderRadius !== radius) {
      this.validate(x, z, orderRadius);
      if (orderRadius < radius)
        throw RangeError("Order radius must enclose the query");
      if (!this.options.cellOrder)
        throw Error("Enclosing query order requires cellOrder");
    }
    const minX = Math.floor((x - radius) / this.size), maxX = Math.floor((x + radius) / this.size), minZ = Math.floor((z - radius) / this.size), maxZ = Math.floor((z + radius) / this.size), orderMinX = orderRadius === radius ? minX : Math.floor((x - orderRadius) / this.size), orderMinZ = orderRadius === radius ? minZ : Math.floor((z - orderRadius) / this.size), reorder = orderMinX !== minX || orderMinZ !== minZ, appendOversized = (result) => {
      for (const [item, bounds] of this.oversized)
        if (bounds.minX <= maxX && bounds.maxX >= minX && bounds.minZ <= maxZ && bounds.maxZ >= minZ)
          result.push(item);
      if (this.options.cellOrder && (this.oversized.size || reorder))
        result.sort((a, b) => {
          const A = this.orderBounds.get(a), B = this.orderBounds.get(b);
          return Math.max(A.minX, orderMinX) - Math.max(B.minX, orderMinX) || Math.max(A.minZ, orderMinZ) - Math.max(B.minZ, orderMinZ) || A.serial - B.serial;
        });
      return result;
    };
    if (minX === maxX && minZ === maxZ && !this.oversized.size && !reorder)
      return this.buckets.get(`${minX},${minZ}`) ?? [];
    const key = `${minX},${minZ}:${maxX},${maxZ}${reorder ? "@" + orderMinX + "," + orderMinZ : ""}`, cached = this.queries.get(key);
    if (cached) {
      this.cacheHits++;
      return cached;
    }
    this.cacheMisses++;
    const seen = new Set;
    for (let ix = minX;ix <= maxX; ix++)
      for (let iz = minZ;iz <= maxZ; iz++) {
        const bucket = this.buckets.get(`${ix},${iz}`);
        if (bucket)
          for (const item of bucket)
            seen.add(item);
      }
    const result = appendOversized([...seen]);
    if (result.length <= SPATIAL_QUERY_REFERENCES) {
      while (this.queries.size >= SPATIAL_QUERY_CAPACITY || this.cachedReferences + result.length > SPATIAL_QUERY_REFERENCES) {
        const oldest = this.queries.keys().next().value;
        if (oldest === void 0)
          break;
        this.cachedReferences -= this.queries.get(oldest)?.length ?? 0;
        this.queries.delete(oldest);
      }
      this.queries.set(key, result.slice());
      this.cachedReferences += result.length;
    }
    return result;
  }
  beginBatch() {
    this.batchDepth++;
  }
  endBatch() {
    if (this.batchDepth > 0)
      this.batchDepth--;
    if (this.batchDepth === 0 && this.batchDirty)
      this.invalidateQueries();
  }
  get diagnostics() {
    return { cells: this.buckets.size, oversizedItems: this.oversized.size, cachedQueries: this.queries.size, cachedReferences: this.cachedReferences, cacheHits: this.cacheHits, cacheMisses: this.cacheMisses };
  }
  validate(x, z, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0)
      throw RangeError("Spatial bounds must be finite with a non-negative radius");
    if ((Math.max(Math.abs(x), Math.abs(z)) + radius) / this.size > Number.MAX_SAFE_INTEGER)
      throw RangeError("Spatial coordinates exceed safe integer precision");
  }
  invalidateQueries() {
    if (this.batchDepth > 0) {
      this.batchDirty = !0;
      return;
    }
    this.queries.clear();
    this.cachedReferences = 0;
    this.batchDirty = !1;
  }
}
const nativeNear = SpatialHash.prototype.near;
