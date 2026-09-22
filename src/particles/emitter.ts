import type {MutableVec3,Vec3} from '../math.js';

export interface Particle{readonly id:number;readonly position:MutableVec3;readonly velocity:MutableVec3;age:number;readonly lifetime:number;readonly size:number}
export interface ParticleSpawn{readonly position:Vec3;readonly velocity:Vec3;readonly lifetime:number;readonly size?:number}
export class ParticleEmitter{
  private readonly particles:Particle[]=[];private sequence=0;
  constructor(readonly capacity=2048){if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid particle capacity');}
  spawn(spec:ParticleSpawn):Particle|undefined{
    if(!spec.position.every(Number.isFinite)||!spec.velocity.every(Number.isFinite)||!Number.isFinite(spec.lifetime)||spec.lifetime<=0||!Number.isFinite(spec.size??1)||(spec.size??1)<=0)throw new RangeError('Invalid particle spawn');
    if(this.particles.length>=this.capacity)return undefined;
    const particle:Particle={id:++this.sequence,position:[...spec.position] as MutableVec3,velocity:[...spec.velocity] as MutableVec3,age:0,lifetime:spec.lifetime,size:spec.size??1};this.particles.push(particle);return particle;
  }
  step(dt:number,acceleration:Vec3=[0,-9.81,0]):void{
    if(!Number.isFinite(dt)||dt<=0||dt>.25||!acceleration.every(Number.isFinite))throw new RangeError('Invalid particle step');
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i]!;p.age+=dt;if(p.age>=p.lifetime){this.particles.splice(i,1);continue;}p.velocity[0]+=acceleration[0]*dt;p.velocity[1]+=acceleration[1]*dt;p.velocity[2]+=acceleration[2]*dt;p.position[0]+=p.velocity[0]*dt;p.position[1]+=p.velocity[1]*dt;p.position[2]+=p.velocity[2]*dt;}
  }
  snapshot():readonly Particle[]{return this.particles.map(p=>({id:p.id,position:[...p.position] as MutableVec3,velocity:[...p.velocity] as MutableVec3,age:p.age,lifetime:p.lifetime,size:p.size}));}
  clear():void{this.particles.length=0;}get size():number{return this.particles.length;}
}
