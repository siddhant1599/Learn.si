import {it,expect} from 'vitest';
import {CHAT_PREFIX,readChats,saveChat,markChatDeleted,restoreSettings} from '@/core/chat/cache';
import type {ChatThread} from '@/core/chat/types';
const thread=(id='a'):ChatThread=>({id,title:id,updatedAt:1,documentIds:['doc'],todos:[],messages:[]});
it('separate stale-tab saves retain both records',()=>{
 const a=readChats(localStorage),b=readChats(localStorage);
 expect(a.threads).toEqual(b.threads);
 saveChat(localStorage,thread('a'));saveChat(localStorage,thread('b'));
 expect(readChats(localStorage).threads.map(t=>t.id)).toEqual(['a','b']);
});
it('same chat uses last completed save without duplicating other chats',()=>{
 saveChat(localStorage,thread('b'));
 saveChat(localStorage,{...thread(),title:'first'});
 saveChat(localStorage,{...thread(),title:'last'});
 expect(readChats(localStorage).threads.find(t=>t.id==='a')?.title).toBe('last');
 expect(readChats(localStorage).threads).toHaveLength(2);
});
it.each(['{}','null','42','"text"','{bad','[{}]'])('invalid legacy %s is recoverable without throwing',raw=>{
 localStorage.setItem('document-lab.threads',raw);saveChat(localStorage,thread());
 expect(readChats(localStorage)).toMatchObject({invalid:true,threads:[thread()]});
 expect(localStorage.getItem('document-lab.threads')).toBe(raw);
});
it('mixed legacy records preserve good records and the invalid original',()=>{
 localStorage.setItem('document-lab.threads',JSON.stringify([thread(),{...thread('bad'),messages:{}}]));
 expect(readChats(localStorage).threads).toEqual([thread()]);
 expect(localStorage.getItem('document-lab.threads')).not.toBeNull();
});
it('migration never overwrites a newer record',()=>{
 localStorage.setItem('document-lab.threads',JSON.stringify([thread()]));
 saveChat(localStorage,{...thread(),title:'newer'});
 expect(readChats(localStorage).threads[0].title).toBe('newer');
 expect(localStorage.getItem('document-lab.threads')).toBeNull();
});
it('tombstones win over stale saves, old migration and racing record writes',()=>{
 markChatDeleted(localStorage,'a');
 expect(saveChat(localStorage,thread())).toBe(false);
 localStorage.setItem(CHAT_PREFIX+'a',JSON.stringify({thread:thread()}));
 localStorage.setItem('document-lab.threads',JSON.stringify([thread()]));
 expect(readChats(localStorage).threads).toEqual([]);
});
it('invalid nested v2 records do not discard a valid neighboring chat',()=>{
 saveChat(localStorage,thread('good'));
 localStorage.setItem(CHAT_PREFIX+'bad',JSON.stringify({thread:{...thread('bad'),messages:[{id:'m',role:'assistant',text:'x',status:'complete',steps:[null]}]}}));
 expect(readChats(localStorage)).toMatchObject({invalid:true,threads:[thread('good')]});
});
it('invalid settings fall back field by field',()=>{
 const fallback={mode:'pro' as const,model:'default'};
 expect(restoreSettings({mode:{},model:[]},fallback)).toEqual(fallback);
 expect(restoreSettings(null,fallback)).toEqual(fallback);
 expect(restoreSettings({mode:'flash',model:42},fallback)).toEqual({...fallback,mode:'flash'});
});
it('private web content is sanitized before a per-chat write',()=>{
 const t=thread();
 t.messages=[{id:'m',role:'assistant',text:'secret https://example.org',reasoning:'',steps:[],status:'complete',webRequested:true,persistedAnswer:'Document only'}];
 saveChat(localStorage,t);
 expect(localStorage.getItem(CHAT_PREFIX+'a')).not.toContain('secret');
 expect(readChats(localStorage).threads[0].messages[0].text).toBe('Document only');
});
