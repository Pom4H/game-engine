import {idleInput,readArcadeInput,type ArcadeInput} from '../vehicles/arcade.js';
import {safeInteger} from './projection.js';
/** Absolute input repeats its jump edge counter: loss cannot turn a held button into repeated jumps. */
export function encodeArcadeInput(epoch:number,sequence:number,input:ArcadeInput):Uint8Array {
 if(!safeInteger(epoch)||!safeInteger(sequence,1,0x7fffffff))throw new RangeError('Input clock');readArcadeInput(input);
 const bytes=new Uint8Array(28),d=new DataView(bytes.buffer);d.setUint32(0,0x494e5032,true);d.setFloat64(4,epoch,true);d.setUint32(12,sequence,true);d.setUint32(16,input.jumpSerial,true);
 const fields=['throttle','steer','pitch','roll'] as const;fields.forEach((key,k)=>d.setInt8(20+k,Math.round(input[key]*127)));
 d.setUint8(24,Number(input.boost)|Number(input.slide)<<1|Number(input.jump)<<2);return bytes;
}
export function decodeArcadeInput(bytes:Uint8Array):{epoch:number;sequence:number;controls:ArcadeInput}{
 if(bytes.length!==28)throw new RangeError('Input datagram length');const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const epoch=d.getFloat64(4,true),sequence=d.getUint32(12,true),flags=d.getUint32(24,true);
 if(d.getUint32(0,true)!==0x494e5032||!safeInteger(epoch)||!safeInteger(sequence,1,0x7fffffff)||flags>7)throw new TypeError('Invalid input datagram');
 const controls=idleInput();(['throttle','steer','pitch','roll'] as const).forEach((key,k)=>controls[key]=d.getInt8(20+k)/127);
 controls.jumpSerial=d.getUint32(16,true);controls.boost=!!(flags&1);controls.slide=!!(flags&2);controls.jump=!!(flags&4);return{epoch,sequence,controls:readArcadeInput(controls)};
}
