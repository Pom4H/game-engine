import {sanitizeExperimentValues,type ExperimentControl,type ExperimentPreset,type ExperimentValues} from './schema.js';

export interface ExperimentAdapter<Frame> {
  readonly tickRate:number;
  reset(values:ExperimentValues):void;
  step():Frame;
  snapshot():Frame;
  dispose?():void;
}

export interface ExperimentDefinition<Frame> {
  readonly id:string;
  readonly title:string;
  readonly controls:readonly ExperimentControl[];
  readonly presets?:readonly ExperimentPreset[];
  readonly maxSeconds:number;
  create():ExperimentAdapter<Frame>;
}

export interface ExperimentRecording<Frame> {
  readonly definitionId:string;
  readonly values:ExperimentValues;
  readonly tickRate:number;
  readonly frames:readonly Frame[];
}

export class ExperimentSession<Frame>{
  readonly adapter:ExperimentAdapter<Frame>;
  values:ExperimentValues;
  private readonly recorded:Frame[]=[];
  private cursorValue=0;

  constructor(readonly definition:ExperimentDefinition<Frame>,input:unknown={}){
    this.adapter=definition.create();
    this.values=sanitizeExperimentValues(definition.controls,input);
    this.reset(this.values);
  }

  get tickRate(){return this.adapter.tickRate;}
  get frames():readonly Frame[]{return this.recorded;}
  get cursor(){return this.cursorValue;}
  get frame():Frame{return this.recorded[this.cursorValue]!;}
  get done(){return this.recorded.length>=Math.floor(this.definition.maxSeconds*this.tickRate)+1;}

  reset(input:unknown=this.values):Frame{
    this.values=sanitizeExperimentValues(this.definition.controls,input);
    this.adapter.reset(this.values);this.recorded.length=0;
    this.recorded.push(structuredClone(this.adapter.snapshot()));this.cursorValue=0;
    return this.frame;
  }

  applyPreset(id:string):Frame{
    const preset=this.definition.presets?.find(candidate=>candidate.id===id);
    if(!preset)throw new TypeError('Unknown experiment preset: '+id);
    return this.reset({...this.values,...preset.values});
  }

  step(count=1):Frame{
    if(!Number.isSafeInteger(count)||count<1)throw new RangeError('Experiment step count must be a positive integer');
    for(let i=0;i<count&&!this.done;i++)this.recorded.push(structuredClone(this.adapter.step()));
    this.cursorValue=this.recorded.length-1;return this.frame;
  }

  seek(index:number):Frame{
    if(!Number.isFinite(index))throw new RangeError('Experiment cursor must be finite');
    this.cursorValue=Math.max(0,Math.min(this.recorded.length-1,Math.floor(index)));return this.frame;
  }

  runToEnd():Frame{while(!this.done)this.step(Math.min(240,Math.floor(this.definition.maxSeconds*this.tickRate)+1-this.recorded.length));return this.frame;}

  recording():ExperimentRecording<Frame>{
    return Object.freeze({definitionId:this.definition.id,values:this.values,tickRate:this.tickRate,frames:Object.freeze(structuredClone(this.recorded))});
  }

  csv(project:(frame:Frame,index:number)=>Readonly<Record<string,string|number|boolean>>):string{
    const rows=this.recorded.map(project),keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
    const quote=(value:unknown)=>{const text=String(value??'');return /[,"\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
    return [keys.join(','),...rows.map(row=>keys.map(key=>quote(row[key]??'')).join(','))].join('\n');
  }

  dispose():void{this.adapter.dispose?.();}
}
