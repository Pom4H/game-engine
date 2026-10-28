/** Fast ordinary-scale Euclidean length, retaining the stable hypot path for
 * underflow, overflow, zero and non-finite inputs. */
export function finiteNorm3(x:number,y:number,z:number):number{
 const squared=x*x+y*y+z*z;return squared>1e-280&&squared<1e280?Math.sqrt(squared):Math.hypot(x,y,z);
}
