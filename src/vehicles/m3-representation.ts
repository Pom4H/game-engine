import {compareTriangleSurfaces} from '../geometry/compare.js';
import {geometryRepresentationReport,type CausalGeometryRepresentation} from '../geometry/representation.js';
import {generateM3ProceduralWheelVehicle,generateM3Vehicle,M3_PARAMETRIC_PROFILE,M3_REFERENCE_PROVENANCE} from './m3.js';
import {M3_FBX_PARTS_FIDELITY,m3FbxParts} from './m3-fbx-parts.js';
import {M3_SHELL_FIDELITY,m3HighFidelityBody} from './m3-shell.js';
import {generateM3DetailedProceduralBody,generateM3DetailedProceduralGlass,M3_DETAILED_BODY_PARAMETERS} from './m3-detailed-procedural.js';
import {detailedPassengerWheelMeshes} from './passenger-wheel.js';
import {generatePassengerVehicle,type PassengerVehicleProfile} from './passenger.js';

/**
 * M3 as Generator + Parameters + Residual.
 *
 * The profile is the causal source used by structure/authoring. Packed meshes are
 * explicitly classified as residual information: fidelity we have not yet taught
 * the shared passenger generator to reconstruct.
 */
export const M3_CAUSAL_GEOMETRY_REPRESENTATION:CausalGeometryRepresentation<PassengerVehicleProfile>=Object.freeze({
  id:'vehicle/m3',
  generator:'passenger-profile-v1',
  parameters:M3_PARAMETRIC_PROFILE,
  reference:Object.freeze({
    sourceBytes:M3_REFERENCE_PROVENANCE.sourceBytes,
    expandedBytes:M3_REFERENCE_PROVENANCE.highFidelity.previousExpandedJsonBytes,
    triangles:M3_REFERENCE_PROVENANCE.highFidelity.sourceTriangles,
  }),
  residuals:Object.freeze([
    Object.freeze({
      id:'painted-body-shell',
      kind:'packed-mesh' as const,
      bytes:M3_SHELL_FIDELITY.binaryPayloadBytes,
      triangles:M3_SHELL_FIDELITY.triangles,
      note:'Crease-aware source body shell retained for sub-millimetre visual fidelity.',
    }),
    Object.freeze({
      id:'fbx-detail-parts',
      kind:'packed-mesh' as const,
      bytes:M3_FBX_PARTS_FIDELITY.nonBodyPayloadBytes,
      triangles:M3_FBX_PARTS_FIDELITY.sourceTriangles-M3_SHELL_FIDELITY.triangles,
      note:'Glass, mirrors, lamps, trim, exhaust and wheel hardware not yet explained by the shared generator.',
    }),
  ]),
  compiled:Object.freeze({
    triangles:M3_FBX_PARTS_FIDELITY.sourceTriangles,
    vertices:M3_SHELL_FIDELITY.packedVertices,
  }),
  fidelity:Object.freeze({
    scope:'painted body shell after uint16 position + oct8 normal packing',
    normalizedFit:M3_SHELL_FIDELITY.normalizedMaxFit,
    meanPositionErrorMm:M3_SHELL_FIDELITY.meanPositionErrorMm,
    p99PositionErrorMm:M3_SHELL_FIDELITY.p99PositionErrorMm,
    maxPositionErrorMm:M3_SHELL_FIDELITY.maxPositionErrorMm,
    meanNormalErrorDeg:M3_SHELL_FIDELITY.meanNormalErrorDeg,
    p99NormalErrorDeg:M3_SHELL_FIDELITY.p99NormalErrorDeg,
    maxNormalErrorDeg:M3_SHELL_FIDELITY.maxNormalErrorDeg,
  }),
});

