import {CHAT_PREFIX} from '@/core/chat/cache';
import {LOCAL_CHATS_IMPORTED_KEY} from '@/core/chat/server';
import {beforeEach,it,expect,vi} from 'vitest';
import {renderHook,act,waitFor} from '@testing-library/react';
import {ChatStoreProvider,useChatStore} from '@/core/chat/store';
const mocks=vi.hoisted(()=>({stream:vi.fn(),error:vi.fn()}));
vi.mock('@/core/chat/adapter',()=>({chatAdapter:{stream:mocks.stream}}));
vi.mock('sonner',()=>({toast:{error:mocks.error,success:vi.fn(),message:vi.fn()}}));
const wrapper=({children}:any)=><ChatStoreProvider>{children}</ChatStoreProvider>;

// A small fake of the backend the store talks to.
const CHAT='11111111-1111-4111-8111-111111111111';
type Server={docs:any[];chats:any[];messages:Record<string,any[]|null>;deletions:any[];fail?:string;calls:{method:string;url:string;body?:any}[]};
let server:Server;
const summary=(over:any={})=>({id:CHAT,title:'What colour are labels?',document_ids:['doc'],updated_at:'2026-11-17T10:00:00Z',message_count:2,...over});
const savedTurn=[
 {id:1,role:'user',content:'What colour are labels?',citations:[],steps:[],warnings:[]},
 {id:2,role:'assistant',content:'Blue [1].',citations:[{citation:1,document_id:'doc',document_title:'Manual',edition:'v1',number:'2',kind:'Section',page:3}],
  warnings:['Evidence partial.'],steps:[
   {type:'progress',version:1,step:'triage',id:'triage',status:'completed',attempt:0,sequence:1,outcome:'direct_retrieval'},
   {id:'answer',kind:'write',label:'Answer prepared',status:'complete'},
   {type:'progress',version:1,step:'retrieve',id:'retrieve',status:'started',attempt:0,sequence:2}]},
];
const respond=(status:number,body:any)=>({ok:status<400,status,json:async()=>body}) as Response;
function fakeFetch(){
 return vi.fn(async(input:any,options:any={})=>{
  const url=String(input),method=options.method??'GET';
  server.calls.push({method,url,body:options.body?JSON.parse(options.body):undefined});
  if(server.fail&&url.includes(server.fail))throw new Error('Offline');
  if(url==='/api/rag/documents')return respond(200,server.docs);
  if(url==='/api/rag/deletions')return respond(200,server.deletions);
  if(url==='/api/rag/conversations')return respond(200,server.chats);
  const m=url.match(/^\/api\/rag\/conversations\/([^/?]+)(\/messages|\/import-steps)?/);
  if(m&&method==='DELETE')return respond(200,{status:'deleted'});
  if(m&&m[2]==='/import-steps')return respond(200,{matched:1});
  if(m&&m[2]==='/messages'){const rows=server.messages[m[1]!];return rows===null||rows===undefined?respond(404,{detail:'Conversation does not exist'}):respond(200,url.includes('before=')?[]:rows);}
  return respond(200,{});
 });
}
const ready=async()=>{const hook=renderHook(()=>useChatStore(),{wrapper});await waitFor(()=>expect(hook.result.current.ready).toBe(true));return hook};
const opened=async()=>{const h=await ready();await act(async()=>{await h.result.current.loadThread(CHAT)});return h};
const chatKeys=()=>Object.keys(localStorage).filter(k=>k.startsWith(CHAT_PREFIX));
beforeEach(()=>{
 localStorage.clear();
 server={docs:[{id:'doc',title:'Manual',edition:'v1'}],chats:[],messages:{},deletions:[],calls:[]};
 vi.stubGlobal('fetch',fakeFetch());
 mocks.stream.mockReset();
 mocks.stream.mockImplementation(async function*(request:any){yield {type:'session',serverThreadId:request.serverThreadId??request.newThreadId};yield {type:'text',delta:'Blue'};yield {type:'sources',citations:[],warnings:[]}});
});

