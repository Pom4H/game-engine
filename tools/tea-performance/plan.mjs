import {nativeSpeechPlan} from '../../dist/audio/native-speech.js';

// Authored pronunciation, not a generic English G2P. Unknown words fail closed.
const dictionary={
 you:'j u:',look:'l U k',frozen:'f r oU z @ n',want:'w O n t',some:'s V m',tea:'t i:',
 please:'p l i: z',my:'m aI',hands:'h ae n d z',are:'a r',ice:'aI s',
 careful:'k E r f @ l',it:'I t',is:'I z',very:'v E r i',hot:'h A t',
 i:'aI',can:'k ae n',handle:'h ae n d @ l',here:'h i r',go:'g oU',
 thank:'T ae N k',oh:'oU',that:'D ae t',did:'d I d',say:'s eI',
 sound:'s aU n d',pleased:'p l i: z d',only:'oU n l i',a:'@',little:'l I t @ l',
 let:'l E t',us:'V s',inside:'I n s aI d',good:'g U d',idea:'aI d i: @',
 bring:'b r I N',the:'D @',am:'ae m',not:'n A t',leaving:'l i: v I N',
 do:'d u:',yes:'j E s',okay:'oU k eI',just:'dZ V s t',minute:'m I n I t',
};
const vowel=phone=>/^(a|a:|A|ae|E|e|e:|i|i:|I|o|o:|O|u|u:|U|@|V|aI|aU|eI|oU)$/.test(phone);
const baseDuration=phone=>vowel(phone)?(phone==='@'?.062:phone.length>1?.14:.105):['s','S','f','T'].includes(phone)?.09:['p','t','k'].includes(phone)?.072:.065;
export const teaPerformanceLines=Object.freeze([
 {id:'offer',speakerId:'mike',text:'You look frozen. Want some tea?',startS:1.20,intent:'question'},
 {id:'cold',speakerId:'anna',text:'Please. My hands are ice.',startS:4.90,intent:'warm'},
 {id:'warning',speakerId:'mike',text:'Careful. It is very hot.',startS:8.00,intent:'warning'},
 {id:'confident',speakerId:'anna',text:'I can handle hot tea.',startS:11.00,intent:'confident'},
 {id:'handoff',speakerId:'mike',text:'Here you go.',startS:14.10,intent:'warm'},
 {id:'thanks',speakerId:'anna',text:'Thank you.',startS:15.90,intent:'warm'},
 {id:'hot',speakerId:'anna',text:'Oh! That is hot.',startS:19.00,intent:'surprise'},
 {id:'told-you',speakerId:'mike',text:'I did say careful.',startS:21.80,intent:'amused'},
 {id:'teasing',speakerId:'anna',text:'You sound very pleased.',startS:24.50,intent:'teasing'},
 {id:'admit',speakerId:'mike',text:'Only a little.',startS:27.30,intent:'amused'},
 {id:'inside',speakerId:'anna',text:'Let us go inside.',startS:29.80,intent:'suggest'},
 {id:'agree',speakerId:'mike',text:'Good idea. Bring the tea.',startS:32.30,intent:'warm'},
 {id:'last-word',speakerId:'anna',text:'I am not leaving it.',startS:35.30,intent:'amused'},
]);
export const TEA_PERFORMANCE_DURATION=42;
export function pronounce(text){
 const tokens=text.toLowerCase().match(/[a-z]+|[.,!?]/g)??[],out=[{phone:'',durationS:.11}];
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i];if(/[.,!?]/.test(token)){out.push({phone:'',durationS:token===','?.075:.15});continue;}
  const spelling=dictionary[token];if(!spelling)throw new RangeError('Missing authored pronunciation: '+token);
  const phones=spelling.split(' '),lastWord=i===tokens.length-1||/[.!?]/.test(tokens[i+1]);
  for(let p=0;p<phones.length;p++){const symbol=phones[p],final=lastWord&&p===phones.length-1;out.push({phone:symbol,durationS:Number((baseDuration(symbol)*(final?1.26:1)).toFixed(5))});}
 }
 out.push({phone:'',durationS:.18});return out;
}
export function createTeaPerformancePlan(){
 const speakers=[{id:'mike',name:'Mike',tractLengthM:.1746,pan:.24,breathiness:.035},{id:'anna',name:'Anna',tractLengthM:.155,pan:-.24,breathiness:.065}];
 const turns=teaPerformanceLines.map((line,i)=>{
  const segments=pronounce(line.text),duration=segments.reduce((sum,p)=>sum+p.durationS,0),base=line.speakerId==='mike'?124:193;
  const rise=line.intent==='question'||line.intent==='suggest',excited=line.intent==='surprise';
  const contour=excited?[1.18,1.44,1.15,1.26,1.04]:rise?[1,1.12,.98,1.08,1.20]:[1.02,1.15,1.04,1.10,.90];
  const time=[0,.17,.44,.68,.92];
  return{id:line.id,speakerId:line.speakerId,text:line.text,startS:line.startS,segments,
   pitch:time.map((u,k)=>({timeS:Number((u*duration).toFixed(6)),hz:base*contour[k]*(1+Math.sin(i*1.7)*.023)})),
   pressure:[{timeS:0,pa:excited?940:800},{timeS:duration*.30,pa:excited?1020:850},{timeS:duration*.85,pa:720}],
  };
 });
 return nativeSpeechPlan(speakers,turns);
}
