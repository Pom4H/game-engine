const normalOutput='out.normal=vec4<f32>(n*.5+.5,roughness);';

/** Diagnostic MRT observation. Keep production radiance and all of its inputs
 * live; only the normal attachment receives the selected lighting observations.
 * Subsequent effects consume probe data, so their images are not quality QA. */
const probes={
 scalars:{value:'shadow,roughness,normalVariance,nl',channels:['shadow visibility','final roughness','normal derivative variance','sun normal cosine clamped to zero']},
 environment:{value:'fallbackEnvironment,nv',channels:['environment radiance red','environment radiance green','environment radiance blue','view normal cosine']},
 'velocity-input':{value:'in.velocity,geometricNormal.y,u.weather.z',channels:['interpolated velocity x','interpolated velocity y','geometric normal y','object weather seed']},
 'material-input':{value:'u.color.rgb,unpack2x16float(31743u).x',channels:['material input red','material input green','material input blue','source index encoded as normal binary16 word plus 1024; 31743 marks non-instanced geometry']},
 'world-input':{value:'in.worldPos,-1.0',channels:['fragment world position x','fragment world position y','fragment world position z','exact float32 source index; -1 marks regular geometry']},
};

export function lightingProbe(source,kind='scalars'){
 if(!probes[kind])throw new Error('Unknown lighting probe '+kind);
 if(!source.includes(normalOutput))return source;
 if(source.split(normalOutput).length!==2)throw new Error('Unexpected material normal output');
 const instanced=source.includes('var<private> instance:PackedInstance;');
 let value=probes[kind].value;
 if(instanced)value=value.replace('u.weather.z','instance.weather.z').replace('u.color.rgb','instance.color.rgb').replace('unpack2x16float(31743u).x','unpack2x16float(input.sourceIndex+1024u).x').replace('in.worldPos,-1.0','in.worldPos,f32(input.sourceIndex)');
 return source.replace(normalOutput,'out.normal=vec4<f32>('+value+');');
}

export const lightingProbeChannels=kind=>{if(!probes[kind])throw new Error('Unknown lighting probe '+kind);return probes[kind].channels;};
