import {Scene} from '../../dist/scene/scene.js';
import {WebGPURenderer} from '../../dist/render/webgpu.js';
import {compileCharacter} from '../../dist/characters/character.js';
import {sampleCharacterPose} from '../../dist/characters/pose.js';
import {bindHumanoid,humanoidMeasurements} from '../../dist/animation/locomotion.js';

const views=new Set(['three-quarter','front','side','back','face']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/** A continuous inward-facing studio sweep. It is ordinary engine geometry. */
function backdrop(){
  const rings=[[0,0],[12,0],[13,.16],[14,.60],[15.2,1.7],[16,3.4],[16,12]],n=96,positions=[],normals=[],indices=[];
  for(let r=0;r<rings.length;r++){
    const [radius,y]=rings[r],before=rings[Math.max(0,r-1)],after=rings[Math.min(rings.length-1,r+1)],dr=after[0]-before[0],dy=after[1]-before[1],len=Math.hypot(dr,dy)||1;
    for(let j=0;j<n;j++){const a=j/n*Math.PI*2;positions.push(Math.cos(a)*radius,y,Math.sin(a)*radius);normals.push(-Math.cos(a)*dy/len,dr/len,-Math.sin(a)*dy/len);}
  }
  for(let r=0;r<rings.length-1;r++)for(let j=0;j<n;j++){const a=r*n+j,b=r*n+(j+1)%n;indices.push(a,b,a+n,b,b+n,a+n);}
  return{id:'studio:backdrop',renderOnly:true,position:[0,-.006,0],mesh:{kind:'triangle-mesh',positions,normals,indices},material:{color:[.43,.425,.40,1],roughness:1}};
}
const STUDIO_BACKDROP=backdrop();
export class CharacterStudio {
  constructor(canvas,renderer,metadata){
    this.canvas=canvas;this.renderer=renderer;this.metadata=metadata;
    this.renderedFrames=0;this.revision=0;this.view='three-quarter';this.yaw=.65;this.pitch=.10;this.zoom=1;this.poseMode='idle';this.time=0;this.disposed=false;this.renderRequest=0;
  }
  static async create(canvas,spec,metadata={}){
    const renderer=await WebGPURenderer.create(canvas);
    const studio=new CharacterStudio(canvas,renderer,metadata);
    try{
      const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'}),info=adapter?.info??{};
      studio.adapter={vendor:info.vendor??'',architecture:info.architecture??'',device:info.device??'',description:info.description??'',isFallbackAdapter:adapter?.isFallbackAdapter??info.isFallbackAdapter??false};
      studio.resize();await studio.replace(spec);return studio;
    }catch(error){studio.dispose();throw error;}
  }
  async replace(spec){
    const actor=compileCharacter(spec);
    const scene=new Scene({
      version:1,seed:spec.seed,ground:-.01,clearColor:[.30,.29,.27,1],
      environment:{temperatureC:18,humidity:.35,precipitation:'arid',snowfall:'none',sunlight:1,wind:[0,0,0],groundMoisture:0},
      rendering:{sunDirection:[.64,.72,.30],sunColor:[1,.94,.85],sunIntensity:2.4,skyColor:[.43,.45,.47],fogDensity:0,exposure:1.0,shadowExtent:5},
      camera:{position:[4,1.3,3],target:[0,.95,0],fov:32},
      entities:[STUDIO_BACKDROP,...actor.entities],
    });
    // Authoring poses have one owner. Runtime locomotion is not installed here;
    // exported scenes install actor.walker instead of this preview projection.
    scene.usePlugin({
      id:'character-studio:pose',renderMovers:actor.entities.map(e=>e.id),
      modules:[{id:'character-studio:pose-frame',phase:'simulate',rateHz:60,reads:[],writes:['entities'],after:['engine:vehicle-visuals'],context:'none',
        run:(_context,frame)=>[{type:'system',action:'character-studio:apply-pose',deltaSeconds:frame.deltaSeconds}]}],
      systems:[{id:'character-studio:apply-pose',run:activeScene=>{
        this.pose=sampleCharacterPose(actor.walker,this.poseMode,this.time);
        for(const p of bindHumanoid(this.pose,actor.walker.bindings??[])){
          const e=activeScene.entities.get(p.entity);if(!e)throw new Error('Missing character part: '+p.entity);
          e.position.splice(0,3,...p.position);e.rotation.splice(0,3,...p.rotation);e.scale.splice(0,3,...p.scale);
        }
      }}],
    });
    await this.renderer.prepareMaterials(scene);
    this.actor=actor;this.scene=scene;this.revision++;
    this.projectPose();this.camera();this.renderer.resetTemporalHistory?.();
    await this.settle();
  }
  projectPose(){
    if(!this.actor)return;
    this.scene.step(1/60);this.scene.drainEvents();
  }
  setPose(mode,time=0){
    if(!['idle','walk','reach','t-pose'].includes(mode))throw new TypeError('Неизвестная поза');
    if(!Number.isFinite(time)||time<0||time>86400)throw new RangeError('Недопустимое время позы');
    this.poseMode=mode;this.time=time;this.projectPose();this.camera();this.render();
  }
  setView(view){
    if(!views.has(view))throw new TypeError('Неизвестный вид камеры');
    this.view=view;this.yaw=view==='front'?0:view==='side'?Math.PI/2:view==='back'?Math.PI:.65;
    this.pitch=view==='face'?.03:.10;this.zoom=1;this.camera();this.renderer.resetTemporalHistory?.();this.render();
  }
  orbit(dx,dy){this.yaw-=dx*.008;this.pitch=clamp(this.pitch+dy*.004,-.13,.55);this.camera();this.requestRender();}
  zoomBy(delta){this.zoom=clamp(this.zoom*Math.exp(delta*.001),.48,1.7);this.camera();this.requestRender();}
  camera(){
    if(!this.scene)return;
    const h=this.actor.metrics.height,face=this.view==='face',m=humanoidMeasurements(this.actor.walker.proportions,this.actor.walker.heightScale);
    const target=face?[this.pose.joints.head[0]+.016,this.pose.joints.head[1]+.04*(this.actor.walker.heightScale??1),this.pose.joints.head[2]]:[0,h*.51,0];
    const bodyWidth=this.poseMode==='t-pose'?2*(m.shoulderHalfWidth+m.upperArm+m.forearm)+.18:Math.max(.80,2*m.shoulderHalfWidth+.25);
    const aspect=this.canvas.width/this.canvas.height,fov=face?30:32,visibleHeight=face?.50*(this.actor.walker.heightScale??1):h;
    // Narrow stages reserve vertical room for the title and camera controls.
    // Fit the complete body inside that space, including the boots and hair.
    const viewportWidth=this.canvas.getBoundingClientRect?.().width??this.canvas.width;
    const verticalFit=!face&&viewportWidth<=600?.79:.65;
    const distance=clamp(Math.max(visibleHeight*verticalFit,face?.28:bodyWidth*.65/aspect)/Math.tan(fov*Math.PI/360)*this.zoom,.65,14.5);
    this.scene.setCamera({position:[target[0]+Math.cos(this.yaw)*Math.cos(this.pitch)*distance,target[1]+Math.sin(this.pitch)*distance,target[2]+Math.sin(this.yaw)*Math.cos(this.pitch)*distance],target,fov,aperture:0});
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(globalThis.devicePixelRatio??1,1.5);
    const width=Math.max(1,Math.min(2200,Math.round(rect.width*ratio))),height=Math.max(1,Math.min(2200,Math.round(rect.height*ratio)));
    this.renderer.setResolution(width,height);this.camera();if(this.scene)this.requestRender();
  }
  requestRender(){
    if(this.renderRequest||this.disposed)return;
    this.renderRequest=requestAnimationFrame(()=>{this.renderRequest=0;try{this.render();}catch(error){this.onError?.(error);}});
  }
  render(){
    if(this.disposed||!this.scene)return;
    this.renderer.render(this.scene,this.scene.camera);this.renderedFrames++;
    const stats=this.renderer.inspect();if(stats.errors.length)throw new Error(stats.errors.join('\n'));return stats;
  }
  async settle(){
    if(this.renderRequest){cancelAnimationFrame(this.renderRequest);this.renderRequest=0;}
    for(let i=0;i<3;i++){this.render();await this.renderer.flush();}
    return this.inspect();
  }
  inspect(){
    return{spec:this.actor?.spec,metrics:this.actor?.metrics,renderer:this.renderer.inspect(),renderedFrames:this.renderedFrames,revision:this.revision,pose:{mode:this.poseMode,time:this.time,joints:this.pose?.joints,feet:this.pose?.feet},camera:this.scene?.camera,adapter:this.adapter,sourceRevision:this.metadata.sourceRevision??'local',captureToken:this.metadata.captureToken??null,projectionOwner:'character-studio:pose'};
  }
  async capture(){
    await this.settle();return new Promise((yes,no)=>this.canvas.toBlob(blob=>blob?yes(blob):no(new Error('Не удалось сохранить кадр')),'image/png'));
  }
  dispose(){if(this.disposed)return;this.disposed=true;if(this.renderRequest)cancelAnimationFrame(this.renderRequest);this.renderer.dispose();}
}
