/** Opt-in collision lifetime. Only its owning world can retire it. */
export interface StaticCollisionGroup {readonly active:boolean}
type Node<T>={value:T;group:StaticCollisionGroup|undefined;previous:Node<T>|null;next:Node<T>|null;linked:boolean};
class OrderedList<T>{
 private head:Node<T>|null=null;private tail:Node<T>|null=null;private cached:T[]|undefined;
 add(value:T,group?:StaticCollisionGroup){const node:Node<T>={value,group,previous:this.tail,next:null,linked:true};if(this.tail)this.tail.next=node;else this.head=node;this.tail=node;this.cached=undefined;return node;}
 remove(node:Node<T>){if(!node.linked)return;node.linked=false;if(node.previous)node.previous.next=node.next;else this.head=node.next;if(node.next)node.next.previous=node.previous;else this.tail=node.previous;node.previous=node.next=null;this.cached=undefined;}
 invalidate(){this.cached=undefined;}
 *values(){for(let node=this.head;node;node=node.next)if(node.group?.active!==false)yield node.value;}
 snapshot(){return this.cached??=Array.from(this.values());}
}
type Member<T>={value:T;list:OrderedList<T>;node:Node<T>;global?:Node<T>;group:GroupState<T>|undefined;previous:Member<T>|null;next:Member<T>|null};
type GroupState<T>={active:boolean;head:Member<T>|null;tail:Member<T>|null;indexDone:boolean};
/** Linked ownership is private. Public arrays are ordinary ordered snapshots;
 * physics traverses the live global-plane list without materializing one. */
export class StaticGroupStorage<T extends object>{
 private snapshotReads=0;private groupMemberships=0;
 private readonly bodies=new OrderedList<T>();private readonly planes=new OrderedList<T>();private readonly globals=new OrderedList<T>();
 private readonly records=new WeakMap<T,Member<T>>();private readonly groups=new WeakMap<StaticCollisionGroup,GroupState<T>>();
 constructor(bodies:readonly T[],planes:readonly T[],globals:readonly T[]){for(const item of bodies)this.add(item,false);const global=new Set(globals);for(const item of planes)this.add(item,true,global.has(item));}
 create():StaticCollisionGroup{const state:GroupState<T>={active:true,head:null,tail:null,indexDone:false},group=Object.freeze({get active(){return state.active;}});this.groups.set(group,state);return group;}
 owns(group:StaticCollisionGroup){return this.groups.has(group);}
 add(value:T,plane:boolean,global=false,group?:StaticCollisionGroup){if(group&&!this.groups.get(group)?.active)throw Error('Static group is inactive or belongs to another world');this.remove(value);const list=plane?this.planes:this.bodies,node=list.add(value,group),state=group?this.groups.get(group):undefined,member:Member<T>={value,list,node,...(global?{global:this.globals.add(value,group)}:{}),group:state,previous:state?.tail??null,next:null};this.records.set(value,member);if(state){if(state.tail)state.tail.next=member;else state.head=member;state.tail=member;this.groupMemberships++;}}
 groupOf(value:T){return this.records.get(value)?.node.group;}
 private unlinkOwnership(member:Member<T>){const state=member.group;if(!state)return;if(member.previous)member.previous.next=member.next;else{state.head=member.next;state.indexDone=false;}if(member.next)member.next.previous=member.previous;else state.tail=member.previous;member.previous=member.next=null;member.group=undefined;this.groupMemberships--;}
 remove(value:T){const member=this.records.get(value);if(!member)return;member.list.remove(member.node);if(member.global)this.globals.remove(member.global);this.records.delete(value);this.unlinkOwnership(member);}
 deactivate(group:StaticCollisionGroup){const state=this.groups.get(group);if(!state)throw Error('Static group belongs to another world');if(!state.active)return false;state.active=false;this.bodies.invalidate();this.planes.invalidate();this.globals.invalidate();return true;}
 /** Each unit is one hash membership reference, or one ordered-list unlink. */
 cleanup(group:StaticCollisionGroup,limit:number,removeReference:(item:T)=>boolean){const state=this.groups.get(group);if(!state||state.active)throw Error('Only an inactive owned static group can be cleaned');let operations=0;while(operations<limit&&state.head){const member=state.head;if(!state.indexDone){state.indexDone=removeReference(member.value);operations++;if(!state.indexDone)continue;if(operations===limit)break;}member.list.remove(member.node);if(member.global)this.globals.remove(member.global);if(this.records.get(member.value)===member)this.records.delete(member.value);this.unlinkOwnership(member);operations++;}return{done:state.head===null,operations};}
 snapshot(kind:'bodies'|'planes'|'globals'){this.snapshotReads++;return this[kind].snapshot();}
 inspect(){return{snapshotReads:this.snapshotReads,groupMemberships:this.groupMemberships};}
 globalValues(){return this.globals.values();}
}
