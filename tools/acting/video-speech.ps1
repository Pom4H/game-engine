param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Synthesis;
public static class ActingVideoSpeech {
 public static void Render(string text,string path,int rate) {
  var rows=new List<string>();var gate=new object();
  using(var speech=new SpeechSynthesizer()) {
   speech.SelectVoice("Microsoft Irina Desktop");speech.Rate=rate;speech.Volume=100;
   speech.VisemeReached+=(sender,e)=>{lock(gate)rows.Add("{\"viseme\":"+e.Viseme+",\"atS\":"+e.AudioPosition.TotalSeconds.ToString("R",CultureInfo.InvariantCulture)+",\"durationS\":"+e.Duration.TotalSeconds.ToString("R",CultureInfo.InvariantCulture)+"}");};
   speech.SetOutputToWaveFile(path);speech.Speak(text);speech.SetOutputToNull();
  }
  lock(gate)File.WriteAllText(path+".visemes.json","["+String.Join(",",rows)+"]");
 }
}
'@
$videoPlan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($line in $videoPlan) { [ActingVideoSpeech]::Render($line.text,$line.path,[int]$line.rate) }
