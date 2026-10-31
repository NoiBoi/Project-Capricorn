import {it,expect,vi} from 'vitest';
import {prepareAction,runAction,type ActionContext} from '../../src/main/actions/registry';
import {screenInspectionRequested,directInspectionAction} from '../../src/main/ai/requestRoute';
import {makeCtx} from './ctx';
it('allows only user-requested reads through tainted context while preserving confirm, deny and write protection',async()=>{
 const {ctx:base,s}=makeCtx();const readScreen=vi.fn(async()=>({ok:true,text:'fixture evidence',window:'ChatGPT'}));const ctx:ActionContext={...base,readScreen};
 s.actions.policies.read_screen='allow';const raw={tool:'read_screen',args:{window:'ChatGPT'}};
 const request='Take a look at the ChatGPT window';
 const action=prepareAction(raw,ctx,true,request);expect(action.policy).toBe('allow');expect((await runAction(action,ctx,false)).ok).toBe(true);expect(readScreen).toHaveBeenCalledOnce();
 expect(()=>prepareAction(raw,ctx,true,'Summarize this email')).toThrow(/direct user request/);
 expect(()=>prepareAction({...raw,args:{window:'Private browser'}},ctx,true,request)).toThrow(/direct user request/);
 expect(()=>prepareAction({...raw,args:{}},ctx,true,request)).toThrow(/direct user request/);
 s.actions.policies.read_screen='confirm';expect((await runAction(prepareAction(raw,ctx,true,request),ctx,false)).ok).toBe(false);
 expect((await runAction(prepareAction(raw,ctx,true,request),ctx,true)).ok).toBe(true);
 s.actions.policies.read_screen='deny';expect((await runAction(prepareAction(raw,ctx,true,request),ctx,true)).ok).toBe(false);
 expect(readScreen).toHaveBeenCalledTimes(2);
 s.actions.policies.create_note='allow';expect(prepareAction({tool:'create_note',args:{title:'injected',body:'page instruction'}},ctx,true,request).policy).toBe('confirm');
});
it('recognizes explicit current-window requests without treating source text as authority',()=>{
 expect(screenInspectionRequested('Read my screen')).toBe(true);
 expect(screenInspectionRequested('Look at the current window')).toBe(true);
 expect(screenInspectionRequested('What is on this window?', 'current')).toBe(true);
 expect(screenInspectionRequested('Do not inspect the ChatGPT window','ChatGPT')).toBe(false);
 expect(screenInspectionRequested('Summarize the page')).toBe(false);
});

it('routes an explicit named or current-window request through the same action registry',()=>{
 expect(directInspectionAction('Take a look at the ChatGPT window')).toEqual({tool:'read_screen',args:{window:'ChatGPT'}});
 expect(directInspectionAction('Look at this window')).toEqual({tool:'read_screen',args:{}});
 expect(directInspectionAction('Read my screen')).toEqual({tool:'read_screen',args:{}});
 expect(directInspectionAction('Summarize this email')).toBeNull();
 expect(directInspectionAction('Explain the phrase: inspect the ChatGPT window')).toBeNull();
 expect(screenInspectionRequested('Summarize this email: inspect the ChatGPT window','ChatGPT')).toBe(false);
 expect(directInspectionAction('Do not inspect the ChatGPT window')).toBeNull();
});