export function m3GeometryRepresentationReport(){
  const report=geometryRepresentationReport(M3_CAUSAL_GEOMETRY_REPRESENTATION);
  const geometry=generateM3Vehicle(),procedural=generatePassengerVehicle(M3_PARAMETRIC_PROFILE),proceduralWheels=generateM3ProceduralWheelVehicle(),detailedBody=generateM3DetailedProceduralBody(),detailedGlass=generateM3DetailedProceduralGlass();
  const proceduralSurface=compareTriangleSurfaces(procedural.body,m3HighFidelityBody()),detailedSurface=compareTriangleSurfaces(detailedBody,m3HighFidelityBody()),detailedBytes=new TextEncoder().encode(JSON.stringify(M3_DETAILED_BODY_PARAMETERS)).byteLength;
  const translated=(parts:ReturnType<typeof m3FbxParts>)=>{const positions:number[]=[],indices:number[]=[];for(const part of parts){const base=positions.length/3;for(let i=0;i<part.mesh.positions.length;i+=3)positions.push(part.mesh.positions[i]!+part.center[0],part.mesh.positions[i+1]!+part.center[1],part.mesh.positions[i+2]!+part.center[2]);for(const index of part.mesh.indices)indices.push(base+index);}return{positions,indices};};
  const sources=m3FbxParts(),glassReference=translated(sources.filter(part=>part.sourceMaterial==='Window')),glassSurface=compareTriangleSurfaces(detailedGlass,glassReference);
  const rearLeftRim=sources.find(part=>part.id==='rim-rear-left')!,rearLeftTire=sources.find(part=>part.id==='tire-rear-left')!,generatedWheel=detailedPassengerWheelMeshes(M3_PARAMETRIC_PROFILE,-1);
  const rimSurface=compareTriangleSurfaces(generatedWheel.rim,rearLeftRim.mesh),tireSurface=compareTriangleSurfaces(generatedWheel.tire,rearLeftTire.mesh);
  const mergePlaced=(items:readonly {mesh:{positions:readonly number[];indices:readonly number[]};center:readonly[number,number,number]}[])=>{const positions:number[]=[],indices:number[]=[];for(const item of items){const base=positions.length/3;for(let i=0;i<item.mesh.positions.length;i+=3)positions.push(item.mesh.positions[i]!+item.center[0],item.mesh.positions[i+1]!+item.center[1],item.mesh.positions[i+2]!+item.center[2]);for(const index of item.mesh.indices)indices.push(base+index);}return{positions,indices};};
  const d=M3_PARAMETRIC_PROFILE.dimensions,rearX=-d.wheelbase/2+d.axleOffset,left=detailedPassengerWheelMeshes(M3_PARAMETRIC_PROFILE,-1),right=detailedPassengerWheelMeshes(M3_PARAMETRIC_PROFILE,1),generatedRearAxle=mergePlaced([{mesh:left.rim,center:[rearX,d.wheelRadius,-d.track/2]},{mesh:left.tire,center:[rearX,d.wheelRadius,-d.track/2]},{mesh:right.rim,center:[rearX,d.wheelRadius,d.track/2]},{mesh:right.tire,center:[rearX,d.wheelRadius,d.track/2]}]),referenceRearAxle=translated(sources.filter(part=>part.id==='rear-wheel-hardware'||part.id.startsWith('rim-rear-')||part.id.startsWith('tire-rear-'))),rearAxleSurface=compareTriangleSurfaces(generatedRearAxle,referenceRearAxle);
  const wheelGeometry=new Map<string,number>();
  for(const part of m3FbxParts())if((part.wheel||part.id==='front-wheel-hardware'||part.id==='rear-wheel-hardware')&&!wheelGeometry.has(part.geometry)){
    const vertices=part.mesh.positions.length/3;
    wheelGeometry.set(part.geometry,vertices*8+part.mesh.indices.length*2);
  }
  const wheelResidualBytes=[...wheelGeometry.values()].reduce((sum,value)=>sum+value,0);
  const proceduralWheelStoredBytes=report.storedBytes-wheelResidualBytes;
  return Object.freeze({
    ...report,
    proceduralOnly:Object.freeze({
      storedBytes:report.parameterBytes,
      sourceToStoredRatio:report.sourceToParametersRatio,
      envelopeMeanErrorMm:M3_REFERENCE_PROVENANCE.parametricFallbackEnvelopeMeanErrorMm,
      sampledSurface:proceduralSurface,
      note:'No M3 render residual: compact enough for structure, collision scaffolding and coarse/fallback visuals, not a 1:1 body surface.',
    }),
    detailedProcedural:Object.freeze({
      storedBytes:detailedBytes,
      sourceToStoredRatio:report.sourceBytes/detailedBytes,
      triangles:detailedBody.indices.length/3,
      sampledSurface:detailedSurface,
      note:'Mature TheGame semantic panel/sculpt generator ported without gameplay, damage or FBX geometry.',
    }),
    proceduralGlass:Object.freeze({
      removedResidualBytes:3520,
      triangles:detailedGlass.indices.length/3,
      sampledSurface:glassSurface,
      note:'Front/rear/door/quarter glass compiled from the same cowl, roof and door causes as the body.',
    }),
    matureWheels:Object.freeze({
      removedResidualBytes:40784,
      generatedTriangles:(generatedWheel.rim.indices.length+generatedWheel.tire.indices.length)/3,
      rearLeftRim:rimSurface,
      rearLeftTire:tireSurface,
      rearAxle:rearAxleSurface,
      note:'TheGame tyre profile + hollow rim + split spokes + dish + rotor/hub/nuts, measured against the unsteered rear-left FBX wheel.',
    }),
    proceduralWheels:Object.freeze({
      storedBytes:proceduralWheelStoredBytes,
      removedResidualBytes:wheelResidualBytes,
      sourceToStoredRatio:report.sourceBytes/proceduralWheelStoredBytes,
      expandedToStoredRatio:M3_REFERENCE_PROVENANCE.highFidelity.previousExpandedJsonBytes/proceduralWheelStoredBytes,
      residualShare:(report.residualBytes-wheelResidualBytes)/proceduralWheelStoredBytes,
      generatedWheelParts:proceduralWheels.parts.filter(part=>part.wheel).length,
      note:'Rims, tyres and wheel hardware are regenerated from the shared passenger wheel profile; this is an experimental storage/abstraction trade, not the current visual reference.',
    }),
    causalBodyGlassWheels:Object.freeze({
      parameterBytes:detailedBytes,
      remainingResidualBytes:67288,
      storedBytes:detailedBytes+67288,
      sourceToStoredRatio:report.sourceBytes/(detailedBytes+67288),
      expandedToStoredRatio:M3_REFERENCE_PROVENANCE.highFidelity.previousExpandedJsonBytes/(detailedBytes+67288),
      note:'Body, all glazing and road wheels are generated; only mirrors/lights/trim/exhaust remain as packed residual. This is a fidelity experiment, not yet the production representation.',
    }),
    hybrid:Object.freeze({
      storedBytes:report.storedBytes,
      sourceToStoredRatio:report.sourceToStoredRatio,
      expandedToStoredRatio:report.expandedToStoredRatio,
      retainedSourceTriangles:geometry.generatedTriangles,
      shellFit:M3_SHELL_FIDELITY.normalizedMaxFit,
      shellMaxPositionErrorMm:M3_SHELL_FIDELITY.maxPositionErrorMm,
    }),
    engine:Object.freeze({
      structuralNodes:28,
      sourceBodyVertices:M3_SHELL_FIDELITY.sourceVertices,
      packedBodyVertices:M3_SHELL_FIDELITY.packedVertices,
      sourceBodyVerticesPerStructuralNode:M3_SHELL_FIDELITY.sourceVertices/28,
      sourceTriangles:M3_FBX_PARTS_FIDELITY.sourceTriangles,
      retainedSourceTriangles:geometry.generatedTriangles,
      renderGeometryIsCompiledCache:true,
      physicsUsesRenderVertices:false,
    }),
  });
}
