import {trackRuntimeMemory,trackRuntimeInstance} from '../core/runtime-memory.js';
import type {Scene} from '../scene/scene.js';
import {WalkWorld,walkerInput} from './walker-motion.js';
export interface WalkerControlOptions {world?:WalkWorld;onExit?:()=>void;view?:{yaw:number;pitch:number}}
/** Device input produces a velocity; AnimationSystem remains the sole integrator. */
export class WalkerControls {
 private readonly keys=trackRuntimeMemory('WalkerControls','keys','state',new Set<string>());private yaw=0;private pitch=-.13;private initialized=false;private active=false;
 private readonly pointers=trackRuntimeMemory('WalkerControls','pointers','state',new Map<number,{x:number;y:number;lastX:number;lastY:number;move:boolean}>());private stick=[0,0];
 constructor(private readonly canvas:HTMLCanvasElement,private readonly walker:string,private readonly options:WalkerControlOptions={}){
  trackRuntimeInstance('WalkerControls',this);if(options.view){this.yaw=options.view.yaw;this.pitch=options.view.pitch;this.initialized=true;}
  this.active=!options.onExit;canvas.addEventListener('click',this.click);
  canvas.tabIndex=0;canvas.addEventListener('keydown',this.down);canvas.addEventListener('pointerdown',this.pointerDown);canvas.addEventListener('pointermove',this.pointerMove);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,this.pointerUp);
  window.addEventListener('keyup',this.up);window.addEventListener('blur',this.exit);document.addEventListener('visibilitychange',this.visibility);document.addEventListener('pointerlockchange',this.unlock);document.addEventListener('mousemove',this.mouse);
 }
 setActive(active:boolean):void{this.active=active;if(!active){this.clear();if(document.pointerLockElement===this.canvas)document.exitPointerLock();}}
 enter(lock=true):void{this.active=true;this.canvas.focus({preventScroll:true});if(lock){try{const pending=this.canvas.requestPointerLock?.();pending?.catch(()=>{});}catch{/* Drag-look fallback remains available. */}}}
 inspect(){return{active:this.active,yaw:this.yaw,pitch:this.pitch,pressed:[...this.keys]};}
 private click=()=>{if(!this.options.onExit)this.enter();};
 private down=(e:KeyboardEvent)=>{if(e.code==='Escape'){this.exit();return;}if(this.active&&['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}};
 private up=(e:KeyboardEvent)=>{this.keys.delete(e.code);};
 private clear=()=>{this.keys.clear();this.pointers.clear();this.stick=[0,0];};
 private exit=()=>{if(!this.active)return;this.setActive(false);this.options.onExit?.();};
 private visibility=()=>{if(document.hidden)this.exit();};
 private unlock=()=>{if(document.pointerLockElement!==this.canvas)this.exit();};
 private look=(dx:number,dy:number)=>{this.yaw-=dx*.003;this.pitch=Math.max(-.8,Math.min(.5,this.pitch-dy*.003));};
 private mouse=(e:MouseEvent)=>{if(this.active&&document.pointerLockElement===this.canvas)this.look(e.movementX,e.movementY);};
 private pointerDown=(e:PointerEvent)=>{if(!this.active)return;this.canvas.focus({preventScroll:true});if(e.pointerType==='mouse'&&document.pointerLockElement===this.canvas)return;this.canvas.setPointerCapture(e.pointerId);const rect=this.canvas.getBoundingClientRect();this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,move:e.pointerType!=='mouse'&&e.clientX<rect.left+rect.width*.5});};
 private pointerMove=(e:PointerEvent)=>{const p=this.pointers.get(e.pointerId);if(!p||!this.active)return;if(p.move)this.stick=[Math.max(-1,Math.min(1,(p.y-e.clientY)/60)),Math.max(-1,Math.min(1,(e.clientX-p.x)/60))];else this.look(e.clientX-p.lastX,e.clientY-p.lastY);p.lastX=e.clientX;p.lastY=e.clientY;};
 private pointerUp=(e:Event)=>{const id=(e as PointerEvent).pointerId;if(this.pointers.get(id)?.move)this.stick=[0,0];this.pointers.delete(id);};
 tick(scene:Scene,dt=1/60):void{
  const pose=scene.animation.pose(this.walker);if(!pose)return;if(!this.initialized){this.yaw=pose.heading;this.initialized=true;}
  const pressed=(...codes:string[])=>codes.some(code=>this.keys.has(code));
  const forward=this.active?Number(pressed('KeyW','ArrowUp'))-Number(pressed('KeyS','ArrowDown'))+this.stick[0]!:0;
  const right=this.active?Number(pressed('KeyD','ArrowRight'))-Number(pressed('KeyA','ArrowLeft'))+this.stick[1]!:0;
  const input=walkerInput(forward,right,this.yaw,pressed('ShiftLeft','ShiftRight')||Math.hypot(...this.stick)>.85);
  let {speed,heading}=input;
  if(speed&&this.options.world&&dt>0){
   const from=pose.position,to=this.options.world.move(from,Math.cos(heading)*speed*dt,-Math.sin(heading)*speed*dt);
   const dx=to[0]-from[0],dz=to[2]-from[2];speed=Math.hypot(dx,dz)/dt;if(speed>1e-7)heading=Math.atan2(-dz,dx);else speed=0;
  }
  scene.animation.driveWalker(this.walker,speed,heading);
 }
 camera(scene:Scene):void{
  const pose=scene.animation.pose(this.walker);if(!pose)return;if(!this.initialized){this.yaw=pose.heading;this.initialized=true;}
  const p=pose.position,target:[number,number,number]=[p[0],p[1]+1.25,p[2]],r=3.6*Math.cos(this.pitch);
  const desired:[number,number,number]=[p[0]-Math.cos(this.yaw)*r,Math.max(p[1]+.3,target[1]-Math.sin(this.pitch)*3.6),p[2]+Math.sin(this.yaw)*r];
  const position=this.options.world?.camera(target,desired)??desired;
  scene.setCamera({...scene.camera,position,target});
 }
 dispose():void{
  this.setActive(false);this.canvas.removeEventListener('click',this.click);this.canvas.removeEventListener('keydown',this.down);this.canvas.removeEventListener('pointerdown',this.pointerDown);this.canvas.removeEventListener('pointermove',this.pointerMove);
  for(const event of ['pointerup','pointercancel','lostpointercapture'])this.canvas.removeEventListener(event,this.pointerUp);
  window.removeEventListener('keyup',this.up);window.removeEventListener('blur',this.exit);document.removeEventListener('visibilitychange',this.visibility);document.removeEventListener('pointerlockchange',this.unlock);document.removeEventListener('mousemove',this.mouse);
 }
}
