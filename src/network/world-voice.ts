export type VoicePeer={id:string;actorId:string;publishing:boolean};
export type VoiceStream={actorId:string;stream:MediaStream|null};
export type VoiceSignal={description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit};
type VoiceOptions={send:(packet:unknown)=>boolean;/** Optional audio producer; its returned tracks become owned by this session. */audioSource?:()=>Promise<MediaStream>;onVoiceStream?:(value:VoiceStream)=>void;onPublishing?:(enabled:boolean)=>void;onError?:(message:string)=>void};
type Peer={identity:VoicePeer;pc:RTCPeerConnection;queue:Promise<void>;candidates:RTCIceCandidateInit[];stream:MediaStream|null;reported:boolean;detachTrack:()=>void;initiator:boolean};

/** Signalling transports identity/permissions; audio stays in one audio-only RTC
 * transceiver per peer. The lower connection id makes the only offer, eliminating
 * glare. Mic switches replaceTrack, so listening never requests a microphone. */
export class WorldVoice {
 private selfId='';private roster=new Map<string,VoicePeer>();private peers=new Map<string,Peer>();
 private microphone:MediaStream|null=null;private microphoneEnded:(()=>void)|null=null;private request=0;private publishing=false;private disposed=false;
 constructor(private readonly options:VoiceOptions){}
 private current(peer:Peer){return !this.disposed&&this.peers.get(peer.identity.id)===peer;}
 private track(){return this.microphone?.getAudioTracks().find(track=>track.readyState==='live')??null;}
 private emit(peer:Peer){
  const visible=this.current(peer)&&peer.identity.publishing&&peer.stream!==null&&peer.stream.getAudioTracks().some(track=>track.readyState==='live'&&!track.muted)&&peer.pc.connectionState!=='failed'&&peer.pc.connectionState!=='closed'&&peer.pc.connectionState!=='disconnected';
  if(visible===peer.reported)return;peer.reported=visible;this.options.onVoiceStream?.({actorId:peer.identity.actorId,stream:visible?peer.stream:null});
 }
 private remove(peer:Peer){
  if(this.peers.get(peer.identity.id)!==peer)return;
  if(peer.reported){peer.reported=false;this.options.onVoiceStream?.({actorId:peer.identity.actorId,stream:null});}
  this.peers.delete(peer.identity.id);peer.detachTrack();peer.stream=null;peer.candidates.length=0;
  peer.pc.ontrack=null;peer.pc.onicecandidate=null;peer.pc.onconnectionstatechange=null;peer.pc.close();
 }
 private serial(peer:Peer,work:()=>Promise<void>){peer.queue=peer.queue.then(async()=>{if(this.current(peer))await work();}).catch(error=>{if(!this.current(peer))return;this.options.onError?.(`Не удалось подключить голос: ${String((error as Error).message??error)}`);this.remove(peer);});return peer.queue;}
 private send(peer:Peer,value:VoiceSignal){if(this.current(peer))this.options.send({type:'signal',to:peer.identity.id,value});}
 private async syncTrack(peer:Peer){
  const transceiver=peer.pc.getTransceivers().find(value=>value.receiver.track.kind==='audio');if(!transceiver)return;
  await transceiver.sender.replaceTrack(this.track());
  // Permission can change during replaceTrack. Apply the current microphone again
  // before emitting any description, rather than resurrecting an old grant.
  if(this.current(peer)&&transceiver.sender.track!==this.track())await transceiver.sender.replaceTrack(this.track());
 }
 private make(identity:VoicePeer){
  if(typeof RTCPeerConnection==='undefined'){this.options.onError?.('Браузер не поддерживает голосовой канал.');return;}
  let pc:RTCPeerConnection;try{pc=new RTCPeerConnection({iceServers:[]});}catch(error){this.options.onError?.(`Голосовой канал недоступен: ${String((error as Error).message??error)}`);return;}
  const peer:Peer={identity:{...identity},pc,queue:Promise.resolve(),candidates:[],stream:null,reported:false,detachTrack:()=>{},initiator:this.selfId<identity.id};
  this.peers.set(identity.id,peer);
  pc.onicecandidate=event=>{if(event.candidate)this.send(peer,{candidate:event.candidate.toJSON()});};
  pc.ontrack=event=>{
   if(!this.current(peer)||event.track.kind!=='audio')return;
   if(peer.reported){peer.reported=false;this.options.onVoiceStream?.({actorId:peer.identity.actorId,stream:null});}
   peer.detachTrack();peer.stream=new MediaStream([event.track]);
   const changed=()=>this.emit(peer);event.track.addEventListener('ended',changed);event.track.addEventListener('mute',changed);event.track.addEventListener('unmute',changed);
   peer.detachTrack=()=>{event.track.removeEventListener('ended',changed);event.track.removeEventListener('mute',changed);event.track.removeEventListener('unmute',changed);};this.emit(peer);
  };
  pc.onconnectionstatechange=()=>{if(!this.current(peer))return;if(pc.connectionState==='failed'||pc.connectionState==='closed'){this.remove(peer);return;}this.emit(peer);};
  if(peer.initiator){
   pc.addTransceiver('audio',{direction:'sendrecv'});
   void this.serial(peer,async()=>{
    await this.syncTrack(peer);if(!this.current(peer))return;
    const offer=await pc.createOffer();if(!this.current(peer))return;
    await pc.setLocalDescription(offer);if(!this.current(peer))return;
    await this.syncTrack(peer);if(pc.localDescription)this.send(peer,{description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
   });
  }
 }
 setRoster(peers:readonly VoicePeer[],selfId:string){
  if(this.disposed)return;
  if(typeof selfId!=='string'||!selfId||selfId.length>160||!Array.isArray(peers)||peers.length>96)throw new TypeError('Invalid voice roster');
  const next=new Map<string,VoicePeer>();
  for(const peer of peers){if(!peer||typeof peer.id!=='string'||!peer.id||peer.id.length>160||typeof peer.actorId!=='string'||!peer.actorId||peer.actorId.length>160||typeof peer.publishing!=='boolean'||next.has(peer.id))throw new TypeError('Invalid voice identity');if(peer.id!==selfId)next.set(peer.id,{...peer});}
  if(this.selfId&&this.selfId!==selfId)this.reset();this.selfId=selfId;this.roster=next;
  for(const peer of [...this.peers.values()]){const identity=next.get(peer.identity.id);if(!identity||identity.actorId!==peer.identity.actorId)this.remove(peer);else{peer.identity=identity;this.emit(peer);}}
  for(const identity of next.values())if(!this.peers.has(identity.id)&&(this.publishing||identity.publishing))this.make(identity);
 }
 receiveSignal(from:string,actorId:string,value:VoiceSignal){
  const peer=this.peers.get(from);if(!peer||peer.identity.actorId!==actorId||!this.current(peer))return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>key!=='description'&&key!=='candidate'))throw new TypeError('Invalid voice signal');
  const description=value.description,candidate=value.candidate;
  if(description&&(!['offer','answer'].includes(description.type)||typeof description.sdp!=='string'||description.sdp.length>65_536||/^m=(video|application)\b/m.test(description.sdp)))throw new TypeError('Invalid voice description');
  if(candidate&&(typeof candidate.candidate!=='string'||candidate.candidate.length>4096||candidate.sdpMid!==undefined&&candidate.sdpMid!==null&&(typeof candidate.sdpMid!=='string'||candidate.sdpMid.length>128)||candidate.sdpMLineIndex!==undefined&&candidate.sdpMLineIndex!==null&&(!Number.isInteger(candidate.sdpMLineIndex)||candidate.sdpMLineIndex<0||candidate.sdpMLineIndex>8)))throw new TypeError('Invalid voice candidate');
  void this.serial(peer,async()=>{
   if(description){
    if(description.type==='offer'&&peer.initiator||description.type==='answer'&&!peer.initiator)return;
    await peer.pc.setRemoteDescription(description);if(!this.current(peer))return;
    if(description.type==='offer'){
     const transceiver=peer.pc.getTransceivers().find(value=>value.receiver.track.kind==='audio');if(!transceiver)throw new Error('No audio transceiver');transceiver.direction='sendrecv';
     await this.syncTrack(peer);if(!this.current(peer))return;
     const answer=await peer.pc.createAnswer();if(!this.current(peer))return;
     await peer.pc.setLocalDescription(answer);if(!this.current(peer))return;
     await this.syncTrack(peer);if(peer.pc.localDescription)this.send(peer,{description:{type:peer.pc.localDescription.type,sdp:peer.pc.localDescription.sdp}});
    }
    for(const pending of peer.candidates.splice(0)){await peer.pc.addIceCandidate(pending);if(!this.current(peer))return;}
   }
   if(candidate){if(peer.pc.remoteDescription)await peer.pc.addIceCandidate(candidate);else{if(peer.candidates.length>=64)throw new RangeError('Voice candidate queue limit');peer.candidates.push(candidate);}}
  });
 }
 private clearMicrophone(){const stream=this.microphone,ended=this.microphoneEnded;this.microphone=null;this.microphoneEnded=null;if(stream){for(const track of stream.getTracks()){if(ended)track.removeEventListener('ended',ended);track.stop();}}}
 async publish(enabled:boolean):Promise<void>{
  if(this.disposed)throw new Error('Голосовая сессия завершена.');
  const version=++this.request;
  if(!enabled){this.clearMicrophone();this.publishing=false;this.options.send({type:'voice',enabled:false});this.options.onPublishing?.(false);for(const peer of this.peers.values())void this.serial(peer,()=>this.syncTrack(peer));return;}
  if(this.microphone&&this.track()){this.publishing=true;if(!this.options.send({type:'voice',enabled:true})){this.clearMicrophone();this.publishing=false;this.options.onPublishing?.(false);throw new Error('Нет связи с игровым сервером.');}this.options.onPublishing?.(true);return;}
  if(!this.options.audioSource&&!navigator.mediaDevices?.getUserMedia)throw new Error('Микрофон недоступен в этом браузере.');
  let stream:MediaStream;
  try{stream=await(this.options.audioSource?this.options.audioSource():navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}));}
  catch(error){if(version===this.request&&!this.disposed){this.publishing=false;this.options.send({type:'voice',enabled:false});this.options.onPublishing?.(false);}throw error;}
  if(version!==this.request||this.disposed){for(const track of stream.getTracks())track.stop();return;}
  const track=stream.getAudioTracks().find(value=>value.readyState==='live');if(!track){for(const value of stream.getTracks())value.stop();throw new Error('Микрофон не создал звуковую дорожку.');}
  this.clearMicrophone();this.microphone=stream;const ended=()=>{if(this.microphone===stream)void this.publish(false);};this.microphoneEnded=ended;track.addEventListener('ended',ended);
  this.publishing=true;
  if(!this.options.send({type:'voice',enabled:true})){this.clearMicrophone();this.publishing=false;this.options.onPublishing?.(false);throw new Error('Нет связи с игровым сервером.');}
  this.options.onPublishing?.(true);
  for(const identity of this.roster.values())if(!this.peers.has(identity.id))this.make(identity);
  await Promise.all([...this.peers.values()].map(peer=>this.serial(peer,()=>this.syncTrack(peer))));
 }
 /** Server revocation stops capture without echoing another command back. */
 permission(enabled:boolean){if(enabled||this.disposed)return;this.request++;this.clearMicrophone();this.publishing=false;this.options.onPublishing?.(false);for(const peer of this.peers.values())void this.serial(peer,()=>this.syncTrack(peer));}
 reset(){this.request++;this.clearMicrophone();this.publishing=false;this.options.onPublishing?.(false);for(const peer of [...this.peers.values()])this.remove(peer);this.roster.clear();this.selfId='';}
 dispose(){if(this.disposed)return;this.reset();this.disposed=true;}
}
