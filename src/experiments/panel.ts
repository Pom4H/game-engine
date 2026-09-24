import {ExperimentSession,type ExperimentDefinition} from './runtime.js';
import type {ExperimentControl,ExperimentValue} from './schema.js';

export interface ExperimentPanelOptions<Frame>{
  readonly render?:(frame:Frame,host:HTMLElement)=>void;
  readonly csv?:(frame:Frame,index:number)=>Readonly<Record<string,string|number|boolean>>;
  readonly rateOptions?:readonly number[];
}

export class ExperimentPanel<Frame>{
  readonly session:ExperimentSession<Frame>;
  private readonly values:Record<string,ExperimentValue>;
  private timer:number|undefined;
  private playing=false;
  private rate=1;
  private readonly frameHost:HTMLElement;
  private readonly timeline:HTMLInputElement;
  private readonly time:HTMLOutputElement;
  private readonly status:HTMLElement;

  constructor(readonly root:HTMLElement,readonly definition:ExperimentDefinition<Frame>,readonly options:ExperimentPanelOptions<Frame>={}){
    this.session=new ExperimentSession(definition);
    this.values={...this.session.values};
    root.replaceChildren();
    root.classList.add('game-engine-experiment');

    const header=document.createElement('header');
    const title=document.createElement('strong');title.textContent=definition.title;
    const controlsButton=this.button('Controls',()=>drawer.hidden=!drawer.hidden);
    header.append(title,controlsButton);

    const drawer=document.createElement('aside');drawer.hidden=true;
    const controlHost=document.createElement('div');
    for(const control of definition.controls)controlHost.append(this.control(control));
    drawer.append(controlHost);
    if(definition.presets?.length){
      const presets=document.createElement('div');presets.className='experiment-presets';
      for(const preset of definition.presets)presets.append(this.button(preset.label,()=>{this.session.applyPreset(preset.id);Object.assign(this.values,this.session.values);this.sync();}));
      drawer.append(presets);
    }
    drawer.append(this.button('Apply / reset',()=>{this.session.reset(this.values);this.sync();}));

    this.frameHost=document.createElement('section');this.frameHost.className='experiment-frame';

    const transport=document.createElement('footer');
    const run=this.button('Run',()=>this.toggle());
    const reset=this.button('Reset',()=>{this.stop();this.session.reset(this.values);this.sync();});
    const back=this.button('‹',()=>{this.stop();this.session.seek(this.session.cursor-1);this.sync();});
    const forward=this.button('›',()=>{this.stop();if(this.session.cursor===this.session.frames.length-1&&!this.session.done)this.session.step();else this.session.seek(this.session.cursor+1);this.sync();});
    const rate=document.createElement('select');
    for(const value of options.rateOptions??[1,.25,.1,.02]){const option=document.createElement('option');option.value=String(value);option.textContent=value+'×';rate.append(option);}
    rate.onchange=()=>this.rate=Number(rate.value)||1;
    this.time=document.createElement('output');
    this.timeline=document.createElement('input');this.timeline.type='range';this.timeline.min='0';this.timeline.step='1';this.timeline.oninput=()=>{this.stop();this.session.seek(Number(this.timeline.value));this.sync();};
    const exportJson=this.button('JSON',()=>this.download(definition.id+'.json','application/json',JSON.stringify(this.session.recording())));
    const exportCsv=this.button('CSV',()=>{if(!options.csv)return;this.download(definition.id+'.csv','text/csv',this.session.csv(options.csv));});
    this.status=document.createElement('span');
    transport.append(run,reset,back,forward,rate,this.time,this.timeline,exportJson);
    if(options.csv)transport.append(exportCsv);
    transport.append(this.status);

    root.append(header,drawer,this.frameHost,transport);
    this.sync();
  }

  dispose():void{this.stop();this.session.dispose();}

  private control(control:ExperimentControl):HTMLElement{
    const host=document.createElement('label');host.className='experiment-control';
    const caption=document.createElement('span');caption.textContent=control.label;
    host.append(caption);
    if(control.kind==='number'){
      const input=document.createElement('input');input.type='range';input.min=String(control.min);input.max=String(control.max);input.step=String(control.step);input.value=String(this.values[control.key]);
      const output=document.createElement('output');const show=()=>output.textContent=input.value+(control.unit?' '+control.unit:'');show();
      input.oninput=()=>{this.values[control.key]=Number(input.value);show();};host.append(input,output);
    }else if(control.kind==='boolean'){
      const input=document.createElement('input');input.type='checkbox';input.checked=Boolean(this.values[control.key]);input.onchange=()=>this.values[control.key]=input.checked;host.append(input);
    }else{
      const input=document.createElement('select');for(const choice of control.choices){const option=document.createElement('option');option.value=choice;option.textContent=choice;input.append(option);}input.value=String(this.values[control.key]);input.onchange=()=>this.values[control.key]=input.value;host.append(input);
    }
    if(control.help){host.title=control.help;}
    return host;
  }

  private toggle():void{
    if(this.playing){this.stop();return;}
    this.playing=true;
    const advance=()=>{
      if(!this.playing)return;
      if(this.session.cursor<this.session.frames.length-1)this.session.seek(this.session.cursor+1);
      else if(!this.session.done)this.session.step();
      else{this.stop();return;}
      this.sync();
      this.timer=window.setTimeout(advance,1000/this.session.tickRate/this.rate);
    };
    advance();
  }

  private stop():void{this.playing=false;if(this.timer!==undefined)window.clearTimeout(this.timer);this.timer=undefined;}

  private sync():void{
    this.timeline.max=String(Math.max(0,this.session.frames.length-1));this.timeline.value=String(this.session.cursor);
    this.time.textContent=(this.session.cursor/this.session.tickRate).toFixed(3)+' s';
    this.status.textContent=this.session.tickRate+' Hz · frame '+this.session.cursor+'/'+(this.session.frames.length-1);
    this.options.render?.(this.session.frame,this.frameHost);
  }

  private button(label:string,action:()=>void):HTMLButtonElement{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=action;return button;}
  private download(name:string,type:string,text:string):void{
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();queueMicrotask(()=>URL.revokeObjectURL(url));
  }
}
