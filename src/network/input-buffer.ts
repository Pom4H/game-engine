export const INPUT_REORDER_WAIT_MS=80,INPUT_REORDER_WINDOW=64;
export interface Sequenced{readonly commandSeq:number}
const next=(value:number)=>(value+1)&65535,distance=(a:number,b:number)=>(a-b)&65535;
export class InputCommandBuffer<T extends Sequenced=Sequenced>{
  private pending=new Map<number,T>();private expected:number|null=null;private gapSince:number|null=null;
  skipped=0;processedThrough=65535;
  push(commands:readonly T[],now:number):T[]{
    if(!Number.isFinite(now))throw new RangeError('Input buffer time must be finite');
    if(this.expected===null&&commands.length)this.expected=commands[0]!.commandSeq;
    if(this.expected===null)return[];
    for(const command of commands){if(!Number.isSafeInteger(command.commandSeq)||command.commandSeq<0||command.commandSeq>65535)throw new RangeError('commandSeq must be uint16');const d=distance(command.commandSeq,this.expected);if(d<32768&&d<=INPUT_REORDER_WINDOW)this.pending.set(command.commandSeq,command);}
    return this.drain(now);
  }
  drain(now:number,waitMs=INPUT_REORDER_WAIT_MS):T[]{
    if(!Number.isFinite(now)||!Number.isFinite(waitMs)||waitMs<0)throw new RangeError('Invalid reorder timing');
    const ready:T[]=[];
    while(this.expected!==null){
      const command=this.pending.get(this.expected);
      if(command){this.pending.delete(this.expected);ready.push(command);this.processedThrough=this.expected;this.expected=next(this.expected);this.gapSince=null;continue;}
      let future=false;for(const seq of this.pending.keys()){const d=distance(seq,this.expected);if(d>0&&d<32768){future=true;break;}}
      if(!future)break;if(this.gapSince===null){this.gapSince=now;break;}if(now-this.gapSince<waitMs)break;
      this.processedThrough=this.expected;this.expected=next(this.expected);this.skipped++;this.gapSince=now;
    }
    return ready;
  }
  pendingCount():number{return this.pending.size;}
}
