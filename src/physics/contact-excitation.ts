import {contactModulus, plateMechanics, type ElasticMaterial, type PlateSection} from './material-mechanics.js';

/** Authoritative contact cause. Momentum in N*s, mass in kg, speed in m/s, area in m^2.
 * effectiveMass is the normal point-contact mass, including rotational inertia.
 */
export type ImpactContact = Readonly<{
  impulse: number; effectiveMass: number; speed: number; area: number;
}>;
export function validateImpactContact(c: ImpactContact): void {
  if (![c.impulse, c.effectiveMass, c.speed, c.area].every(Number.isFinite) ||
      c.impulse < 0 || c.effectiveMass < 0 || c.speed < 0 || c.area <= 0 ||
      (c.impulse > 0 && c.effectiveMass <= 0)) throw new RangeError('Invalid impact contact');
}
/** Strip support-only/bias-only impulses from the acoustic projection, NOT the solver.
 * 2*m*v is a conservative restitution<=1 bound, not an exact energy decomposition.
 */
export function impactFromSolver(impulse: number, inverseMass: number, speed: number): Omit<ImpactContact, 'area'> {
  if (![impulse, inverseMass, speed].every(Number.isFinite) || impulse <= 0 || inverseMass <= 0 || speed <= 0) {
    return {impulse: 0, effectiveMass: 0, speed: 0};
  }
  const effectiveMass = 1 / inverseMass;
  if (!Number.isFinite(effectiveMass)) return {impulse: 0, effectiveMass: 0, speed: 0};
  return {impulse: Math.min(impulse, 2 * effectiveMass * speed), effectiveMass, speed};
}
export type PanelExcitation = Readonly<{
  impulse: number; contactSeconds: number; availableEnergy: number; vibrationEnergy: number;
}>;
/** Work released by a constitutive solver, rather than an invented equivalent hit.
 * Nominal air/solid impedance transmission bounds the acoustic energy allocation.
 * This reduced radiation model is not calibrated sound pressure in Pa. */
export function panelWorkExcitation(p:PlateSection,workJ:number,seconds:number):PanelExcitation{
  const {mass}=plateMechanics(p);
  if(!Number.isFinite(workJ)||workJ<0||!Number.isFinite(seconds)||seconds<=0||seconds>1)throw new RangeError('Invalid constitutive work');
  const airImpedance=1.225*343,solidImpedance=Math.sqrt(p.density*p.young);
  const transmission=4*airImpedance*solidImpedance/(airImpedance+solidImpedance)**2;
  const vibrationEnergy=workJ*transmission;
  return {availableEnergy:workJ,vibrationEnergy,impulse:Math.sqrt(2*(mass/4)*vibrationEnergy),contactSeconds:seconds};
}
/** Bounded audio-rate contact approximation. Local plate/contact compliances are in series.
 * A footprint-sized bending span is a proxy, not a full hammer/panel/contact solve.
 * Contact duration is bounded for the reduced audio model, independent of game dt.
 * The 0.2% vibration allocation is an authored budget; output is not calibrated Pa.
 */
