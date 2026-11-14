import {CHAT_PREFIX,readChats} from '@/core/chat/cache';
import {beforeEach,it,expect,vi} from 'vitest';
import {renderHook,act,waitFor} from '@testing-library/react';
import {ChatStoreProvider,useChatStore} from '@/core/chat/store';
const mocks=vi.hoisted(()=>({stream:vi.fn(),error:vi.fn()}));
vi.mock('@/core/chat/adapter',()=>({chatAdapter:{stream:mocks.stream}}));
vi.mock('sonner',()=>({toast:{error:mocks.error,success:vi.fn(),message:vi.fn()}}));
const wrapper=({children}:any)=><ChatStoreProvider>{children}</ChatStoreProvider>;
const saved=()=>({id:'t',title:'Old chat',updatedAt:1,documentIds:['doc'],serverThreadId:'backend',todos:[],messages:[{id:'a',role:'assistant',text:'partial',reasoning:'',steps:[],status:'streaming'}]});
const ready=async()=>{const hook=renderHook(()=>useChatStore(),{wrapper});await waitFor(()=>expect(hook.result.current.ready).toBe(true));return hook};
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>[{id:'doc',title:'Manual',edition:'v1'}]}));mocks.stream.mockImplementation(async function*(){yield {type:'session',serverThreadId:'backend'};yield {type:'text',delta:'Blue'};yield {type:'sources',citations:[],warnings:[]}})});
it('loads real document list on mount',async()=>{const h=await ready();await waitFor(()=>expect(h.result.current.documents).toHaveLength(1));expect(fetch).toHaveBeenCalledWith('/api/rag/documents',expect.anything())});
it('exposes document network errors to the UI',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Offline')));const h=await ready();await waitFor(()=>expect(h.result.current.documentsError).toBe('Offline'))});
it('restores recent browser conversation and source IDs',async()=>{localStorage.setItem('document-lab.threads',JSON.stringify([saved()]));const h=await ready();expect(h.result.current.threads[0].documentIds).toEqual(['doc']);expect(h.result.current.threads[0].serverThreadId).toBe('backend')});
it('settles interrupted restored answer to stopped',async()=>{localStorage.setItem('document-lab.threads',JSON.stringify([saved()]));const h=await ready();expect(h.result.current.threads[0].messages[0]).toMatchObject({status:'stopped',text:'partial'})});
it('invalid stored JSON does not crash workspace',async()=>{localStorage.setItem('document-lab.threads','{bad');const h=await ready();expect(h.result.current.threads).toEqual([])});
it('rejects sending without selected documents',async()=>{const h=await ready();expect(()=>act(()=>h.result.current.send({threadId:'new',text:'Q',files:[]}))).toThrow('Select a document');expect(mocks.stream).not.toHaveBeenCalled()});
it('rejects question beyond 4000 characters',async()=>{const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));expect(()=>act(()=>h.result.current.send({threadId:'new',text:'q'.repeat(4001),files:[]}))).toThrow('Question too long');expect(mocks.stream).not.toHaveBeenCalled()});
it('successful stream persists answer and backend session',async()=>{const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));act(()=>h.result.current.send({threadId:'new',text:'Q',files:[]}));await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({text:'Blue',status:'complete'}));expect(h.result.current.threads[0].serverThreadId).toBe('backend');expect(readChats(localStorage).threads[0].serverThreadId).toBe('backend')});
it('follow-up uses immutable thread selection',async()=>{const t=saved();t.messages[0].status='complete';localStorage.setItem('document-lab.threads',JSON.stringify([t]));const h=await ready();act(()=>h.result.current.setSelectedIds(['other']));act(()=>h.result.current.send({threadId:'t',text:'Followup',files:[]}));await waitFor(()=>expect(mocks.stream).toHaveBeenCalled());expect(mocks.stream.mock.calls[0][0]).toMatchObject({documentIds:['doc'],serverThreadId:'backend'})});
it('stream error preserves partial output and marks failed turn',async()=>{mocks.stream.mockImplementation(async function*(){yield {type:'text',delta:'Partial'};throw new Error('Disconnected')});const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));act(()=>h.result.current.send({threadId:'new',text:'Q',files:[]}));await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({text:'Partial',status:'error',error:'Disconnected'}));expect(h.result.current.isStreaming('new')).toBe(false)});

it('keeps web response live while persisting only the safe answer',async()=>{
 mocks.stream.mockImplementation(async function*(){
   yield {type:'step',step:{id:'web',kind:'search',label:'Web research',status:'complete'}};
   yield {type:'text',delta:'External excerpt https://example.org/sentinel'};
   yield {type:'persistence',text:'Document answer. Web source links not retained.',citations:[]};
   yield {type:'sources',citations:[{source_type:'web',citation:2,url:'https://example.org/sentinel',title:'Web',retrieved_at:'today'}],warnings:[]};
 });
 const h=await ready();
 act(()=>h.result.current.setSelectedIds(['doc']));
 act(()=>h.result.current.send({threadId:'new',text:'Q',files:[]}));
 await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({status:'complete'}));
 expect(h.result.current.threads[0].messages[1].text).toContain('https://example.org/sentinel');
 const saved=(localStorage.getItem(CHAT_PREFIX+'new') ?? '');
 expect(saved).not.toContain('sentinel');
 expect(saved).not.toContain('External excerpt');
 expect(saved).toContain('Document answer');
});

