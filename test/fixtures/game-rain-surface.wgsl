
fn rainRippleAt(p:vec2f,cell:vec2f,cellMetres:f32,rain:f32,time:f32,chance:f32,phaseOff:f32)->vec4f{
 if(hash(cell+vec2f(17.,phaseOff))>chance){return vec4f(0.);}
 let center=(cell+vec2f(hash(cell+vec2f(301.,phaseOff)),hash(cell+vec2f(302.,phaseOff))))*cellMetres;
 let cycle=fract(time*(1.35+phaseOff*.4)+hash(cell+vec2f(303.,phaseOff)));
 if(cycle<.42||cycle>.98){return vec4f(0.);}
 let age=(cycle-.42)/.56;
 let radius=.015+age*(.28+rain*.22);
 let dist=length(p-center);
 let ringW=.018+.012*age;
 let ring=smoothstep(radius-ringW,radius,dist)*(1.-smoothstep(radius,radius+ringW*1.4,dist));
 let blotch=(1.-smoothstep(0.,radius*.9+.015,dist))*pow(1.-age,1.2);
 let fade=(1.-smoothstep(.4,1.,age))*clamp(rain*1.4,.2,1.);
 let dir=normalize(p-center+vec2f(.0001,0.));
 return vec4f(dir*ring*fade*.7,ring*fade,blotch*fade);
}
fn rainRipple(p:vec2f,rain:f32,time:f32)->vec4f{
 if(rain<=.01){return vec4f(0.);}
 // Coarse 3 m layer always; fine 1.5 m layers only when rain is heavy enough to need them.
 let coarse=floor(p/3.);
 var r=rainRippleAt(p,coarse,3.,rain,time,.9,.17)*vec4f(1.1,1.1,1.15,1.05);
 if(rain>.55){
  let fine=floor(p/1.5);
  r+=rainRippleAt(p,fine,1.5,rain,time,.88+rain*.1,0.);
  r+=rainRippleAt(p,fine+vec2f(1.,0.),1.5,rain,time,.75,.31);
 }else if(rain>.28){
  let fine=floor(p/1.5);
  r+=rainRippleAt(p,fine,1.5,rain,time,.82+rain*.1,0.)*vec4f(.9,.9,.95,.9);
 }
 return min(r,vec4f(1.4,1.4,1.2,1.2));
}
// Stick-slip beads in continuous body metres [forward, lateral] — not mesh UV (quads restart UV per face).
// rain is falling intensity 0..1: spawn density and strength scale with it (not surface wetness).
fn roofDropLayer(p:vec2f,rain:f32,time:f32,flow:vec2f,cell:f32,speed:f32,seed:f32)->vec4f{
 let row=floor(p.x/cell);let stagger=select(0.,.5,((i32(row)&1)==1));
 let id=vec2f(floor(p.x/cell),floor(p.y/cell-stagger));
 // Light drizzle ≈ few percent of cells; heavy rain fills toward ~45%.
 if(hash(id+vec2f(11.,seed))>clamp(.04+rain*.42,.03,.48)){return vec4f(0.);}
 let n=vec3f(hash(id+vec2f(1.,seed)),hash(id+vec2f(2.,seed)),hash(id+vec2f(3.,seed)));
 let center=vec2f((id.x+n.x*.82+.09)*cell,(id.y+stagger+n.y*.82+.09)*cell);
 let ti=fract(time*speed+n.z);
 let fall=ti+.06*sin(ti*28.+n.y*6.28)*ti*(1.-ti);
 let slide=flow*((fall-.5)*cell*.55);
 let toDrop=p-(center+slide);
 let dropR=(.028+.02*n.y)*(1.+rain*.4);
 let drop=1.-smoothstep(dropR*.4,dropR,length(toDrop));
 let trailAlong=dot(p-center,flow);let trailAcross=dot(p-center,vec2f(-flow.y,flow.x));
 let trail=smoothstep(dropR*2.2,dropR*.15,abs(trailAcross))*(1.-smoothstep(0.,cell*.45,trailAlong))*step(0.,trailAlong)*(1.-fall)*.35*rain;
 let wet=clamp(drop+trail,0.,1.)*smoothstep(.02,.55,rain);
 let bump=normalize(-toDrop+vec2f(.0002))*drop*smoothstep(.02,.55,rain);
 let rim=smoothstep(.2,.75,length(toDrop)/max(dropR,.001))*(1.-smoothstep(.75,1.35,length(toDrop)/max(dropR,.001)))*drop*smoothstep(.02,.55,rain);
 return vec4f(bump*wet,rim+drop*.4*smoothstep(.02,.55,rain),wet);
}
fn roofMicroBeads(p:vec2f,rain:f32)->vec4f{
 let cell=.22;let id=floor(p/cell);let n=vec3f(hash(id+vec2f(7.,1.)),hash(id+vec2f(8.,2.)),hash(id+vec2f(9.,3.)));
 if(n.z>clamp(.02+rain*.22,.015,.28)){return vec4f(0.);}
 let local=p-((id+n.xy*.78+.11)*cell);
 let amount=smoothstep(.02,.5,rain);
 let bead=(1.-smoothstep(.014,.032,length(local)))*amount;
 let bump=normalize(-local+vec2f(.0002))*bead;
 return vec4f(bump*.5,bead*.7,bead*.4);
}
fn roofRainBead(p:vec2f,rain:f32,time:f32,wind:vec2f)->vec4f{
 if(rain<=.02){return vec4f(0.);}
 let wash=wind+vec2f(.06+rain*.18,.02+rain*.04);
 let flow=wash/max(length(wash),.001);
 let slide=clamp(.1+rain*.18+length(wind)*.02,.1,.32);
 var r=roofDropLayer(p,rain,time,flow,.38,slide,0.);
 // Second layer only once rain is past a light drizzle.
 r+=roofDropLayer(p,rain,time,flow,.52,slide*.85,1.7)*smoothstep(.2,.65,rain)*.75;
 r+=roofMicroBeads(p,rain);
 return min(r,vec4f(1.2,1.2,1.1,1.));
}