it('loads real document list on mount',async()=>{const h=await ready();await waitFor(()=>expect(h.result.current.documents).toHaveLength(1));expect(fetch).toHaveBeenCalledWith('/api/rag/documents',expect.anything())});
it('exposes network errors to the UI and still becomes ready',async()=>{vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Offline')));const h=await ready();await waitFor(()=>expect(h.result.current.documentsError).toBe('Offline'));expect(h.result.current.chatsError).toBe('Offline');expect(h.result.current.threads).toEqual([])});

it('lists the server chats, with their sources, on every device',async()=>{
 server.chats=[summary({title:'x'.repeat(80)})];
 const h=await ready();
 expect(h.result.current.threads).toHaveLength(1);
 expect(h.result.current.threads[0]).toMatchObject({id:CHAT,serverThreadId:CHAT,documentIds:['doc'],loaded:false,messages:[]});
 expect(h.result.current.threads[0].title).toBe('x'.repeat(60)+'…');
});
it('opening a chat loads its messages with steps, citations and warnings from the server',async()=>{
 server.chats=[summary()];server.messages[CHAT]=savedTurn;
 const h=await opened();
 const [user,answer]=h.result.current.threads[0].messages as any[];
 expect(h.result.current.threads[0].loaded).toBe(true);
 expect(user).toMatchObject({role:'user',text:'What colour are labels?'});
 expect(answer).toMatchObject({role:'assistant',text:'Blue [1].',status:'complete',warnings:['Evidence partial.']});
 expect(answer.citations[0]).toMatchObject({document_title:'Manual',page:3});
 // Recorded progress events become the same steps the live answer showed; uploaded steps stay as they were;
 // a step that was still running when the answer was saved reads as stopped.
 expect(answer.steps.map((s:any)=>[s.label,s.status])).toEqual([['Request routed','complete'],['Answer prepared','complete'],['Searching selected documents','stopped']]);
 expect(answer.steps[0].results).toEqual(['Direct document search']);
});
it('a chat that no longer exists on the server is dropped when opened',async()=>{
 server.chats=[summary()];server.messages[CHAT]=null;
 const h=await opened();
 expect(h.result.current.threads).toEqual([]);
});
it('a failed load is reported on the chat and can be retried',async()=>{
 server.chats=[summary()];server.messages[CHAT]=savedTurn;server.fail='/messages';
 const h=await opened();
 expect(h.result.current.threads[0]).toMatchObject({loaded:false,loadError:'Offline'});
 server.fail=undefined;await act(async()=>{await h.result.current.loadThread(CHAT)});
 expect(h.result.current.threads[0].loaded).toBe(true);
});

it('rejects sending without selected documents',async()=>{const h=await ready();expect(()=>act(()=>h.result.current.send({threadId:'new',text:'Q',files:[]}))).toThrow('Select a document');expect(mocks.stream).not.toHaveBeenCalled()});
it('rejects question beyond 4000 characters',async()=>{const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));expect(()=>act(()=>h.result.current.send({threadId:'new',text:'q'.repeat(4001),files:[]}))).toThrow('Question too long');expect(mocks.stream).not.toHaveBeenCalled()});

