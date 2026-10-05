import {nativeSpeechPlan} from '../../dist/audio/native-speech.js';

// Fixed diagnostic corpus. Never generate it from ASR's successful outputs.
// Nonsense syllables test acoustic contrasts, not an English word recognizer.
export const LAB_VOICES=Object.freeze([
 Object.freeze({id:'mike',name:'Mike',tractLengthM:.1746,pan:0,breathiness:.035}),
 Object.freeze({id:'anna',name:'Anna',tractLengthM:.155,pan:0,breathiness:.065}),
]);
const syllables=['p','t','k','s','S'].flatMap(c=>['a','i:','u:'].map(v=>({id:(c==='S'?'sh':c)+'-'+v.replace(':','long'),kind:'syllable',label:c+' '+v,segments:[{phone:c,durationS:.14},{phone:v,durationS:.30}]})));
const words=[['pea','p'],['tea','t'],['key','k'],['see','s'],['she','S']].map(([text,c])=>({id:text,kind:'word',text,label:text,segments:[{phone:c,durationS:.14},{phone:'i:',durationS:.30}]}));
const phrases=[
 ['give-me-tea','Give me tea.','g I v m i: t i:'],
 ['thank-you','Thank you.','T ae N k j u:'],
 ['here-you-go','Here you go.','h i: r j u: g oU'],
 ['careful','Careful.','k E r f @ l'],
].map(([id,text,phones])=>({id,kind:'phrase',text,label:text,segments:phones.split(' ').map(phone=>({phone,durationS:['i:','u:','oU','ae','E','I','@'].includes(phone)?.16:.09}))}));
export const SPEECH_LAB_CASES=Object.freeze([...syllables,...words,...phrases].map(item=>Object.freeze({...item,segments:Object.freeze(item.segments.map(Object.freeze))})));
export function speechLabPlan(voiceId,caseId){
 const voice=LAB_VOICES.find(v=>v.id===voiceId),item=SPEECH_LAB_CASES.find(c=>c.id===caseId);
 if(!voice||!item)throw new RangeError('Unknown fixed speech laboratory case');
 return nativeSpeechPlan([voice],[{id:item.id,speakerId:voice.id,text:item.label,startS:.10,
  segments:[{phone:'',durationS:.10},...item.segments,{phone:'',durationS:.25}],
  pitch:[{timeS:0,hz:voice.id==='mike'?125:193}],pressure:[{timeS:0,pa:800}]}]);
}
