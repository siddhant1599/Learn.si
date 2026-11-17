import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('undici',()=>({Agent:class {},fetch:mocks.fetch}));
import {DELETE,GET,POST} from '@/app/api/rag/[...path]/route';
const ID='11111111-1111-4111-8111-111111111111';
const call=(method:'GET'|'POST'|'DELETE',path:string)=>{
 const handler={GET,POST,DELETE}[method];
 return handler(new Request(`http://local/api/rag/${path}`,{method,...(method==='POST'?{body:'{}',headers:{'Content-Type':'application/json'}}:{})}),{params:Promise.resolve({path:path.split('/')})});
};
it('forwards scoped document DELETE and preserves pending status',async()=>{
 mocks.fetch.mockResolvedValue(new Response(JSON.stringify({status:'cleanup_pending'}),{status:202,headers:{'Content-Type':'application/json'}}));
 const response=await call('DELETE',`documents/${ID}`);
 expect(response.status).toBe(202);expect(await response.json()).toEqual({status:'cleanup_pending'});
 expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining(`/documents/${ID}`),expect.objectContaining({method:'DELETE'}));
});
it('rejects non-allowlisted paths',async()=>{
 expect((await call('DELETE','admin')).status).toBe(404);
 expect((await call('GET','courses/../documents')).status).toBe(404);
 expect((await call('GET','lessons')).status).toBe(404);
 expect((await call('POST',`quiz-attempts/${ID}/grade`)).status).toBe(404);
 expect((await call('GET',`courses/${ID}/lessons`)).status).toBe(404);
 expect(mocks.fetch).not.toHaveBeenCalled();
});
it.each([
 ['GET','courses'],['POST','courses'],['GET',`courses/${ID}`],['DELETE',`courses/${ID}`],['GET',`courses/${ID}/events`],['GET',`courses/${ID}/progress`],
 ['GET',`lessons/${ID}`],['GET',`lessons/${ID}/events`],['POST',`lessons/${ID}/regenerate`],['POST',`lessons/${ID}/quiz-attempts`],['GET',`lessons/${ID}/quiz-attempts`],
 ['POST',`lessons/${ID}/your-turn`],['GET',`lessons/${ID}/conversation`],['POST',`lessons/${ID}/study-time`],['POST',`quiz-attempts/${ID}/submit`],['GET',`quiz-attempts/${ID}`],['GET','progress'],
] as const)('forwards Master-mode %s %s',async(method,path)=>{
 mocks.fetch.mockResolvedValue(new Response('{}',{status:200,headers:{'Content-Type':'application/json'}}));
 const response=await call(method,path);
 expect(response.status).toBe(200);
 expect(mocks.fetch).toHaveBeenCalledWith(`http://127.0.0.1:8001/${path}`,expect.objectContaining({method}));
});
it.each([
 ['GET','conversations'],['GET',`conversations/${ID}/messages`],['DELETE',`conversations/${ID}`],['POST',`conversations/${ID}/import-steps`],
] as const)('forwards server-stored chat %s %s',async(method,path)=>{
 mocks.fetch.mockResolvedValue(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));
 const response=await call(method,path);
 expect(response.status).toBe(200);
 expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining(`/${path}`),expect.objectContaining({method}));
});
it('rejects chat paths outside the list, messages, delete and step import',async()=>{
 mocks.fetch.mockClear();
 expect((await call('GET',`conversations/${ID}/steps`)).status).toBe(404);
 expect((await call('GET','conversations/../documents')).status).toBe(404);
 expect(mocks.fetch).not.toHaveBeenCalled();
});
