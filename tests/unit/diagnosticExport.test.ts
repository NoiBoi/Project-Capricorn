import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectDiagnosticFiles,diagnosticRedactor,DiagnosticTraces} from '../../src/main/diagnosticExport';

describe('diagnostic exports',()=>{
  it('preserves evidence content while removing credentials, private entries and pixels',()=>{
    const redact=diagnosticRedactor(['actual-fixture-secret']);
    const result=redact({memories:[{text:'Home is a meaningful place.'}],messages:[{content:'ordinary context'},{meta:{private:true},content:'private context'}],password:'hunter2',token:'oauth-token',prompt:'Known key actual-fixture-secret; https://user:pass@example.com/?token=hidden',jpegBase64:'pixels'});
    const text=JSON.stringify(result);
    expect(text).toContain('ordinary context');expect(text).toContain('Home is a meaningful place.');
    for(const sensitive of ['actual-fixture-secret','hunter2','oauth-token','private context','pixels','user:pass','token=hidden'])expect(text).not.toContain(sensitive);
  });
  it('bounds trace memory, snapshots inputs, and clears when retention is disabled',()=>{
    let allowed=true;const traces=new DiagnosticTraces(()=>allowed,diagnosticRedactor());
    const input={messages:[{content:'original'}]};traces.record('chat','input',input);input.messages[0].content='mutated';
    expect(JSON.stringify(traces.snapshot())).toContain('original');
    for(let i=0;i<45;i++)traces.record('chat','reply',{i});
    expect(traces.snapshot().entries).toHaveLength(40);expect(traces.snapshot().dropped).toBe(6);
    allowed=false;expect(traces.snapshot().entries).toEqual([]);
    allowed=true;expect(traces.snapshot().entries).toEqual([]);
  });
  it('inventories incomplete stores without copying browser or secret files',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capri-export-'));
    try{
      fs.writeFileSync(path.join(dir,'memory.json'),'[{"text":"retained memory"}]');
      fs.writeFileSync(path.join(dir,'history.jsonl'),'{"content":"history"}\n');
      fs.writeFileSync(path.join(dir,'settings.json'),'malformed');
      fs.writeFileSync(path.join(dir,'secrets.bin'),'never copy this');
      fs.writeFileSync(path.join(dir,'Cookies'),'never copy this');
      const files=collectDiagnosticFiles(dir);
      expect(files.data['memory.json']).toEqual([{text:'retained memory'}]);
      expect(files.inventory.find(i=>i.file==='settings.json')?.state).toBe('error');
      expect(files.inventory.find(i=>i.file==='notes.json')?.state).toBe('absent');
      expect(JSON.stringify(files)).not.toContain('never copy this');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
});
