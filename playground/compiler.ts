import * as dsl from '../src/dsl/index.js';
import {prepareCompilation} from './source-compiler.js';
/** Node harness helper. Browser compilation and untrusted execution live in separate workers. */
export function compileSource(source:string):{program:unknown;bindings:import('./source-document.js').Binding[]} {
 const prepared=prepareCompilation(source),output:Record<string,unknown>={};
 const require=(id:string)=>{if(id!=='@rom4/game-engine/dsl')throw new TypeError(`Доступен только импорт @rom4/game-engine/dsl, получен ${id}`);return dsl;};
 new Function('exports','require','__dslTrace',prepared.javascript)(output,require,prepared.index.trace);
 if(!output.default)throw new TypeError('Нужен export default scene(...)');return {program:output.default,bindings:prepared.index.bindings()};
}
