import type {ContentHash,ContentRef,RenderPartitionability} from '../render-ir/index.js';

export type ExecutionResourceAccess='read'|'write';
export interface ExecutionResourceUse {
 readonly resource:ContentRef;
 readonly access:ExecutionResourceAccess;
}
export interface ExecutionCostHint {
 readonly cpuMicros?:number;
 readonly gpuMicros?:number;
 readonly bytesRead?:number;
 readonly bytesWritten?:number;
}
export interface ExecutionNode {
 readonly id:string;
 readonly operation:string;
 readonly inputs:readonly ExecutionResourceUse[];
 readonly outputs:readonly ContentRef[];
 readonly deterministic:boolean;
 readonly partitionability:RenderPartitionability|{readonly kind:'atomic'};
 readonly cost?:ExecutionCostHint;
}
export interface ExecutionGraph {
 readonly schema:1;
 readonly graphHash:ContentHash;
 readonly nodes:readonly ExecutionNode[];
}
export type PlacementKind='local'|'mesh.temporal'|'mesh.spatial'|'mesh.samples';
export interface PlacementProfile {
 readonly kind:PlacementKind;
 readonly deadlineNs?:bigint;
}
export interface LocalProgramDescriptor {
 readonly graph:ExecutionGraph;
 readonly placement:'local';
}

/** Design-time graph only. Local renderer hot paths are allowed to bypass this
 * package entirely and call their compiled backend program directly. */
export function defineExecutionGraph(graph:ExecutionGraph):ExecutionGraph{
 if(graph.schema!==1||!graph.graphHash)throw new TypeError('Execution graph requires schema 1 and a stable hash');
 const ids=new Set<string>();for(const node of graph.nodes){if(!node.id||ids.has(node.id))throw new TypeError('Execution nodes require unique stable IDs');ids.add(node.id);if(!node.operation)throw new TypeError('Execution node requires an operation');}
 return deepFreeze(structuredClone(graph));
}
export function localProgram(graph:ExecutionGraph):LocalProgramDescriptor{return Object.freeze({graph,placement:'local'});}
function deepFreeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value as Record<string,unknown>))deepFreeze(child);Object.freeze(value);}return value;}
