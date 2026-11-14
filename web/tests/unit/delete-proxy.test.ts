import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('undici',()=>({Agent:class {},fetch:mocks.fetch}));
import {DELETE} from '@/app/api/rag/[...path]/route';
it('forwards scoped document DELETE and preserves pending status',async()=>{
 mocks.fetch.mockResolvedValue(new Response(JSON.stringify({status:'cleanup_pending'}),{status:202,headers:{'Content-Type':'application/json'}}));
 const response=await DELETE(new Request('http://local/api/rag/documents/11111111-1111-4111-8111-111111111111',{method:'DELETE'}),{params:Promise.resolve({path:['documents','11111111-1111-4111-8111-111111111111']})});
 expect(response.status).toBe(202);expect(await response.json()).toEqual({status:'cleanup_pending'});
 expect(mocks.fetch).toHaveBeenCalledWith(expect.stringContaining('/documents/11111111-1111-4111-8111-111111111111'),expect.objectContaining({method:'DELETE'}));
});
it('rejects non-allowlisted paths',async()=>{
 const response=await DELETE(new Request('http://local/api/rag/admin',{method:'DELETE'}),{params:Promise.resolve({path:['admin']})});
 expect(response.status).toBe(404);
});
