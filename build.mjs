// Build both static sites from the same source tree.
import {build} from 'vite';
import {relative} from 'node:path';
const base='/twilightcup/';
// Deployment-only URL mappings before Vue/Vite compile and content hashing.
// Fail closed if an upstream change invalidates the reviewed expressions.
const rules = new Map(Object.entries({
  'src/api/config.ts': [[': "/api";', `: "${base}api";`], ['${globalThis.location.host}/ws/', '${globalThis.location.host}'+base+'ws/']],
  'src/stores/director.ts': [['${globalThis.location.origin}/${page}', '${globalThis.location.origin}'+base+'${page}']],
  'src/utils/officialLevels.ts': [['`/LevelBGs/${levelId}.png`','`'+base+'LevelBGs/${levelId}.png`']],
  'src/scenes/soon/SoonScene.vue': [['const DEFAULT_LOGO = "/logo.png";', `const DEFAULT_LOGO = "${base}logo.png";`]],
  'src/components/RoleSwitcher.vue': [['window.open(path,', `window.open("${base.slice(0,-1)}" + path,`]],
}));
const seen=new Set();
const adapter={name:'twilightcup-deployment-urls',enforce:'pre', transform(code,id){
  const key=relative(process.cwd(),id); if(!rules.has(key)) return;
  for(const [a,b] of rules.get(key)){if(code.split(a).length!==2) throw Error(`Review URL mapping: ${key}: ${a}`); code=code.replace(a,()=>b);}
  seen.add(key);return {code,map:null};
}};
const opts=outDir=>({outDir,emptyOutDir:true,reportCompressedSize:false});
await build({base:'/',logLevel:'warn',build:opts('legacy-dist')});
await build({base,plugins:[adapter],logLevel:'warn',build:opts('prefix-dist')});
if(seen.size!==rules.size) throw Error('Not all expected subpath mappings applied');
