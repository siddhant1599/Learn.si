import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {SourceTree,phaseOf} from '@/components/chat/source-tree';
import {verdictOf} from '@/components/chat/message-list';
import type {AssistantMessage,ChatStep} from '@/core/chat/types';
vi.mock('@/core/chat/store',()=>({useChatStore:()=>({deletions:[]})}));

const step=(id:string,status:ChatStep['status'],results?:string[]):ChatStep=>({id,kind:id==='web'?'fetch':'search',label:id,status,results});
const msg=(over:Partial<AssistantMessage>):AssistantMessage=>({id:'a',role:'assistant',reasoning:'',steps:[],text:'',status:'streaming',...over});
const DOC='d1', OTHER='d2';
const cite={citation:1,document_id:DOC,document_title:'Handbook',edition:'v1',number:'3.2',kind:'Section',page:12};

it('phase follows the live steps like the demo: routing, searching, checking, answering, done',()=>{
 expect(phaseOf(undefined)).toBe('idle');
 expect(phaseOf(msg({steps:[step('triage','active')]}))).toBe('routing');
 expect(phaseOf(msg({steps:[step('triage','complete'),step('retrieve','active')]}))).toBe('searching');
 expect(phaseOf(msg({steps:[step('retrieve','complete'),step('assess','active')]}))).toBe('checking');
 expect(phaseOf(msg({steps:[step('answer','active')],text:'Labels [1]'}))).toBe('answering');
 expect(phaseOf(msg({status:'complete',text:'x'}))).toBe('done');
 expect(phaseOf(msg({status:'error'}))).toBe('ended');
});

it('the tree lights the chat documents and their cited sections',()=>{
 const docs=[{id:DOC,title:'Handbook'},{id:OTHER,title:'Other'}];
 const {rerender}=render(<SourceTree documents={docs} deletedIds={[]} message={msg({steps:[step('retrieve','active')]})}/>);
 expect(document.querySelectorAll('[data-tree-document="highlight"]')).toHaveLength(2);
 rerender(<SourceTree documents={docs} deletedIds={[]} message={msg({steps:[step('assess','active')]})}/>);
 expect(document.querySelectorAll('[data-tree-document="dragging"]')).toHaveLength(2);
 rerender(<SourceTree documents={docs} deletedIds={[OTHER]} message={msg({status:'complete',text:'Blue [1].',citations:[cite]})}/>);
 expect(document.querySelector('[data-source-tree]')).toHaveAttribute('data-phase','done');
 expect(document.querySelectorAll('[data-tree-document="done"]')).toHaveLength(1);
 expect(screen.getByText(/\[1\] Section 3.2 · Page 12/)).toBeInTheDocument();
 expect(document.querySelector('[data-tree-section="done"]')).toBeTruthy();
 expect(screen.getByText(/Other \(deleted\)/)).toBeInTheDocument();
});

it('closing card: grounded with document citations, partial when the evidence check says so, none otherwise',()=>{
 expect(verdictOf(msg({status:'complete',text:'x',citations:[cite]}))).toBe('grounded');
 expect(verdictOf(msg({status:'complete',text:'x',citations:[cite],steps:[step('assess','complete',['Partial evidence'])]}))).toBe('partial');
 expect(verdictOf(msg({status:'complete',text:'x'}))).toBeNull();
 expect(verdictOf(msg({status:'streaming',text:'x',citations:[cite]}))).toBeNull();
 expect(verdictOf(msg({status:'stopped',text:'x',citations:[cite]}))).toBeNull();
});

it('citation markers become blue chips, but not inside code',async()=>{
 const {unified}=await import('unified');
 const {rehypeCitationMarkers}=await import('@/core/streamdown/plugins');
 const tree:any={type:'root',children:[
  {type:'element',tagName:'p',properties:{},children:[{type:'text',value:'Blue [1] and red [12].'}]},
  {type:'element',tagName:'code',properties:{},children:[{type:'text',value:'arr[0]'}]}]};
 const out:any=await unified().use(rehypeCitationMarkers as any).run(tree);
 const p=out.children[0].children;
 expect(p.map((n:any)=>n.type==='element'?`<${n.children[0].value}>`:n.value).join('')).toBe('Blue <[1]> and red <[12]>.');
 expect(p[1].properties).toHaveProperty('dataCitationMarker');
 expect(out.children[1].children).toEqual([{type:'text',value:'arr[0]'}]);
});
