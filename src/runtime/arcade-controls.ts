import {idleInput,type ArcadeInput} from '../vehicles/arcade.js';
/** Keyboard/mouse, standard-mapping gamepad and pointer buttons produce the SAME controls. */
export class ArcadeControls {
 private readonly keys=new Set<string>();private readonly mouse=new Set<number>();private readonly touch=new Map<number,string>();
 private readonly abort=new AbortController();private jumps=0;private padJump=false;private padCamera=false;
 active=true;ballCamera=true;
 constructor(readonly canvas:HTMLCanvasElement,root:HTMLElement=document.body){
  const signal=this.abort.signal,typing=()=>document.activeElement instanceof HTMLInputElement||document.activeElement instanceof HTMLTextAreaElement;
  window.addEventListener('keydown',e=>{if(typing()||!this.active)return;if(['Space','ShiftLeft','ShiftRight','KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE'].includes(e.code)){e.preventDefault();if(e.code==='Space'&&!e.repeat)this.ballCamera=!this.ballCamera;this.keys.add(e.code);}}, {signal});
  window.addEventListener('keyup',e=>this.keys.delete(e.code),{signal});
  canvas.addEventListener('pointerdown',e=>{if(!this.active||e.pointerType!=='mouse')return;e.preventDefault();canvas.focus();this.mouse.add(e.button);if(e.button===2)this.jumps++;},{signal});
  window.addEventListener('pointerup',e=>{this.mouse.delete(e.button);this.touch.delete(e.pointerId);},{signal});
  window.addEventListener('pointercancel',e=>this.touch.delete(e.pointerId),{signal});
  canvas.addEventListener('contextmenu',e=>e.preventDefault(),{signal});
  window.addEventListener('blur',()=>this.clear(),{signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.clear();},{signal});
  root.querySelectorAll<HTMLElement>('[data-drive]').forEach(button=>button.addEventListener('pointerdown',e=>{
   e.preventDefault();if(!this.active)return;const action=button.dataset.drive!;button.setPointerCapture(e.pointerId);this.touch.set(e.pointerId,action);if(action==='jump')this.jumps++;if(action==='camera')this.ballCamera=!this.ballCamera;
  },{signal}));
 }
 setSerial(value:number):void {this.jumps=value;}
 clear():void {this.keys.clear();this.mouse.clear();this.touch.clear();}
 sample():ArcadeInput {
  const out=idleInput();out.jumpSerial=this.jumps;if(!this.active||document.hidden)return out;
  const touch=(action:string)=>{for(const v of this.touch.values())if(v===action)return true;return false;},key=(code:string)=>this.keys.has(code);
  out.throttle=Number(key('KeyW')||touch('forward'))-Number(key('KeyS')||touch('reverse'));
  out.steer=Number(key('KeyD')||touch('right'))-Number(key('KeyA')||touch('left'));out.pitch=-out.throttle;
  out.slide=key('ShiftLeft')||key('ShiftRight')||touch('slide');out.roll=Number(key('KeyE'))-Number(key('KeyQ'))||(out.slide?out.steer:0);
  out.jump=this.mouse.has(2)||touch('jump');out.boost=this.mouse.has(0)||touch('boost');
  const pad=navigator.getGamepads?.().find(p=>p?.connected&&p.mapping==='standard');
  if(pad){
   const down=(i:number)=>pad.buttons[i]?.pressed??false,axis=(i:number)=>{const v=pad.axes[i]??0;return Math.abs(v)<.12?0:v;};
   if(down(0)&&!this.padJump)this.jumps++;if(down(3)&&!this.padCamera)this.ballCamera=!this.ballCamera;
   this.padJump=down(0);this.padCamera=down(3);
   out.throttle=out.throttle||(pad.buttons[7]?.value??0)-(pad.buttons[6]?.value??0);out.steer=out.steer||axis(0);out.pitch=out.pitch||axis(1);
   out.slide||=down(2);out.roll=out.roll||Number(down(5))-Number(down(4))||(down(2)?axis(0):0);out.boost||=down(1);out.jump||=down(0);
  }else{this.padJump=false;this.padCamera=false;}
  out.jumpSerial=this.jumps;return out;
 }
 dispose():void {this.abort.abort();this.clear();}
}