it('never persists an interrupted automatic web draft',async()=>{
 let interrupt!:()=>void;
 const paused=new Promise<void>(resolve=>{interrupt=resolve});
 mocks.stream.mockImplementation(async function*(){
   yield {type:'step',step:{id:'web',kind:'search',label:'Web research',status:'complete'}};
   yield {type:'text',delta:'Transient external secret'};
   await paused;
   throw new Error('Disconnected');
 });
 const h=await ready();
 act(()=>h.result.current.setSelectedIds(['doc']));
 act(()=>h.result.current.send({threadId:'new',text:'Q',files:[]}));
 await waitFor(()=>expect(h.result.current.threads[0].messages[1].text).toContain('Transient external secret'));
 expect(localStorage.getItem(CHAT_PREFIX+'new') ?? '').not.toContain('Transient external secret');
 act(()=>interrupt());
 await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({status:'error'}));
 expect(localStorage.getItem(CHAT_PREFIX+'new') ?? '').not.toContain('Transient external secret');
});

it('deletes server chat and prevents stale cache restoration',async()=>{
 localStorage.setItem('document-lab.threads',JSON.stringify([saved()]));
 const h=await ready();await act(async()=>{await h.result.current.deleteChat('t')});
 expect(fetch).toHaveBeenCalledWith('/api/rag/conversations/backend',expect.objectContaining({method:'DELETE'}));
 expect(h.result.current.threads).toEqual([]);
 localStorage.setItem('document-lab.threads',JSON.stringify([saved()]));
 expect(readChats(localStorage).threads).toEqual([]);
});
it('failed server deletion keeps the local chat for retry',async()=>{
 localStorage.setItem('document-lab.threads',JSON.stringify([saved()]));const h=await ready();
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,json:async()=>({detail:'Offline'})} as Response);
 await expect(h.result.current.deleteChat('t')).rejects.toThrow('Offline');
 expect(h.result.current.threads).toHaveLength(1);
});
it('server tombstone removes a restored stale chat',async()=>{
 localStorage.setItem('document-lab.threads',JSON.stringify([saved()]));
 vi.stubGlobal('fetch',vi.fn(async(url)=>({ok:true,json:async()=>url==='/api/rag/deletions'?[{kind:'conversation',id:'backend',pending:false}]:[]})));
 const h=await ready();await waitFor(()=>expect(h.result.current.threads).toHaveLength(0));
});
it('document deletion keeps history but blocks follow-ups and shows pending cleanup',async()=>{
 localStorage.setItem('document-lab.threads',JSON.stringify([saved()]));const h=await ready();
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({status:'cleanup_pending'})} as Response);
 await act(async()=>{await h.result.current.deleteDocument('doc')});
 expect(h.result.current.threads).toHaveLength(1);expect(h.result.current.documents).toEqual([]);
 expect(h.result.current.deletions).toContainEqual({kind:'document',id:'doc',pending:true});
 expect(()=>h.result.current.send({threadId:'t',text:'Followup',files:[]})).toThrow('source was deleted');
});
it('browser-only draft deletion does not call server DELETE',async()=>{
 const draft={...saved(),serverThreadId:undefined};localStorage.setItem('document-lab.threads',JSON.stringify([draft]));
 const h=await ready();await act(async()=>{await h.result.current.deleteChat('t')});
 expect(vi.mocked(fetch).mock.calls.some(([,options])=>options?.method==='DELETE')).toBe(false);
 expect(h.result.current.threads).toEqual([]);
});
it('late stream events cannot recreate a deleted active chat',async()=>{
 let finish!:()=>void;const pause=new Promise<void>(r=>{finish=r});
 mocks.stream.mockImplementation(async function*(){yield {type:'session',serverThreadId:'active-server'};await pause;yield {type:'text',delta:'Late answer'};});
 const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));
 act(()=>h.result.current.send({threadId:'active',text:'Question',files:[]}));
 await waitFor(()=>expect(h.result.current.threads[0].serverThreadId).toBe('active-server'));
 await act(async()=>{await h.result.current.deleteChat('active')});act(()=>finish());
 await waitFor(()=>expect(h.result.current.isStreaming('active')).toBe(false));
 expect(h.result.current.threads).toEqual([]);expect(readChats(localStorage).threads).toEqual([]);
});
it('does not claim browser-only deletion when its tombstone cannot be saved',async()=>{
 localStorage.setItem('document-lab.threads',JSON.stringify([{...saved(),serverThreadId:undefined}]));
 const h=await ready();const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota')});
 await expect(h.result.current.deleteChat('t')).rejects.toThrow('Browser storage is unavailable');
 expect(h.result.current.threads).toHaveLength(1);write.mockRestore();
});
