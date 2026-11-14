import {it,expect} from 'vitest';
import {progressStep} from '@/core/chat/progress';
import {applyChatEvent,finishAssistantMessage} from '@/core/chat/reducer';
import {persistedThread} from '@/core/chat/privacy';
import type {ChatThread,AssistantMessage} from '@/core/chat/types';
const event=(sequence=1,status='started',attempt=0)=>({version:1,step:'retrieve',id:'retrieve:q1',task:'q1',status,sequence,attempt,count:2});
const thread=():ChatThread=>({id:'t',title:'test',updatedAt:1,todos:[],messages:[{id:'a',role:'assistant',text:'',reasoning:'',steps:[],status:'streaming'}]});
it('maps safe task counts and drops arbitrary text and URLs',()=>{
 const s=progressStep({...event(),detail:'https://secret.example',outcome:'private excerpt',label:'SECRET'});
 expect(s).toMatchObject({id:'retrieve:q1',parent:'retrieve',status:'active',results:['2 evidence items']});
 expect(JSON.stringify(s)).not.toMatch(/SECRET|https|excerpt/);
});
it('rejects malformed versions, IDs, counts and unknown stages',()=>{
 expect(progressStep({...event(),version:2})).toBeUndefined();expect(progressStep({...event(),id:'secret'})).toBeUndefined();
 expect(progressStep({...event(),sequence:'1'})).toBeUndefined();expect(progressStep({step:'unknown'})).toBeUndefined();
 expect(progressStep({...event(),count:-1})?.results).toEqual([]);
});
it('legacy completion-only and running events still work',()=>{
 expect(progressStep({step:'retrieve'})?.status).toBe('complete');
 expect(progressStep({step:'retrieve',status:'started'})?.status).toBe('active');
});
it('ignores duplicate/stale events and accepts a new retry attempt',()=>{
 let t=thread();const apply=(e:ReturnType<typeof event>)=>{t=applyChatEvent(t,'a',{type:'step',step:progressStep(e)!})};
 apply(event(2,'completed'));apply(event(1));apply(event(3));
 expect((t.messages[0] as AssistantMessage).steps[0].status).toBe('complete');
 apply(event(1,'started',4));expect((t.messages[0] as AssistantMessage).steps[0].status).toBe('active');
 apply(event(2,'completed',0));expect((t.messages[0] as AssistantMessage).steps).toHaveLength(1);
 expect((t.messages[0] as AssistantMessage).steps[0].status).toBe('active');
});
it('turn completion never invents stage success and persistence omits details',()=>{
 const t=applyChatEvent(thread(),'a',{type:'step',step:progressStep(event())!});
 const m=t.messages[0] as AssistantMessage;
 expect(finishAssistantMessage(m,'complete',1).steps[0].status).toBe('stopped');
 expect((persistedThread(t).messages[0] as AssistantMessage).steps[0].results).toBeUndefined();
});