export function panelExcitation(p: PlateSection, other: ElasticMaterial, c: ImpactContact): PanelExcitation {
  validateImpactContact(c);
  const {mass, rigidity} = plateMechanics(p);
  const modulus = contactModulus(p, other);
  if (!c.impulse || !c.speed || !c.effectiveMass) {
    return {impulse: 0, contactSeconds: .001, availableEnergy: 0, vibrationEnergy: 0};
  }
  const radius = Math.sqrt(c.area / Math.PI);
  const span = Math.max(p.thickness * 4, Math.min(Math.min(p.width, p.height) * .35, radius * 2));
  const panelStiffness = 16 * Math.PI * rigidity / (span * span);
  const localStiffness = 2 * modulus * Math.max(p.thickness, radius);
  const stiffness = 1 / (1 / panelStiffness + 1 / localStiffness);
  const modalMass = mass / 4;
  const reducedMass = 1 / (1 / c.effectiveMass + 1 / modalMass);
  const contactSeconds = Math.max(.0004, Math.min(.03, Math.PI * Math.sqrt(reducedMass / stiffness)));
  const availableEnergy = .5 * c.effectiveMass * c.speed ** 2;
  const vibrationEnergy = .002 * Math.min(availableEnergy, c.impulse ** 2 / (2 * modalMass));
  const impulse = Math.sqrt(2 * modalMass * vibrationEnergy);
  if (![contactSeconds, availableEnergy, vibrationEnergy, impulse].every(Number.isFinite)) {
    throw new RangeError('Impact exceeds numeric range');
  }
  return {impulse, contactSeconds, availableEnergy, vibrationEnergy};
}
/** Per-sample MOMENTUM increments, not forces. Sum is exactly the requested impulse.
 * Closed Hann endpoints have zero value/slope: no impulse from an abrupt noise gate.
 */
export function contactPulse(impulse: number, seconds: number, rate: number): Float64Array {
  if (![impulse, seconds, rate].every(Number.isFinite) || impulse < 0 ||
      seconds <= 0 || seconds > 1 || rate < 8000 || rate > 192000) throw new RangeError('Invalid contact pulse');
  const count = Math.max(3, Math.ceil(seconds * rate) + 1), out = new Float64Array(count);
  let sum = 0;
  for (let i = 1; i < count - 1; i++) {const x = Math.sin(Math.PI * i / (count - 1)); out[i] = x * x; sum += out[i]!;}
  for (let i = 1; i < count - 1; i++) out[i] = out[i]! * impulse / sum;
  return out;
}

/** Sum a contact manifold within one physics frame. Hold its strongest complete
 * cause through later resting frames so a 20 Hz snapshot does not lose the onset.
 * Never pair an old impulse with the mass/speed of a different contact frame.
 */
export class ContactImpulseEnvelope {
  private at=-Infinity;
  private peakAt=-Infinity;
  private sum=0;
  private inverseWeighted=0;
  private speed=0;
  private area=.001;
  private px=0;private py=0;private pz=0;
  readonly peak={impulse:0,effectiveMass:0,speed:0,area:.001,point:[0,0,0] as [number,number,number]};
  reset(): void {
    this.at=-Infinity;this.peakAt=-Infinity;this.sum=0;this.inverseWeighted=0;this.speed=0;this.area=.001;
    this.peak.impulse=0;this.peak.effectiveMass=0;this.peak.speed=0;this.peak.area=.001;this.px=this.py=this.pz=0;this.peak.point.fill(0);
  }
  observe(impulse: number, inverseMass: number, speed: number, at: number, area: number, point: readonly number[]): void {
    if(!Number.isFinite(at)||!Number.isFinite(area)||area<=0||point.length!==3||!point.every(Number.isFinite))return;
    if(at!==this.at){this.at=at;this.sum=0;this.inverseWeighted=0;this.speed=0;this.area=.001;this.px=this.py=this.pz=0;}
    this.area=Math.max(this.area,area);
    const c=impactFromSolver(impulse,inverseMass,speed);
    if(c.impulse){this.sum+=c.impulse;this.inverseWeighted+=c.impulse*inverseMass;this.speed=Math.max(this.speed,c.speed);this.px+=c.impulse*point[0]!;this.py+=c.impulse*point[1]!;this.pz+=c.impulse*point[2]!;}
    if(this.sum>0&&(this.sum>this.peak.impulse||this.peakAt===at)){
      this.peakAt=at;this.peak.impulse=this.sum;this.peak.effectiveMass=this.sum/this.inverseWeighted;
      this.peak.speed=this.speed;this.peak.area=this.area;
      this.peak.point[0]=this.px/this.sum;this.peak.point[1]=this.py/this.sum;this.peak.point[2]=this.pz/this.sum;
    }
  }
}
