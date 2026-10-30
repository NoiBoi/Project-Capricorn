import fs from 'node:fs';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {tmpDir} from './helpers';
import {initializeProfile,profileDirectory,legacyProfiles} from '../../src/main/store/profileLocation';

const seed = (dir:string,count:number,text:string) => {
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({memory:{enabled:true}}));
  fs.writeFileSync(path.join(dir,'memory.json'),JSON.stringify(Array.from({length:count},(_,i)=>({id:`m${i}`,text:`Original ${i}`,status:'approved'}))));
  fs.writeFileSync(path.join(dir,'history.jsonl'),text);
  fs.writeFileSync(path.join(dir,'secrets.bin'),Buffer.from([4,8,15,16,23,42]));
};
describe('one physical profile for desktop and Codex launches',()=>{
  it('selects a home-relative location and preserves explicit isolated profiles',()=>{
    const home=tmpDir();expect(profileDirectory(home)).toBe(path.join(home,'Documents','Capri Buddy'));
    expect(profileDirectory(home,path.join(home,'fixture'))).toBe(path.join(home,'fixture'));
  });
  it('finds the Store Codex redirected original and adopts it without importing the empty-profile chat',()=>{
    const home=tmpDir(),roaming=path.join(home,'AppData','Roaming'),secondary=path.join(roaming,'Capri Buddy');
    const original=path.join(home,'AppData','Local','Packages','OpenAI.Codex_example','LocalCache','Roaming','Capri Buddy');
    seed(secondary,0,'secondary conversation\n');seed(original,40,'original conversation\n');
    const before=fs.readFileSync(path.join(original,'memory.json'));const target=profileDirectory(home);
    expect(initializeProfile(target,legacyProfiles(home,roaming))).toBe(original);
    expect(fs.readFileSync(path.join(target,'memory.json'))).toEqual(before);
    expect(fs.readFileSync(path.join(target,'history.jsonl'),'utf8')).toBe('original conversation\n');
    expect(fs.readFileSync(path.join(target,'secrets.bin'))).toEqual(fs.readFileSync(path.join(original,'secrets.bin')));
    expect(fs.readFileSync(path.join(original,'memory.json'))).toEqual(before);
  });
  it('never switches back or resurrects memories after the user clears the adopted profile',()=>{
    const dir=tmpDir(),original=path.join(dir,'original'),target=path.join(dir,'shared');seed(original,40,'original');
    initializeProfile(target,[original]);fs.writeFileSync(path.join(target,'memory.json'),'[]');fs.writeFileSync(path.join(target,'history.jsonl'),'current');
    expect(initializeProfile(target,[original])).toBeNull();
    expect(fs.readFileSync(path.join(target,'memory.json'),'utf8')).toBe('[]');expect(fs.readFileSync(path.join(target,'history.jsonl'),'utf8')).toBe('current');
  });
  it('does not replace an original when its saved memories are unreadable',()=>{
    const dir=tmpDir(),original=path.join(dir,'original'),target=path.join(dir,'shared');seed(original,40,'original');fs.writeFileSync(path.join(original,'memory.json'),'{torn');
    expect(()=>initializeProfile(target,[original])).toThrow();expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(path.join(original,'memory.json'),'utf8')).toBe('{torn');
  });
});
