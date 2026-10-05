import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {renderNativeSpeech,NativeSpeechMotor} from '../../dist/audio/native-speech.js';
import {wavBytes} from '../../dist/audio/synth.js';
import {LAB_VOICES,SPEECH_LAB_CASES,speechLabPlan} from './corpus.mjs';
const out=resolve(process.env.SPEECH_LAB_OUTPUT??'artifacts/speech-lab');await mkdir(out,{recursive:true});
const rows=[],hash=b=>createHash('sha256').update(b).digest('hex');
for(const voice of LAB_VOICES)for(const item of SPEECH_LAB_CASES){
 const plan=speechLabPlan(voice.id,item.id),result=renderNativeSpeech(plan),bytes=wavBytes(result.audio),file=voice.id+'-'+item.id+'.wav';
 await writeFile(out+'/'+file,bytes);
 const motor=new NativeSpeechMotor(plan,voice.id),constriction=motor.sample(.25),vowel=motor.sample(.45);
 const motorAt=f=>({timeS:f.timeS,phone:f.phone,constrictionSection:f.constrictionSection,minimumAreaCm2:Math.min(...f.oralAreaCm2),mouthAreaCm2:f.oralAreaCm2[43],nasalPortAreaCm2:f.nasalPortAreaCm2,pitchHz:f.pitchHz,lungPressurePa:f.lungPressurePa});
 rows.push({id:voice.id+'-'+item.id,voiceId:voice.id,caseId:item.id,kind:item.kind,label:item.label,expected:item.text??null,file,sha256:hash(bytes),planSha256:hash(JSON.stringify(plan)),diagnostics:result.diagnostics,controlFrames:[motorAt(constriction),motorAt(vowel)]});
}
const evidence={schema:1,sourceCommit:process.env.GITHUB_SHA??null,backend:'native-typescript',diagnosticOnly:true,corpusSha256:hash(JSON.stringify(SPEECH_LAB_CASES)),cases:rows};
await writeFile(out+'/manifest.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({cases:rows.length,wordsAndPhrases:rows.filter(r=>r.expected).length,corpusSha256:evidence.corpusSha256,output:out}));
