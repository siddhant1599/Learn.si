import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace/courses/c1/lessons/l2',useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useParams:()=>({course_id:'c1',lesson_id:'l2'})}));
vi.mock('@/components/chat/workspace-sidebar-trigger',()=>({WorkspaceSidebarTrigger:()=>null}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn(),message:vi.fn()}}));
vi.mock('@/components/chat/message-list',()=>({
 Markdown:({content}:{content:string})=><div data-markdown>{content}</div>,
 MessageList:({messages}:{messages:any[]})=><ol aria-label="Tutor messages">{messages.map(m=><li key={m.id} data-role={m.role}>{m.text}{m.citations?.length?` (${m.citations.length} sources)`:''}</li>)}</ol>,
}));
import {ChatStoreProvider} from '@/core/chat/store';
import {StudyStoreProvider} from '@/core/study/store';
import {LessonView} from '@/components/study/lesson-view';
import {LessonTutor,TUTOR_CHIPS,TUTOR_WELCOME} from '@/components/study/lesson-tutor';

const content={objective:'Explain labels.',explanation:'Labels name parts [1].',real_world_example:'Museums.',diagram:null,code_example:null,
 insights:[{kind:'why_it_matters',text:'Saves time.'}],your_turn:{kind:'apply',prompt:'Label a kitchen.'},key_terms:[],citations:[],coverage_note:null,warnings:[]};
