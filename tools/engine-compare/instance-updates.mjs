/** Adjacent changed instance records share one upload; sparse gaps stay untouched. */
export function instanceUpdateRuns(indices){
  const sorted=[...new Set(indices)].sort((a,b)=>a-b),runs=[];
  for(const index of sorted){
    if(!Number.isSafeInteger(index)||index<0)throw new RangeError('Invalid instance index');
    const last=runs.at(-1);
    if(last&&last.start+last.count===index)last.count++;else runs.push({start:index,count:1});
  }
  return runs;
}
