import test from 'node:test';
import assert from 'node:assert/strict';
import {M3_CAUSAL_GEOMETRY_REPRESENTATION,geometryRepresentationReport,m3GeometryRepresentationReport} from '../dist/index.js';

test('causal geometry accounting separates parameters from unexplained residual data',()=>{
  const report=geometryRepresentationReport({
    id:'fixture',
    generator:'fixture-v1',
    parameters:{width:2,segments:[.1,.2,.3]},
    reference:{sourceBytes:1000,expandedBytes:4000,triangles:100},
    residuals:[{id:'detail',kind:'packed-mesh',bytes:100,triangles:25}],
    compiled:{triangles:100},
  });
  assert.ok(report.parameterBytes>0);
  assert.equal(report.residualBytes,100);
  assert.equal(report.storedBytes,report.parameterBytes+100);
  assert.equal(report.sourceTriangleRetention,1);
  assert.ok(report.sourceToStoredRatio>1);
  assert.ok(report.expandedToStoredRatio>report.sourceToStoredRatio);
  assert.throws(()=>geometryRepresentationReport({...M3_CAUSAL_GEOMETRY_REPRESENTATION,reference:{sourceBytes:0}}),/positive/);
});

test('M3 report exposes the real procedural-versus-residual boundary',()=>{
  const report=m3GeometryRepresentationReport();
  assert.ok(report.parameterBytes<4096,report);
  assert.equal(report.residualBytes,report.residuals.reduce((sum,item)=>sum+item.bytes,0));
  assert.ok(report.sourceToParametersRatio>10,report);
  assert.ok(report.sourceToStoredRatio>1.8,report);
  assert.ok(report.expandedToStoredRatio>9,report);
  assert.ok(report.storedResidualShare>.9,report);
  assert.equal(report.sourceTriangleRetention,1);
  assert.ok(report.proceduralOnly.envelopeMeanErrorMm.width<=7);
  assert.ok(report.proceduralOnly.envelopeMeanErrorMm.top<=7);
  assert.ok(report.proceduralOnly.envelopeMeanErrorMm.bottom<=7);
  assert.ok(Number.isFinite(report.proceduralOnly.sampledSurface.symmetricMeanMm));
  assert.ok(report.proceduralOnly.sampledSurface.symmetricMeanMm>0);
  assert.ok(report.proceduralOnly.sampledSurface.hausdorffMm>=report.proceduralOnly.sampledSurface.symmetricP95Mm);
  assert.ok(report.proceduralOnly.sampledSurface.normalizedFit>0&&report.proceduralOnly.sampledSurface.normalizedFit<=1);
  assert.ok(report.detailedProcedural.storedBytes<4096,report.detailedProcedural);
  assert.ok(report.detailedProcedural.triangles>1000,report.detailedProcedural);
  assert.ok(Number.isFinite(report.detailedProcedural.sampledSurface.symmetricMeanMm));
  assert.ok(report.detailedProcedural.sampledSurface.symmetricMeanMm<35,report.detailedProcedural.sampledSurface);
  assert.ok(report.detailedProcedural.sampledSurface.symmetricP95Mm<90,report.detailedProcedural.sampledSurface);
  assert.ok(report.detailedProcedural.sampledSurface.normalizedFit>.94,report.detailedProcedural.sampledSurface);
  assert.ok(report.detailedProcedural.sampledSurface.symmetricMeanMm<report.proceduralOnly.sampledSurface.symmetricMeanMm*.35,report.detailedProcedural.sampledSurface);
  assert.ok(report.detailedProcedural.sampledSurface.symmetricP95Mm<report.proceduralOnly.sampledSurface.symmetricP95Mm*.30,report.detailedProcedural.sampledSurface);
  assert.equal(report.proceduralGlass.removedResidualBytes,3520);
  assert.ok(report.proceduralGlass.sampledSurface.symmetricMeanMm<25,report.proceduralGlass.sampledSurface);
  assert.ok(report.proceduralGlass.sampledSurface.symmetricP95Mm<65,report.proceduralGlass.sampledSurface);
  assert.ok(report.proceduralGlass.sampledSurface.normalizedFit>.96,report.proceduralGlass.sampledSurface);
  assert.ok(report.proceduralGlass.triangles>=60);
  assert.equal(report.matureWheels.removedResidualBytes,40784);
  assert.ok(Number.isFinite(report.matureWheels.rearLeftRim.symmetricMeanMm));
  assert.ok(report.matureWheels.rearLeftTire.symmetricMeanMm<10,report.matureWheels.rearLeftTire);
  assert.ok(report.matureWheels.rearLeftTire.symmetricP95Mm<25,report.matureWheels.rearLeftTire);
  assert.ok(report.matureWheels.rearAxle.symmetricMeanMm<20,report.matureWheels.rearAxle);
  assert.ok(report.matureWheels.rearAxle.symmetricP95Mm<45,report.matureWheels.rearAxle);
  assert.ok(report.matureWheels.generatedTriangles>1000);
  assert.equal(report.causalBodyGlassWheels.remainingResidualBytes,67288);
  assert.equal(report.causalBodyGlassWheels.storedBytes,report.detailedProcedural.storedBytes+67288);
  assert.ok(report.causalBodyGlassWheels.sourceToStoredRatio>3.4);
  assert.ok(report.causalBodyGlassWheels.expandedToStoredRatio>17);
  assert.equal(report.proceduralWheels.removedResidualBytes,40784);
  assert.equal(report.proceduralWheels.storedBytes,report.storedBytes-report.proceduralWheels.removedResidualBytes);
  assert.ok(report.proceduralWheels.sourceToStoredRatio>2.8);
  assert.ok(report.proceduralWheels.expandedToStoredRatio>14);
  assert.equal(report.proceduralWheels.generatedWheelParts,8);
  assert.ok(report.hybrid.shellFit>.99999);
  assert.ok(report.hybrid.shellMaxPositionErrorMm<.04);
  assert.equal(report.engine.structuralNodes,28);
  assert.ok(report.engine.sourceBodyVerticesPerStructuralNode>80);
  assert.equal(report.engine.physicsUsesRenderVertices,false);
  assert.equal(report.engine.retainedSourceTriangles,report.engine.sourceTriangles);
  console.log('M3_GEOMETRY_REPORT '+JSON.stringify(report));
});
