export type ExperimentValue=number|boolean|string;
export type ExperimentValues=Readonly<Record<string,ExperimentValue>>;

export type ExperimentControl =
  | Readonly<{key:string;label:string;help?:string;kind:'number';value:number;min:number;max:number;step:number;unit?:string}>
  | Readonly<{key:string;label:string;help?:string;kind:'boolean';value:boolean}>
  | Readonly<{key:string;label:string;help?:string;kind:'select';value:string;choices:readonly string[]}>;

export interface ExperimentPreset {
  readonly id:string;
  readonly label:string;
  readonly values:Readonly<Record<string,ExperimentValue>>;
}

export function sanitizeExperimentValues(controls:readonly ExperimentControl[],input:unknown):ExperimentValues{
  const source=input&&typeof input==='object'&&!Array.isArray(input)?input as Record<string,unknown>:{};
  const output:Record<string,ExperimentValue>=Object.create(null);
  for(const control of controls){
    if(!/^[a-zA-Z][\w.]*$/.test(control.key)||['__proto__','constructor','prototype'].includes(control.key))throw new TypeError('Unsafe experiment control key');
    const value=Object.hasOwn(source,control.key)?source[control.key]:undefined;
    if(control.kind==='number'){
      const finite=typeof value==='number'&&Number.isFinite(value)?value:control.value;
      const bounded=Math.max(control.min,Math.min(control.max,finite));
      const stepped=control.min+Math.round((bounded-control.min)/control.step)*control.step;
      output[control.key]=Math.max(control.min,Math.min(control.max,Number(stepped.toPrecision(12))));
    }else if(control.kind==='boolean')output[control.key]=typeof value==='boolean'?value:control.value;
    else output[control.key]=typeof value==='string'&&control.choices.includes(value)?value:control.value;
  }
  return Object.freeze(output);
}

export function numberValue(values:ExperimentValues,key:string):number{
  const value=values[key];if(typeof value!=='number')throw new TypeError(key);return value;
}
export function stringValue(values:ExperimentValues,key:string):string{
  const value=values[key];if(typeof value!=='string')throw new TypeError(key);return value;
}
export function booleanValue(values:ExperimentValues,key:string):boolean{return values[key]===true;}
