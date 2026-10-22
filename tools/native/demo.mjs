/** Та же SceneSpec, которую можно передать BrowserRuntime. */
export const demo = {
  version: 1, seed: 42, gravity: [0, -9.81, 0], ground: 0,
  camera: { position: [7, 5, 9], target: [0, 1, 0], fov: 50 },
  rendering: { sunDirection: [-0.6, 0.8, 0.3], sunIntensity: 3, exposure: 1, shadowExtent: 18, fogDensity: 0.002 },
  entities: [
    { id: 'ground', mesh: { kind: 'box', size: [24, 0.2, 24] }, position: [0, -0.1, 0], material: { kind: 'concrete', color: [0.4, 0.42, 0.45, 1], roughness: 0.9 } },
    { id: 'falling-sphere', mesh: { kind: 'sphere', radius: 0.65, segments: 24 }, position: [0, 4, 0], material: { kind: 'steel', color: [0.9, 0.25, 0.08, 1], roughness: 0.25, metalness: 0.75 }, body: { mass: 4, shape: 'sphere', restitution: 0.65 } },
    { id: 'box', mesh: { kind: 'box', size: [1.5, 1.5, 1.5] }, position: [-2.5, 0.75, 0], rotation: [0, 0.35, 0], material: { kind: 'steel', color: [0.1, 0.45, 0.8, 1], roughness: 0.3, metalness: 0.6 } },
    { id: 'torus', mesh: { kind: 'torus', radius: 0.9, tube: 0.22, segments: 32 }, position: [2.5, 1.2, 0], rotation: [0.5, 0, 0], material: { kind: 'steel', color: [0.8, 0.65, 0.18, 1], roughness: 0.2, metalness: 0.9 } },
  ],
};
