import {ACTIVITY_FACT_SCHEMA,validateActivityFact,type ActivityFact} from '../activity.js';

/** Read-only observer for Codex app-server JSON-RPC notifications.
 * Call push with each message actually received from the connected server.
 * No prompts, command lines, tool results, reasoning text or credentials
 * are copied into the activity stream. */
export class CodexActivityAdapter {
 private readonly threads=new Set<string>();
 private readonly turnByThread=new Map<string,string>();
 private readonly lastFact=new Map<string,string>();
 private readonly itemStarts=new Map<string,string>();
 private readonly seen=new Set<string>();
 private readonly tokenTotals=new Map<string,number>();
 private counter=0;

 push(input:unknown,atMs:number):readonly ActivityFact[]{
  if(!Number.isSafeInteger(atMs)||atMs<0)throw new RangeError('Codex event receipt time must be a nonnegative epoch millisecond');
  if(!input||typeof input!=='object'||Array.isArray(input))return[];
  const value=input as Record<string,unknown>;
  if(typeof value.method!=='string'||!value.params||typeof value.params!=='object'||Array.isArray(value.params))return[];
  const params=value.params as Record<string,unknown>;
  const method=value.method,emitted:ActivityFact[]=[];
  const compact=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=180&&/^[\w.:/-]+$/.test(v)?v:undefined;
  const short=(s:string)=>s.slice(0,75);
  const emit=(threadId:string,id:string,kind:string,label?:string,causeId?:string,extra:Partial<ActivityFact>={})=>{
   if(this.seen.has(id))return;
   const fact=validateActivityFact({
    schema:ACTIVITY_FACT_SCHEMA,id,atMs,actor:{domain:'agent',id:threadId},
    kind,origin:'observed',...(label?{label}:{}),...(causeId?{causeId}:{}),...extra,
   });
   this.seen.add(id);this.lastFact.set(threadId,id);emitted.push(fact);
  };
  const begin=(threadId:string,parent?:string)=>{
   if(this.threads.has(threadId))return;
   this.threads.add(threadId);
   emit(threadId,'codex:'+short(threadId)+':start','agent.started',
    parent?'Codex subagent':'Codex '+threadId.slice(0,8),parent);
  };
  if(method==='thread/started'){
   const thread=params.thread as Record<string,unknown>|undefined;
   const id=compact(thread?.id??params.threadId);
   if(id)begin(id);
   return emitted;
  }
  const threadId=compact(params.threadId);if(!threadId)return emitted;
  if(method==='turn/started'){
   const turn=params.turn as Record<string,unknown>|undefined,turnId=compact(turn?.id);
   if(!turnId)return emitted;
   begin(threadId);
   this.turnByThread.set(threadId,turnId);
   const last=this.lastFact.get(threadId);
   emit(threadId,'codex:'+short(threadId)+':'+short(turnId)+':task',
    'agent.task.started','Codex turn',last,{target:{domain:'task',id:turnId}});
   return emitted;
  }
  if(method==='turn/completed'){
   const turn=params.turn as Record<string,unknown>|undefined,turnId=compact(turn?.id)??this.turnByThread.get(threadId);
   if(!turnId)return emitted;
   const status=turn?.status;
   emit(threadId,'codex:'+short(threadId)+':'+short(turnId)+':finished',
    status==='failed'||status==='interrupted'?'agent.task.failed':'agent.task.completed',
    status==='failed'?'Codex turn failed':status==='interrupted'?'Codex turn interrupted':'Codex turn completed',
    this.lastFact.get(threadId),{target:{domain:'task',id:turnId}});
   return emitted;
  }
  if(method==='thread/closed'){
   emit(threadId,'codex:'+short(threadId)+':stopped','agent.stopped','Codex thread closed',this.lastFact.get(threadId));
   return emitted;
  }
  if(method==='thread/tokenUsage/updated'){
   const usage=params.tokenUsage as Record<string,unknown>|undefined;
   const total=usage?.totalTokenUsage as Record<string,unknown>|undefined;
   const tokens=total?.totalTokens;
   if(typeof tokens!=='number'||!Number.isSafeInteger(tokens)||tokens<0)return emitted;
   const previous=this.tokenTotals.get(threadId)??0;
   if(tokens<=previous)return emitted;
   this.tokenTotals.set(threadId,tokens);
   emit(threadId,'codex:'+short(threadId)+':usage:'+String(++this.counter),'agent.usage.updated',
    undefined,this.lastFact.get(threadId),{usage:{tokens:tokens-previous}});
   return emitted;
  }
  if(method==='item/started'||method==='item/completed'){
   const item=params.item as Record<string,unknown>|undefined;
   const itemId=compact(item?.id),type=item?.type;
   const kinds=['commandExecution','fileChange','mcpToolCall','dynamicToolCall','webSearch','collabAgentToolCall'];
   if(!itemId||typeof type!=='string'||!kinds.includes(type))return emitted;
   const turnId=compact(params.turnId)??this.turnByThread.get(threadId)??'turn';
   const prefix='codex:'+short(threadId)+':'+short(turnId)+':'+short(itemId);
   const key=threadId+'\0'+turnId+'\0'+itemId;
   if(method==='item/started'){
    begin(threadId);
    const last=this.lastFact.get(threadId),id=prefix+':tool:start';
    emit(threadId,id,'agent.tool.started',type,last,{target:{domain:'tool',id:type}});
    this.itemStarts.set(key,id);
   }else{
    // A completed item is authoritative, but never claim that a tool started
    // if this stream was attached after the start notification.
    const bad=item.status==='failed'||item.status==='declined'||item.status==='cancelled'||
      type==='commandExecution'&&typeof item.exitCode==='number'&&item.exitCode!==0;
    const start=this.itemStarts.get(key);
    emit(threadId,prefix+':tool:end',bad?'agent.tool.failed':'agent.tool.completed',
      type,start??this.lastFact.get(threadId),{target:{domain:'tool',id:type}});
   }
   if(type==='collabAgentToolCall'){
    // Only explicit receiver thread IDs prove a real subagent exists.
    const children=Array.isArray(item.receiverThreadIds)?item.receiverThreadIds:[];
    const observed=this.lastFact.get(threadId);
    for(const child of children.slice(0,32)){
     const receiver=compact(child);
     if(receiver&&receiver!==threadId)begin(receiver,observed);
    }
   }
   return emitted;
  }
  return emitted;
 }
}
