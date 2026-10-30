// Six bounded recall cases against the actual Stage 1 helper and current implementation. No models.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-recall-check-'));
const baseline=execFileSync('git',['show','9b88880:src/main/ai/promptContext.ts'],{encoding:'utf8',windowsHide:true});
await build({stdin:{contents:baseline,loader:'ts',resolveDir:path.resolve('src/main/ai')},outfile:path.join(dir,'baseline.cjs'),bundle:true,platform:'node',format:'cjs'});
await build({entryPoints:['src/main/ai/promptContext.ts'],outfile:path.join(dir,'current.cjs'),bundle:true,platform:'node',format:'cjs'});
const require=createRequire(import.meta.url),old=require(path.join(dir,'baseline.cjs')),current=require(path.join(dir,'current.cjs'));
const cases=[
  {name:'Indirect graph reference',query:'Remember the node spaghetti?',user:'I opened a wiring patch with branching connections.',reply:'I wanted to understand the signal routes.',expected:true},
  {name:'Color paraphrase',query:'Which hue did you favor?',user:'I am comparing green and purple swatches.',reply:'I prefer the vivid purple.',expected:true},
  {name:'Music paraphrase',query:'That melody you enjoyed?',user:'I played a song yesterday.',reply:'I prefer rough guitars.',expected:true},
  {name:'Exact project reference',query:'The ceramic fox glaze?',user:'I am building a ceramic fox and testing cobalt glaze.',reply:'I like the blue glaze.',expected:true},
  {name:'Unrelated question',query:'How high was the boiler pressure?',user:'I opened a wiring patch with branching connections.',reply:'Those routes looked interesting.',expected:false},
  {name:'Uncovered paraphrase',query:'The sculpting sandbox from earlier?',user:'I opened Blender to inspect a mesh viewport.',reply:'I wanted to understand that geometry.',expected:true},
];
const results=cases.map(c=>{
  const history=[{id:'u',role:'user',content:c.user,ts:1800000000000},{id:'a',role:'assistant',content:c.reply,ts:1800000000001}];
  const before=old.recalledExchanges(history,c.query,new Set()),after=current.recalledExchanges(history,c.query,new Set());
  return{...c,baseline:before,current:after,baselineMatchesExpectation:!!before.length===c.expected,currentMatchesExpectation:!!after.length===c.expected};
});
const output={scope:'Illustrative fixed local recall cases, not a general semantic benchmark. Both functions are real implementation code.',baselineCommit:'9b88880',baselineCorrect:results.filter(r=>r.baselineMatchesExpectation).length,currentCorrect:results.filter(r=>r.currentMatchesExpectation).length,total:results.length,results};
fs.mkdirSync('docs/stage2',{recursive:true});fs.writeFileSync('docs/stage2/retrieval-results.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({baseline:output.baselineCorrect,current:output.currentCorrect,total:output.total}));
