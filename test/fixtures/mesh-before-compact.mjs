// Frozen production mesh module before compactTriangleMesh; registry remains isolated.
export function meshVertexAttributes(mesh) {
    const count = mesh.vertices.length / 6, bytes = new Uint8Array(count * 16), floats = new Float32Array(bytes.buffer);
    if (mesh.uvs && (mesh.uvs.length !== count * 2 || !mesh.uvs.every(Number.isFinite))) throw new TypeError('Mesh requires finite UV pairs');
    if (mesh.variationSeeds && (mesh.variationSeeds.length !== count || !mesh.variationSeeds.every(Number.isFinite))) throw new TypeError('Mesh requires finite variation seeds');
    for(let i = 0; i < count; i++){
        const source = i * 4, target = i * 16;
        bytes[target] = mesh.colors[source];
        bytes[target + 1] = mesh.colors[source + 1];
        bytes[target + 2] = mesh.colors[source + 2];
        bytes[target + 3] = mesh.colors[source + 3];
        floats[i * 4 + 1] = mesh.uvs?.[i * 2] ?? (mesh.vertices[i * 6 + 5] < -.5 ? .5 - mesh.vertices[i * 6] : mesh.vertices[i * 6] + .5);
        floats[i * 4 + 2] = mesh.uvs?.[i * 2 + 1] ?? .5 - mesh.vertices[i * 6 + 1];
        floats[i * 4 + 3] = mesh.variationSeeds?.[i] ?? 0;
    }
    return bytes;
}
const primitiveKeys = new WeakMap();
const ownedFrozen = new WeakSet();
let dynamicPrimitiveId = 0;
export function primitiveKey(primitive) {
    return primitiveKeys.get(primitive) ?? JSON.stringify(primitive);
}
export function freezePrimitive(primitive, transient = false) {
    if (primitiveKeys.has(primitive)) return primitive;
    const freeze = (value)=>{
        if (!value || typeof value !== 'object' || ownedFrozen.has(value)) return;
        if (Array.isArray(value)) {
            for(let i = 0; i < value.length; i++){
                const child = value[i];
                if (child && typeof child === 'object') freeze(child);
            }
        } else for (const child of Object.values(value))freeze(child);
        Object.freeze(value);
        ownedFrozen.add(value);
    };
    freeze(primitive);
    primitiveKeys.set(primitive, transient ? 'dynamic:' + ++dynamicPrimitiveId : JSON.stringify(primitive));
    return primitive;
}
export function immutablePrimitive(primitive) {
    return primitiveKeys.has(primitive) ? primitive : freezePrimitive(structuredClone(primitive));
}
export function surfaceGridPrimitive(size, segmentsX, segmentsZ) {
    const nx = Math.max(1, Math.min(512, Math.round(segmentsX))), nz = Math.max(1, Math.min(256, Math.round(segmentsZ))), positions = [], normals = [], indices = [], y = size[1] / 2;
    for(let iz = 0; iz <= nz; iz++)for(let ix = 0; ix <= nx; ix++){
        positions.push((ix / nx - .5) * size[0], y, (iz / nz - .5) * size[2]);
        normals.push(0, 1, 0);
    }
    const row = nx + 1;
    for(let iz = 0; iz < nz; iz++)for(let ix = 0; ix < nx; ix++){
        const a = iz * row + ix, b = a + 1, c = a + row, d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
    return {
        kind: 'triangle-mesh',
        positions,
        normals,
        indices
    };
}
export function primitiveMesh(primitive) {
    if (primitive.kind === 'triangle-mesh') return {
        ...pack([
            ...primitive.positions
        ], [
            ...primitive.normals
        ], [
            ...primitive.indices
        ], primitive.colors ? [
            ...primitive.colors
        ] : undefined),
        ...primitive.uvs ? {
            uvs: Float32Array.from(primitive.uvs)
        } : {},
        ...primitive.variationSeeds ? {
            variationSeeds: Float32Array.from(primitive.variationSeeds)
        } : {}
    };
    if (primitive.kind === 'torus') return torusMesh(primitive.radius, primitive.tube, primitive.segments ?? 40);
    if (primitive.kind === 'cylinder') return cylinderMesh(primitive.radius, primitive.height, primitive.topRadius ?? primitive.radius, Math.round(primitive.segments ?? 20));
    if (primitive.kind === 'snowdrift') return snowDriftMesh(primitive.size, primitive.seed, primitive.segments ?? 56, primitive.continuous ?? false, primitive.offset ?? 0);
    if (primitive.kind === 'box') return boxMesh();
    if (primitive.kind === 'plane') return planeMesh();
    if (primitive.kind === 'shard') return shardMesh(primitive.axis ?? 2, primitive.skew ?? 0);
    if (primitive.kind === 'polygon-prism') return polygonPrismMesh(primitive.axis ?? 2, primitive.points, primitive.thickness);
    return sphereMesh(Math.max(6, Math.min(64, Math.round(primitive.segments ?? 20))));
}
function pack(positions, normals, indices, sourceColors) {
    const count = positions.length / 3, vertices = new Float32Array(count * 6), colors = new Uint8Array(count * 4);
    for(let i = 0; i < count; i++){
        vertices[i * 6] = positions[i * 3];
        vertices[i * 6 + 1] = positions[i * 3 + 1];
        vertices[i * 6 + 2] = positions[i * 3 + 2];
        vertices[i * 6 + 3] = normals[i * 3];
        vertices[i * 6 + 4] = normals[i * 3 + 1];
        vertices[i * 6 + 5] = normals[i * 3 + 2];
        for(let channel = 0; channel < 4; channel++)colors[i * 4 + channel] = Math.round(Math.max(0, Math.min(1, sourceColors?.[i * 4 + channel] ?? 1)) * 255);
    }
    const Index = count > 65535 ? Uint32Array : Uint16Array;
    return {
        vertices,
        colors,
        indices: new Index(indices),
        indexFormat: Index === Uint32Array ? 'uint32' : 'uint16'
    };
}
function boxMesh() {
    const p = [], n = [], i = [];
    const faces = [
        [
            [
                1,
                -1,
                -1,
                1,
                -1,
                1,
                1,
                1,
                1,
                1,
                1,
                -1
            ],
            [
                1,
                0,
                0
            ]
        ],
        [
            [
                -1,
                -1,
                1,
                -1,
                -1,
                -1,
                -1,
                1,
                -1,
                -1,
                1,
                1
            ],
            [
                -1,
                0,
                0
            ]
        ],
        [
            [
                -1,
                1,
                -1,
                1,
                1,
                -1,
                1,
                1,
                1,
                -1,
                1,
                1
            ],
            [
                0,
                1,
                0
            ]
        ],
        [
            [
                -1,
                -1,
                1,
                1,
                -1,
                1,
                1,
                -1,
                -1,
                -1,
                -1,
                -1
            ],
            [
                0,
                -1,
                0
            ]
        ],
        [
            [
                1,
                -1,
                1,
                -1,
                -1,
                1,
                -1,
                1,
                1,
                1,
                1,
                1
            ],
            [
                0,
                0,
                1
            ]
        ],
        [
            [
                -1,
                -1,
                -1,
                1,
                -1,
                -1,
                1,
                1,
                -1,
                -1,
                1,
                -1
            ],
            [
                0,
                0,
                -1
            ]
        ]
    ];
    for (const [verts, normal] of faces){
        const base = p.length / 3;
        for(let v = 0; v < 4; v++){
            p.push(verts[v * 3] * .5, verts[v * 3 + 1] * .5, verts[v * 3 + 2] * .5);
            n.push(...normal);
        }
        i.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    return pack(p, n, i);
}
function planeMesh() {
    return pack([
        -0.5,
        0,
        -0.5,
        0.5,
        0,
        -0.5,
        0.5,
        0,
        0.5,
        -0.5,
        0,
        0.5
    ], [
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0
    ], [
        0,
        2,
        1,
        0,
        3,
        2
    ]);
}
function shardMesh(axis, skew) {
    const s = Math.max(-.45, Math.min(.45, skew));
    const base = [
        [
            -.5,
            -.5,
            -.5
        ],
        [
            .5,
            -.5,
            -.5
        ],
        [
            s,
            .5,
            -.5
        ],
        [
            -.5,
            -.5,
            .5
        ],
        [
            .5,
            -.5,
            .5
        ],
        [
            s,
            .5,
            .5
        ]
    ];
    const map = (v)=>axis === 2 ? v : axis === 0 ? [
            v[2],
            v[1],
            v[0]
        ] : [
            v[0],
            v[2],
            v[1]
        ];
    const q = base.map(map), p = [], n = [], i = [];
    const face = (indices)=>{
        const a = q[indices[0]], b = q[indices[1]], c = q[indices[2]], ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, length = Math.hypot(nx, ny, nz) || 1, normal = [
            nx / length,
            ny / length,
            nz / length
        ];
        const offset = p.length / 3;
        for (const index of indices)p.push(...q[index]);
        for(let k = 0; k < indices.length; k++)n.push(...normal);
        if (indices.length === 3) i.push(offset, offset + 1, offset + 2);
        else i.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    };
    face([
        0,
        2,
        1
    ]);
    face([
        3,
        4,
        5
    ]);
    face([
        0,
        1,
        4,
        3
    ]);
    face([
        1,
        2,
        5,
        4
    ]);
    face([
        2,
        0,
        3,
        5
    ]);
    return pack(p, n, i);
}
function polygonPrismMesh(axis, points, thickness) {
    if (points.length < 3) throw new RangeError('polygon-prism requires at least 3 points');
    const depth = Math.max(.0005, thickness) / 2, map = (u, v, d)=>axis === 0 ? [
            d,
            u,
            v
        ] : axis === 1 ? [
            u,
            d,
            v
        ] : [
            u,
            v,
            d
        ];
    const p = [], n = [], i = [];
    const normalFor = (a, b, c)=>{
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2], nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
        return [
            nx / l,
            ny / l,
            nz / l
        ];
    };
    const area = points.reduce((sum, q, k)=>{
        const r = points[(k + 1) % points.length];
        return sum + q[0] * r[1] - r[0] * q[1];
    }, 0), sign = area >= 0 ? 1 : -1;
    const addFace = (verts, expected)=>{
        let normal = normalFor(verts[0], verts[1], verts[2]);
        if (normal.reduce((sum, v, k)=>sum + v * expected[k], 0) < 0) {
            verts.reverse();
            normal = normal.map((v)=>-v);
        }
        const base = p.length / 3;
        for (const v of verts){
            p.push(...v);
            n.push(...normal);
        }
        for(let k = 1; k < verts.length - 1; k++)i.push(base, base + k, base + k + 1);
    };
    const front = points.map((q)=>map(q[0], q[1], -depth)), back = points.map((q)=>map(q[0], q[1], depth));
    addFace([
        ...front
    ], map(0, 0, -1));
    addFace([
        ...back
    ], map(0, 0, 1));
    for(let k = 0; k < points.length; k++){
        const next = (k + 1) % points.length, a = points[k], b = points[next];
        addFace([
            front[k],
            front[next],
            back[next],
            back[k]
        ], map((b[1] - a[1]) * sign, -(b[0] - a[0]) * sign, 0));
    }
    return pack(p, n, i);
}
function sphereMesh(segments) {
    const p = [], n = [], idx = [], rings = Math.max(4, Math.floor(segments / 2));
    for(let y = 0; y <= rings; y++){
        const v = y / rings, theta = v * Math.PI, s = Math.sin(theta), c = Math.cos(theta);
        for(let x = 0; x <= segments; x++){
            const u = x / segments, phi = u * Math.PI * 2, nx = Math.cos(phi) * s, nz = Math.sin(phi) * s;
            p.push(nx * .5, c * .5, nz * .5);
            n.push(nx, c, nz);
        }
    }
    const row = segments + 1;
    for(let y = 0; y < rings; y++)for(let x = 0; x < segments; x++){
        const a = y * row + x, b = a + row;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    return pack(p, n, idx);
}
function cylinderMesh(radius, height, top, segments) {
    const p = [], n = [], indices = [], slope = (radius - top) / height;
    for(let k = 0; k <= segments; k++){
        const angle = k / segments * Math.PI * 2, x = Math.cos(angle), z = Math.sin(angle), l = Math.hypot(1, slope);
        p.push(x * radius, -height / 2, z * radius, x * top, height / 2, z * top);
        n.push(x / l, slope / l, z / l, x / l, slope / l, z / l);
        if (k < segments) {
            const a = k * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    for (const [y, r, sign] of [
        [
            -height / 2,
            radius,
            -1
        ],
        [
            height / 2,
            top,
            1
        ]
    ]){
        const center = p.length / 3;
        p.push(0, y, 0);
        n.push(0, sign, 0);
        for(let k = 0; k <= segments; k++){
            const a = k / segments * Math.PI * 2;
            p.push(Math.cos(a) * r, y, Math.sin(a) * r);
            n.push(0, sign, 0);
            if (k < segments) {
                if (sign < 0) indices.push(center, center + k + 1, center + k + 2);
                else indices.push(center, center + k + 2, center + k + 1);
            }
        }
    }
    return pack(p, n, indices);
}
export function snowDriftMesh(size, seed, segments = 56, continuous = false, offset = 0) {
    const nx = Math.max(8, Math.min(128, Math.round(segments))), nz = Math.min(128, Math.max(20, Math.round(nx * size[2] / size[0]))), p = [], n = [], indices = [];
    const phase = (seed >>> 0) % 10000 * .013;
    const lattice = (x, z)=>{
        let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
        h = Math.imul(h ^ h >>> 13, 1274126177);
        return ((h ^ h >>> 16) >>> 0) / 4294967295;
    };
    const noise = (x, z)=>{
        const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz, s = u * u * (3 - 2 * u), t = v * v * (3 - 2 * v);
        return (lattice(ix, iz) * (1 - s) + lattice(ix + 1, iz) * s) * (1 - t) + (lattice(ix, iz + 1) * (1 - s) + lattice(ix + 1, iz + 1) * s) * t;
    };
    const height = (u, v)=>{
        const x = u * size[0] + offset, z = v * size[2];
        const ridge = .12 * Math.sin(x * .93 + phase) + .055 * Math.sin(x * 2.83 - phase);
        const displaced = v + .13 * Math.sin(x * .43 + phase) * Math.max(0, 1 - 4 * v * v);
        const cross = Math.max(0, 1 - 4 * displaced * displaced);
        const ends = continuous ? 1 : Math.pow(Math.max(0, Math.sin(Math.PI * (u + .5))), .60);
        const drift = .48 + noise(x * .63 + phase, z * 1.2) * .44 + noise(x * 2.8, z * 3.3 + phase) * .27;
        const grain = (noise(x * 17.3 + phase, z * 21.8) - .5) * .025 + (noise(x * 6.4, z * 9.2 + phase) - .5) * .09;
        return Math.max(0, size[1] * (Math.pow(cross, 1.30 + .24 * Math.sin(x * .31 + phase)) * ends * drift * (1 + v * ridge * 2.0) + grain * cross));
    };
    const point = (u, v)=>{
        const x = u * size[0] + offset;
        const width = continuous ? .78 + noise(x * .87 + phase, 11) * .20 + noise(x * 2.53, 17) * .10 : Math.sqrt(Math.max(0, 1 - 4 * u * u)) * (.94 + noise(x * 3.7 + phase, 31) * .12);
        const shift = continuous ? (noise(x * .47 + phase, 29) - .5) * size[2] * .25 : 0;
        return [
            u * size[0],
            height(u, v),
            v * size[2] * width + shift
        ];
    };
    for(let iz = 0; iz <= nz; iz++)for(let ix = 0; ix <= nx; ix++){
        const u = ix / nx - .5, v = iz / nz - .5, e = .0005, at = point(u, v), a = point(u + e, v), b = point(u - e, v), c = point(u, v + e), d = point(u, v - e);
        const tx = [
            a[0] - b[0],
            a[1] - b[1],
            a[2] - b[2]
        ], tz = [
            c[0] - d[0],
            c[1] - d[1],
            c[2] - d[2]
        ];
        const normal = [
            tz[1] * tx[2] - tz[2] * tx[1],
            tz[2] * tx[0] - tz[0] * tx[2],
            tz[0] * tx[1] - tz[1] * tx[0]
        ], l = Math.hypot(...normal);
        p.push(...at);
        if (l < 1e-12) n.push(u < 0 ? -.96 : .96, .28, 0);
        else n.push(normal[0] / l, normal[1] / l, normal[2] / l);
        if (ix < nx && iz < nz) {
            const a = iz * (nx + 1) + ix, b = a + nx + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return pack(p, n, indices);
}
function torusMesh(radius, tube, segments) {
    const p = [], n = [], indices = [], rings = 16, steps = Math.round(segments);
    for(let i = 0; i <= steps; i++)for(let j = 0; j <= rings; j++){
        const u = i / steps * Math.PI * 2, v = j / rings * Math.PI * 2, x = Math.cos(u), z = Math.sin(u), c = Math.cos(v), s = Math.sin(v);
        p.push(x * (radius + tube * c), tube * s, z * (radius + tube * c));
        n.push(x * c, s, z * c);
        if (i < steps && j < rings) {
            const a = i * (rings + 1) + j, b = a + rings + 1;
            indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
    }
    return pack(p, n, indices);
}