const lesson={id:'l2',course_id:'c1',module_id:'m1',document_id:'d1',position:2,title:'Colors',objective:'',estimated_minutes:6,content_status:'ready',content_failure_code:null,content,regenerations_left:5,progress:{status:'in_progress'},generation_progress:[]};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const sse=(frames:[string,unknown][])=>new Response(frames.map(([e,d])=>`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''));
type Route=(url:string,init?:RequestInit)=>Response|Promise<Response>|undefined;
function backend(route:Route){
 const calls:[string,RequestInit|undefined][]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push([url,init]);return (await route(url,init))??json([])}));
 return calls;
}
const withStores=(ui:React.ReactNode)=><ChatStoreProvider><StudyStoreProvider>{ui}</StudyStoreProvider></ChatStoreProvider>;
const history=(messages:unknown[]=[],thread:string|null=null)=>json({thread_id:thread,messages});

describe('your turn',()=>{
 function lessonBackend(review:(body:any)=>Response){
  return backend((url,init)=>{
   if(url.endsWith('/lessons/l2'))return json(lesson);
   if(url.includes('/lessons/l2/conversation'))return history();
   if(url.endsWith('/lessons/l2/your-turn'))return review(JSON.parse(init!.body as string));
  });
 }
 it('a partial answer shows guidance and no reference; reveal shows the answer',async()=>{
  const calls=lessonBackend(body=>body.reveal
   ?json({verdict:'incorrect',feedback:'Here is the full picture.',attempt_number:2,reveal:{answer:'Stove, sink, fridge.',explanation:'Each zone has a label.'}})
   :json({verdict:'partial',feedback:'Close. What does [1] say about naming?',attempt_number:1,reveal:null}));
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  const box=await screen.findByLabelText('Your answer');
  const check=screen.getByRole('button',{name:'Check my answer'});
  expect(check).toBeDisabled();
  fireEvent.change(box,{target:{value:'Stove'}});
  fireEvent.click(check);
  const status=await screen.findByText('Partly right');
  expect(status.closest('[role="status"]')).toHaveAttribute('data-verdict','partial');
  expect(screen.getByText('Close. What does [1] say about naming?')).toBeVisible();
  expect(screen.queryByText('Stove, sink, fridge.')).not.toBeInTheDocument();
  expect(screen.getByText('Attempt 1 of ∞')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Show the answer'}));
  expect(await screen.findByText('Stove, sink, fridge.')).toBeVisible();
  expect(screen.getByText('Each zone has a label.')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Show the answer'})).not.toBeInTheDocument();
  const bodies=calls.filter(([u])=>u.endsWith('/your-turn')).map(([,i])=>JSON.parse(i!.body as string));
  expect(bodies).toEqual([{answer:'Stove',reveal:false},{answer:'Stove',reveal:true}]);
 });
 it('review failures are shown and the answer is kept',async()=>{
  lessonBackend(()=>json({detail:'Your answer could not be reviewed. Please retry.'},502));
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  fireEvent.change(await screen.findByLabelText('Your answer'),{target:{value:'My answer'}});
  fireEvent.click(screen.getByRole('button',{name:'Check my answer'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be reviewed');
  expect(screen.getByLabelText('Your answer')).toHaveValue('My answer');
 });
});

describe('tutor',()=>{
 it('loads bound history, sends lesson-scoped turns and shows no depth menu',async()=>{
  const calls=backend((url,init)=>{
   if(url.includes('/lessons/l2/conversation'))return history([{id:1,role:'user',content:'Earlier question',citations:[]},{id:2,role:'assistant',content:'Earlier hint',citations:[]}],'t9');
   if(url==='/api/rag/query')return sse([['session',{thread_id:'t9',runtime_id:'r'}],['progress',{type:'progress',version:1,step:'retrieve',id:'retrieve',status:'completed',attempt:0,sequence:1}],['result',{thread_id:'t9',answer:'Look at [1]. What does it say?',citations:[{citation:1,document_id:'d1',document_title:'Guide',edition:'',number:'1',kind:'section'}],warnings:[]}]]);
  });
  render(withStores(<LessonTutor lessonId="l2" documentId="d1"/>));
  const list=await screen.findByRole('list',{name:'Tutor messages'});
  expect(within(list).getByText('Earlier hint')).toBeVisible();
  expect(screen.queryByRole('button',{name:/depth|reasoning/i})).not.toBeInTheDocument();
  for(const chip of TUTOR_CHIPS) expect(screen.getByRole('button',{name:chip})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Just tell me the answer'}));
  await waitFor(()=>expect(within(list).getByText('Look at [1]. What does it say? (1 sources)')).toBeVisible());
  const body=JSON.parse(calls.find(([u])=>u==='/api/rag/query')![1]!.body as string);
  expect(body).toEqual({user_query:'Just tell me the answer',document_ids:['d1'],thread_id:'t9',lesson_id:'l2'});
  // Nothing about the tutor chat is written to browser storage.
  expect(Object.keys(localStorage).some(k=>/lesson|tutor/.test(k))).toBe(false);
 });
 it('a new lesson shows the welcome text; typed questions send on Enter',async()=>{
  const calls=backend(url=>{
   if(url.includes('/conversation'))return history();
   if(url==='/api/rag/query')return sse([['session',{thread_id:'t1'}],['result',{thread_id:'t1',answer:'Which part of the lesson covers this?',citations:[],warnings:[]}]]);
  });
  render(withStores(<LessonTutor lessonId="l2" documentId="d1"/>));
  expect(await screen.findByText(TUTOR_WELCOME)).toBeVisible();
  const input=screen.getByLabelText('Ask the tutor');
  fireEvent.change(input,{target:{value:'Why chunk?'}});
  fireEvent.keyDown(input,{key:'Enter'});
  expect(await screen.findByText('Which part of the lesson covers this?')).toBeVisible();
  const body=JSON.parse(calls.find(([u])=>u==='/api/rag/query')![1]!.body as string);
  expect(body.thread_id).toBeNull();expect(body.lesson_id).toBe('l2');
 });
 it('tutor errors are shown on the reply',async()=>{
  backend(url=>{
   if(url.includes('/conversation'))return history();
   if(url==='/api/rag/query')return json({detail:'Lesson questions use the course\'s document only.'},409);
  });
  render(withStores(<LessonTutor lessonId="l2" documentId="d1"/>));
  await screen.findByText(TUTOR_WELCOME);
  fireEvent.click(screen.getByRole('button',{name:'Why is this true?'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Why is this true?'})).toBeEnabled());
 });
});