it('a new chat asks the server to store it under its own id, and nothing goes to browser storage',async()=>{
 const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));
 act(()=>h.result.current.send({threadId:CHAT,text:'Q',files:[]}));
 await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({text:'Blue',status:'complete'}));
 expect(mocks.stream.mock.calls[0][0]).toMatchObject({newThreadId:CHAT,serverThreadId:undefined,documentIds:['doc']});
 expect(h.result.current.threads[0].serverThreadId).toBe(CHAT);
 expect(chatKeys()).toEqual([]);
});
it('a follow-up continues the saved chat with its own documents',async()=>{
 server.chats=[summary()];server.messages[CHAT]=savedTurn;
 const h=await opened();act(()=>h.result.current.setSelectedIds(['other']));
 act(()=>h.result.current.send({threadId:CHAT,text:'Followup',files:[]}));
 await waitFor(()=>expect(mocks.stream).toHaveBeenCalled());
 expect(mocks.stream.mock.calls[0][0]).toMatchObject({documentIds:['doc'],serverThreadId:CHAT,newThreadId:undefined});
});
it('retrying a first question that failed asks the server to create the chat again',async()=>{
 mocks.stream.mockImplementationOnce(async function*(request:any){yield {type:'session',serverThreadId:request.newThreadId};throw new Error('Disconnected')});
 const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));
 act(()=>h.result.current.send({threadId:CHAT,text:'Q',files:[]}));
 await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({status:'error'}));
 act(()=>h.result.current.send({threadId:CHAT,text:'Q again',files:[]}));
 await waitFor(()=>expect(mocks.stream).toHaveBeenCalledTimes(2));
 expect(mocks.stream.mock.calls[1][0]).toMatchObject({newThreadId:CHAT,serverThreadId:undefined});
});
it('stream error preserves partial output and marks failed turn',async()=>{mocks.stream.mockImplementation(async function*(){yield {type:'text',delta:'Partial'};throw new Error('Disconnected')});const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));act(()=>h.result.current.send({threadId:'new',text:'Q',files:[]}));await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({text:'Partial',status:'error',error:'Disconnected'}));expect(h.result.current.isStreaming('new')).toBe(false)});
it('keeps the web answer and its source links in the open chat',async()=>{
 mocks.stream.mockImplementation(async function*(request:any){
   yield {type:'session',serverThreadId:request.newThreadId};
   yield {type:'step',step:{id:'web',kind:'search',label:'Web research',status:'complete'}};
   yield {type:'text',delta:'From the web: finding https://example.org/sentinel'};
   yield {type:'sources',citations:[{source_type:'web',citation:2,url:'https://example.org/sentinel',title:'Web',retrieved_at:'today'}],warnings:[]};
 });
 const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));
 act(()=>h.result.current.send({threadId:CHAT,text:'Q',files:[]}));
 await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({status:'complete'}));
 const answer=h.result.current.threads[0].messages[1] as any;
 expect(answer.text).toContain('https://example.org/sentinel');
 expect(answer.citations[0]).toMatchObject({source_type:'web',url:'https://example.org/sentinel'});
});

it('other devices\' chats appear when this tab is focused again',async()=>{
 const h=await ready();expect(h.result.current.threads).toEqual([]);
 server.chats=[summary()];
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 await waitFor(()=>expect(h.result.current.threads).toHaveLength(1));
});
it('deletes the server chat, and a later list refresh cannot bring it back',async()=>{
 server.chats=[summary()];
 const h=await ready();await act(async()=>{await h.result.current.deleteChat(CHAT)});
 expect(fetch).toHaveBeenCalledWith(`/api/rag/conversations/${CHAT}`,expect.objectContaining({method:'DELETE'}));
 expect(h.result.current.threads).toEqual([]);
 await act(async()=>{window.dispatchEvent(new Event('focus'));});
 expect(h.result.current.threads).toEqual([]);
});
it('failed server deletion keeps the chat for retry',async()=>{
 server.chats=[summary()];const h=await ready();
 vi.mocked(fetch).mockResolvedValueOnce({ok:false,json:async()=>({detail:'Offline'})} as Response);
 await expect(h.result.current.deleteChat(CHAT)).rejects.toThrow('Offline');
 expect(h.result.current.threads).toHaveLength(1);
});
it('server tombstone removes a listed chat',async()=>{
 server.chats=[summary()];server.deletions=[{kind:'conversation',id:CHAT,pending:false}];
 const h=await ready();await waitFor(()=>expect(h.result.current.threads).toHaveLength(0));
});
it('document deletion keeps history but blocks follow-ups and shows pending cleanup',async()=>{
 server.chats=[summary()];server.messages[CHAT]=savedTurn;const h=await opened();
 vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({status:'cleanup_pending'})} as Response);
 await act(async()=>{await h.result.current.deleteDocument('doc')});
 expect(h.result.current.threads).toHaveLength(1);expect(h.result.current.documents).toEqual([]);
 expect(h.result.current.deletions).toContainEqual({kind:'document',id:'doc',pending:true});
 expect(()=>h.result.current.send({threadId:CHAT,text:'Followup',files:[]})).toThrow('source was deleted');
});
it('a chat that never reached the server is deleted without a server call',async()=>{
 mocks.stream.mockImplementation(async function*(){throw new Error('Offline')});
 const h=await ready();act(()=>h.result.current.setSelectedIds(['doc']));
 act(()=>h.result.current.send({threadId:CHAT,text:'Q',files:[]}));
 await waitFor(()=>expect(h.result.current.threads[0].messages[1]).toMatchObject({status:'error'}));
 await act(async()=>{await h.result.current.deleteChat(CHAT)});
 expect(vi.mocked(fetch).mock.calls.some(([,options])=>(options as any)?.method==='DELETE')).toBe(false);
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
 expect(h.result.current.threads).toEqual([]);
});

