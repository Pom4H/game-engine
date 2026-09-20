export interface StructuralSkinBinding {
  readonly vertexCount:number;
  readonly influences:number;
  readonly rest:Float64Array;
  readonly nodes:Uint16Array;
  readonly weights:Float64Array;
}

/**
 * Precompute a sparse deformation-cage binding. Runtime application only consumes
 * node deltas; the render mesh never becomes the physics mesh.
 *
 * The representation maps directly to storage buffers later: fixed-width node
 * indices + weights per vertex, with no object graph in the hot path.
 */
export function bindStructuralSkin(
  positions:readonly number[]|Float32Array|Float64Array,
  nodeRest:Float64Array,
  influences=4,
):StructuralSkinBinding{
  if(positions.length%3||nodeRest.length%3)throw new RangeError('Structural skin positions must be xyz triples');
  const vertexCount=positions.length/3,nodeCount=nodeRest.length/3;
  if(!vertexCount||!nodeCount||nodeCount>65535)throw new RangeError('Invalid structural skin dimensions');
  const k=Math.max(1,Math.min(8,Math.min(nodeCount,Math.floor(influences))));
  const rest=new Float64Array(positions),nodes=new Uint16Array(vertexCount*k),weights=new Float64Array(vertexCount*k);
  const bestDistance=new Float64Array(k),bestNode=new Uint16Array(k);
  for(let vertex=0;vertex<vertexCount;vertex++){
    const base=vertex*3,x=rest[base]!,y=rest[base+1]!,z=rest[base+2]!;
    bestDistance.fill(Infinity);bestNode.fill(0);
    for(let node=0;node<nodeCount;node++){
      const n=node*3,dx=nodeRest[n]!-x,dy=nodeRest[n+1]!-y,dz=nodeRest[n+2]!-z,d=dx*dx+dy*dy+dz*dz;
      if(d>=bestDistance[k-1]!)continue;
      let slot=k-1;
      while(slot>0&&d<bestDistance[slot-1]!){bestDistance[slot]=bestDistance[slot-1]!;bestNode[slot]=bestNode[slot-1]!;slot--;}
      bestDistance[slot]=d;bestNode[slot]=node;
    }
    const out=vertex*k;
    if(bestDistance[0]!<1e-16){nodes[out]=bestNode[0]!;weights[out]=1;continue;}
    let sum=0;
    for(let slot=0;slot<k;slot++)sum+=1/Math.max(1e-16,bestDistance[slot]!);
    for(let slot=0;slot<k;slot++){
      nodes[out+slot]=bestNode[slot]!;
      weights[out+slot]=(1/Math.max(1e-16,bestDistance[slot]!))/sum;
    }
  }
  return Object.freeze({vertexCount,influences:k,rest,nodes,weights});
}

export function applyStructuralSkin(
  binding:StructuralSkinBinding,
  nodeRest:Float64Array,
  nodePosition:Float64Array,
  output:Float32Array|Float64Array|number[],
):void{
  if(nodeRest.length!==nodePosition.length||nodeRest.length%3)throw new RangeError('Structural node buffers must match');
  if(output.length!==binding.vertexCount*3)throw new RangeError('Structural skin output size mismatch');
  const nodeCount=nodeRest.length/3,{influences,nodes,weights,rest}=binding;
  for(let vertex=0;vertex<binding.vertexCount;vertex++){
    const base=vertex*3,link=vertex*influences;
    let x=rest[base]!,y=rest[base+1]!,z=rest[base+2]!;
    for(let slot=0;slot<influences;slot++){
      const node=nodes[link+slot]!;
      if(node>=nodeCount)throw new RangeError('Structural skin node index out of range');
      const n=node*3,w=weights[link+slot]!;
      x+=(nodePosition[n]!-nodeRest[n]!)*w;
      y+=(nodePosition[n+1]!-nodeRest[n+1]!)*w;
      z+=(nodePosition[n+2]!-nodeRest[n+2]!)*w;
    }
    output[base]=x;output[base+1]=y;output[base+2]=z;
  }
}
