/** Nominal isotropic elastic properties in SI units, not calibrated manufacturer data.
 * Shape, thickness, mounting losses and structural-solver calibration are NOT materials.
 * Wood/masonry below are contact proxies; anisotropy and fracture are out of scope.
 */
export type ElasticMaterial = Readonly<{density: number; young: number; poisson: number}>;
const material = (density: number, young: number, poisson: number): ElasticMaterial =>
  Object.freeze({density, young, poisson});
export const ELASTIC_MATERIALS = Object.freeze({
  steel: material(7850, 200e9, .30),
  aluminium: material(2700, 69e9, .33),
  glass: material(2500, 70e9, .23),
  abs: material(1050, 2.1e9, .35),
  wood: material(650, 10e9, .30),
  masonry: material(2300, 30e9, .20),
  softContact: material(1000, 5e6, .45),
});
export type PlateSection = ElasticMaterial & Readonly<{
  width: number; height: number; thickness: number;
}>;
export function validateElasticMaterial(m: ElasticMaterial): void {
  if (![m.density, m.young, m.poisson].every(Number.isFinite) ||
      m.density <= 0 || m.young <= 0 || m.poisson <= -1 || m.poisson >= .5) {
    throw new RangeError('Invalid elastic material');
  }
}
/** Kirchhoff-Love, homogeneous isotropic flat plate. No mounting/shell correction. */
export function plateMechanics(p: PlateSection): {mass: number; rigidity: number; bend: number} {
  validateElasticMaterial(p);
  if (![p.width, p.height, p.thickness].every(Number.isFinite) ||
      p.width <= 0 || p.height <= 0 || p.thickness <= 0) {
    throw new RangeError('Invalid plate section');
  }
  const mass = p.width * p.height * p.thickness * p.density;
  const rigidity = p.young * p.thickness ** 3 / (12 * (1 - p.poisson ** 2));
  const bend = Math.sqrt(rigidity / (p.density * p.thickness));
  if (![mass, rigidity, bend].every(x => Number.isFinite(x) && x > 0)) {
    throw new RangeError('Plate section exceeds numeric range');
  }
  return {mass, rigidity, bend};
}
/** Effective elastic modulus of the contacting pair, in Pa. */
export function contactModulus(a: ElasticMaterial, b: ElasticMaterial): number {
  validateElasticMaterial(a); validateElasticMaterial(b);
  return 1 / ((1 - a.poisson ** 2) / a.young + (1 - b.poisson ** 2) / b.young);
}
