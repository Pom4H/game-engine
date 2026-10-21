import type {Vec3} from '../math.js';

export interface DirectionalProxy{readonly dir:Vec3;readonly threshold:number}

// A cube face maps raw vectors with one fixed unit coordinate and two varying
// coordinates. Normalization is 1-Lipschitz here because the raw length is >= 1.
// The dot product can therefore grow by at most tileRadius * |proxy.dir|.
// This bound only rejects proxies that cannot contribute to any texel in a tile.
export function buildDirectionalProxyTiles<P extends DirectionalProxy>(
  proxies:readonly P[],size:number,direction:(face:number,u:number,v:number)=>Vec3,
):{side:number;buckets:P[][]}{
  const tileSize=16,side=Math.ceil(size/tileSize),buckets:P[][]=[];
  for(let face=0;face<6;face++)for(let ty=0;ty<side;ty++)for(let tx=0;tx<side;tx++){
    const x0=tx*tileSize,x1=Math.min(size,x0+tileSize),y0=ty*tileSize,y1=Math.min(size,y0+tileSize);
    const center=direction(face,(x0+x1)/size-1,(y0+y1)/size-1);
    const radius=Math.hypot((x1-x0)/size,(y1-y0)/size)+1e-12;
    const candidates:P[]=[];
    for(const proxy of proxies){
      const dot=center[0]*proxy.dir[0]+center[1]*proxy.dir[1]+center[2]*proxy.dir[2];
      const norm=Math.hypot(proxy.dir[0],proxy.dir[1],proxy.dir[2]);
      if(dot+radius*norm>proxy.threshold)candidates.push(proxy);
    }
    buckets.push(candidates);
  }
  return{side,buckets};
}
