import type {Scene} from '../scene/scene.js';
/** Browser input and follow camera. The animation system owns movement/contacts. */
export class WalkerControls {
 private readonly keys=new Set<string>();private yaw=0;private elevation=1.65;private heading=0;private initialized=false;
 constructor(private readonly canvas:HTMLCanvasElement,private readonly walker:string){
  canvas.tabIndex=0;canvas.addEventListener('keydown',this.down);canvas.addEventListener('keyup',this.up);canvas.addEventListener('click',this.lock);
  window.addEventListener('keyup',this.up);window.addEventListener('blur',this.clear);document.addEventListener('pointerlockchange',this.unlock);document.addEventListener('mousemove',this.mouse);
 }
 private down=(e:KeyboardEvent)=>{if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}};
 private up=(e:KeyboardEvent)=>{this.keys.delete(e.code);};
 private clear=()=>{this.keys.clear();};
 private unlock=()=>{if(document.pointerLockElement!==this.canvas)this.clear();};
 private lock=()=>{this.canvas.focus();const pending=this.canvas.requestPointerLock?.();pending?.catch(()=>{});};
 private mouse=(e:MouseEvent)=>{if(document.pointerLockElement===this.canvas){this.yaw-=e.movementX*.003;this.elevation=Math.max(.5,Math.min(4,this.elevation+e.movementY*.008));}};
 tick(scene:Scene):void{
  const pose=scene.animation.pose(this.walker);if(!this.initialized&&pose){this.yaw=this.heading=pose.heading;this.initialized=true;}
  const pressed=(...codes:string[])=>codes.some(code=>this.keys.has(code));
  const forward=Number(pressed('KeyW','ArrowUp'))-Number(pressed('KeyS','ArrowDown')),right=Number(pressed('KeyD','ArrowRight'))-Number(pressed('KeyA','ArrowLeft'));
  const moving=forward!==0||right!==0;
  if(moving)this.heading=this.yaw-Math.atan2(right,forward);
  scene.animation.driveWalker(this.walker,moving?(pressed('ShiftLeft','ShiftRight')?2.8:1.25):0,this.heading);
 }
 camera(scene:Scene):void{
  const pose=scene.animation.pose(this.walker);if(!pose)return;const p=pose.position,c=Math.cos(this.yaw),s=Math.sin(this.yaw);
  scene.setCamera({position:[p[0]-c*4.1,p[1]+this.elevation,p[2]+s*4.1],target:[p[0]+c*.65,p[1]+1.15,p[2]-s*.65],fov:55});
 }
 dispose():void{
  this.clear();this.canvas.removeEventListener('keydown',this.down);this.canvas.removeEventListener('keyup',this.up);this.canvas.removeEventListener('click',this.lock);
  window.removeEventListener('keyup',this.up);window.removeEventListener('blur',this.clear);document.removeEventListener('pointerlockchange',this.unlock);document.removeEventListener('mousemove',this.mouse);
  if(document.pointerLockElement===this.canvas)document.exitPointerLock();
 }
}