it('moves chats an older build kept in this browser to the server once, steps included',async()=>{
 const local=(id:string,serverThreadId:string|undefined)=>({thread:{id,title:'Old chat',updatedAt:1,documentIds:['doc'],serverThreadId,todos:[],messages:[
  {id:'u',role:'user',text:'Q',files:[]},
  {id:'a',role:'assistant',text:'Blue [1].',reasoning:'',status:'complete',warnings:['w'],steps:[{id:'triage',kind:'search',label:'Request routed',status:'complete'}]}]}});
 localStorage.setItem(CHAT_PREFIX+'old',JSON.stringify(local('old',CHAT)));
 localStorage.setItem(CHAT_PREFIX+'draft',JSON.stringify(local('draft',undefined)));
 localStorage.setItem('document-lab.deleted-chat.v2.gone','true');
 localStorage.setItem('document-lab.settings',JSON.stringify({depth:'pro',model:'default'}));
 await ready();
 const upload=server.calls.find(c=>c.url.endsWith('/import-steps'));
 expect(upload?.url).toBe(`/api/rag/conversations/${CHAT}/import-steps`);
 expect(upload?.body).toEqual({answers:[{content:'Blue [1].',warnings:['w'],steps:[{id:'triage',kind:'search',label:'Request routed',status:'complete'}]}]});
 // Local chat copies and their markers are gone; preferences stay; it never runs again.
 expect(chatKeys()).toEqual([]);
 expect(localStorage.getItem('document-lab.deleted-chat.v2.gone')).toBeNull();
 expect(localStorage.getItem('document-lab.settings')).not.toBeNull();
 expect(localStorage.getItem(LOCAL_CHATS_IMPORTED_KEY)).not.toBeNull();
 server.calls=[];await ready();
 expect(server.calls.some(c=>c.url.endsWith('/import-steps'))).toBe(false);
});
it('keeps an old local chat for a later try when the upload fails',async()=>{
 localStorage.setItem(CHAT_PREFIX+'old',JSON.stringify({thread:{id:'old',title:'Old',updatedAt:1,documentIds:['doc'],serverThreadId:CHAT,todos:[],messages:[
  {id:'a',role:'assistant',text:'A',reasoning:'',status:'complete',steps:[{id:'t',kind:'search',label:'L',status:'complete'}]}]}}));
 server.fail='/import-steps';
 await ready();
 expect(chatKeys()).toEqual([CHAT_PREFIX+'old']);
 expect(localStorage.getItem(LOCAL_CHATS_IMPORTED_KEY)).toBeNull();
});
it('removes unreadable old chat copies instead of retrying them forever',async()=>{
 localStorage.setItem(CHAT_PREFIX+'broken','{bad');
 localStorage.setItem('document-lab.threads','{}');
 await ready();
 expect(chatKeys()).toEqual([]);
 expect(localStorage.getItem('document-lab.threads')).toBeNull();
 expect(localStorage.getItem(LOCAL_CHATS_IMPORTED_KEY)).not.toBeNull();
});
