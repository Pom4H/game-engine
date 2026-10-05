import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DEFAULT_CHARACTER_SPEC,characterSpec} from '../dist/characters/character.js';
import {parseCharacterJSON,changedSpec,CharacterHistory,characterTypeScript} from '../tools/character-creator/model.mjs';
import {startServer} from '../tools/character-creator/server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));

test('edited JSON roundtrips exactly and a rejected edit preserves the last valid character',()=>{
  const initial=characterSpec(DEFAULT_CHARACTER_SPEC),snapshot=structuredClone(initial);
  const taller=changedSpec(initial,'body.height',2.01),edited=changedSpec(taller,'outfit.top','jacket');
  assert.deepEqual(parseCharacterJSON(JSON.stringify(edited)),edited);
  assert.deepEqual(initial,snapshot);
  assert.equal(taller.outfit.top,initial.outfit.top);
  const history=new CharacterHistory(initial);history.push(edited);
  assert.throws(()=>history.push({...edited,body:{...edited.body,height:Infinity}}),/height/);
  assert.throws(()=>changedSpec(edited,'body.height',9),/height/);
  assert.throws(()=>parseCharacterJSON('{"body":{"height":"1.88"}}'),/height/);
  assert.deepEqual(history.redo(),edited,'validation failed before history or visible state changed');
  assert.deepEqual(history.undo(),initial);
  assert.throws(()=>parseCharacterJSON(' '.repeat(65537)),/64/);
});

test('imports reject unknown and prototype-mutating fields at their source',()=>{
  const before=Object.getPrototypeOf({});
  for(const json of [
    '{"__proto__":{"height":9}}',
    '{"constructor":{"prototype":{"height":9}}}',
    '{"body":{"__proto__":{"height":9}}}',
    '{"outfit":{"cape":true}}',
  ])assert.throws(()=>parseCharacterJSON(json),/not a character field/);
  for(const path of ['__proto__.height','body.__proto__','outfit.cape'])assert.throws(()=>changedSpec(DEFAULT_CHARACTER_SPEC,path,true),/Неизвестный параметр/);
  assert.equal(Object.getPrototypeOf({}),before);
  assert.equal(Object.prototype.height,undefined);
});

test('undo retains 30 states, isolates returned values and drops redo after a new edit',()=>{
  const history=new CharacterHistory(characterSpec({seed:0}));
  for(let seed=1;seed<=40;seed++)history.push(characterSpec({seed}));
  let undos=0,current=history.redo();assert.equal(current.seed,40);
  while(history.canUndo){current=history.undo();undos++;}
  assert.equal(undos,29,'the current state plus 29 previous states form the 30-state history');
  assert.equal(current.seed,11);
  current.body.height=9;
  assert.equal(history.undo().body.height,DEFAULT_CHARACTER_SPEC.body.height,'returned snapshots cannot corrupt history');
  let redos=0;
  while(history.canRedo){current=history.redo();redos++;}
  assert.equal(redos,29);assert.equal(current.seed,40);
  assert.equal(history.undo().seed,39);
  history.push(characterSpec({seed:99}));assert.equal(history.canRedo,false);
  assert.equal(history.undo().seed,39);assert.equal(history.redo().seed,99);
  history.push(characterSpec({seed:99}));
  assert.equal(history.undo().seed,39,'pushing an unchanged recipe does not create a redundant undo step');
});

test('TypeScript export embeds the complete recipe and uses the shared runtime walker',()=>{
  const spec=changedSpec(changedSpec(DEFAULT_CHARACTER_SPEC,'colors.top','#4C6863'),'body.arms',1.18);
  const code=characterTypeScript(spec),match=code.match(/export const character = ([\s\S]*?) satisfies CharacterSpec;/);
  assert.ok(match,'a typed, directly editable CharacterSpec declaration is present');
  assert.deepEqual(JSON.parse(match[1]),spec);
  assert.match(code,/compileCharacter\(character\)/);
  assert.match(code,/entities:\s*actor\.entities/);
  assert.match(code,/walkers:\s*\[actor\.walker\]/);
  assert.match(code,/satisfies SceneSpec/);
});

test('the editor server serves the current build and metadata and restricts requests to public roots',async()=>{
  const server=await startServer({port:0,host:'127.0.0.1'}),base=`http://127.0.0.1:${server.address().port}`;
  try{
    const page=await fetch(base+'/characters/');assert.equal(page.status,200);
    assert.match(page.headers.get('content-type'),/text\/html/);assert.match(await page.text(),/id="character-canvas"/);
    const head=await fetch(base+'/characters/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    const metadataResponse=await fetch(base+'/meta.json');assert.equal(metadataResponse.status,200);
    assert.match(metadataResponse.headers.get('content-type'),/application\/json/);
    assert.equal(metadataResponse.headers.get('cache-control'),'no-store');
    const metadata=await metadataResponse.json();
    let expectedRevision=process.env.GITHUB_SHA;
    if(!expectedRevision){try{expectedRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{expectedRevision='local';}}
    assert.equal(metadata.sourceRevision,expectedRevision);assert.equal(metadata.runId,process.env.GITHUB_RUN_ID??null);
    const module=await fetch(base+'/dist/characters/character.js');assert.equal(module.status,200);
    assert.match(module.headers.get('content-type'),/javascript/);
    assert.equal(await module.text(),await readFile(new URL('../dist/characters/character.js',import.meta.url),'utf8'));
    const rejected=await fetch(base+'/meta.json',{method:'POST',body:'{}'});assert.equal(rejected.status,405);assert.equal(rejected.headers.get('allow'),'GET, HEAD');
    for(const path of [
      '/package.json',
      '/tools/character-creator/%2e%2e%2f%2e%2e%2fpackage.json',
      '/dist/%2e%2e%2fpackage.json',
      '/licenses/%2e%2e%2fpackage.json',
    ]){
      const response=await fetch(base+path);assert.ok([403,404].includes(response.status),`${path} must not escape its public directory (received ${response.status})`);
    }
  }finally{server.closeAllConnections();await new Promise(yes=>server.close(yes));}
});

test('the editor installs a real pose module and projects all declared render movers through Scene',async()=>{
  const {CharacterStudio}=await import('../tools/character-creator/studio.mjs');
  // This fixture validates the scene/module boundary, not rendered pixels.
  let frames=0;
  const renderer={setResolution(){},prepareMaterials:async()=>{},render(){frames++;},flush:async()=>{},inspect:()=>({errors:[]}),resetTemporalHistory(){},dispose(){}};
  const studio=new CharacterStudio({width:800,height:900},renderer,{sourceRevision:'fixture'});
  await studio.replace(DEFAULT_CHARACTER_SPEC);
  assert.equal(studio.scene.renderMoverIds().size,studio.actor.entities.length);
  assert.equal(studio.scene.spec.animation,undefined);
  const hand=studio.scene.entities.get(studio.actor.walker.bindings.find(b=>b.orientFrom==='rightElbow').entity);
  const before=[...hand.position];
  studio.setPose('reach',0);
  assert.notDeepEqual(hand.position,before);
  assert.equal(studio.inspect().projectionOwner,'character-studio:pose');
  assert.equal(studio.inspect().pose.mode,'reach');
  assert.ok(frames>=4);
  studio.dispose();
});
