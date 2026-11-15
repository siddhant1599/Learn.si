import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
const nav=vi.hoisted(()=>({pathname:'/workspace/courses/c1/lessons/l2',push:vi.fn(),replace:vi.fn(),search:new URLSearchParams()}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>nav.pathname,useRouter:()=>({push:nav.push,replace:nav.replace}),useSearchParams:()=>nav.search,useParams:()=>({course_id:'c1',lesson_id:'l2'})}));
vi.mock('@/components/chat/workspace-sidebar-trigger',()=>({WorkspaceSidebarTrigger:()=>null}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn(),message:vi.fn()}}));
// jsdom cannot run Mermaid or Shiki; the Markdown pipeline has its own tests.
vi.mock('@/components/chat/message-list',()=>({Markdown:({content}:{content:string})=><div data-markdown>{content}</div>}));
import {ChatStoreProvider} from '@/core/chat/store';
import {StudyStoreProvider} from '@/core/study/store';
import {LessonView} from '@/components/study/lesson-view';
import {QuizView} from '@/components/study/quiz-view';
import type {LessonContent,LessonDetail} from '@/core/study/types';

const cite={citation:1,document_id:'d1',document_title:'Guide',edition:'v1',number:'2.1',kind:'section',page:4};
const content=(over:Partial<LessonContent>={}):LessonContent=>({
 objective:'Explain why labels help readers.',explanation:'Labels name parts [1].',real_world_example:'A museum labels exhibits.',
 diagram:{kind:'mermaid',source:'flowchart TD\n  A --> B',caption:'Labels guide readers.'},
 code_example:{language:'python',code:'def area(w, h):\n    return TODO(you)',explanation:'Area multiplies sides.',todo:{marker:'TODO(you)',instruction:'Return the area.'}},
 insights:[{kind:'why_it_matters',text:'Saves time.'},{kind:'misconception',text:'Labels are not decoration.'}],
 your_turn:{kind:'code_gap',prompt:'Fill in the TODO(you) line.'},
 key_terms:[{term:'Label',definition:'A short name.'}],citations:[cite],coverage_note:null,warnings:[],...over});
const lesson=(over:Partial<LessonDetail>={}):LessonDetail=>({id:'l2',course_id:'c1',module_id:'m1',document_id:'d1',position:2,title:'Colors',objective:'Use colors',estimated_minutes:6,content_status:'ready',content_failure_code:null,content:content(),regenerations_left:5,progress:{status:'in_progress'},...over});
const course={id:'c1',document_id:'d1',title:'Guide',status:'ready',estimated_minutes:12,module_count:1,lesson_count:2,completed_lessons:1,next_lesson_id:'l2',
 modules:[{id:'m1',position:1,title:'Basics',summary:'',estimated_minutes:12,lessons:[
  {id:'l1',module_id:'m1',position:1,title:'Labels',objective:'',estimated_minutes:6,content_status:'ready',status:'completed'},
  {id:'l2',module_id:'m1',position:2,title:'Colors',objective:'',estimated_minutes:6,content_status:'ready',status:'in_progress'}]}],progress:[]};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const sse=(frames:[string,unknown][])=>new Response(frames.map(([e,d])=>`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''));
type Route=(url:string,init?:RequestInit)=>Response|Promise<Response>|undefined;
function backend(route:Route){
 const calls:[string,RequestInit|undefined][]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push([url,init]);return (await route(url,init))??(url.endsWith('/courses/c1')?json(course):json([]))}));
 return calls;
}
const withStores=(ui:React.ReactNode)=><ChatStoreProvider><StudyStoreProvider>{ui}</StudyStoreProvider></ChatStoreProvider>;
beforeEach(()=>{nav.push.mockReset();nav.replace.mockReset();nav.search=new URLSearchParams()});

describe('lesson view',()=>{
 it('renders every content block from the contract',async()=>{
  backend(url=>url.endsWith('/lessons/l2')?json({...lesson(),generation_progress:[]}):undefined);
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  for(const name of ['Explanation','Real-world example','Diagram','Code example','Key terms','Your turn'])
   expect(await screen.findByRole('heading',{level:2,name})).toBeVisible();
  expect(screen.getByRole('heading',{level:1,name:'Colors'})).toBeVisible();
  expect(await screen.findByText('Basics')).toBeVisible();  // Module in the breadcrumb.
  expect(screen.getByText(/≈ 6 min \(estimate only/)).toBeVisible();
  // Insight callouts are notes with their kind's label.
  expect(screen.getByRole('note',{name:'Why it matters'})).toHaveTextContent('Saves time.');
  expect(screen.getByRole('note',{name:'Common misconception'})).toBeVisible();
  // TODO(you) is highlighted inside a focusable, scrollable code block.
  const code=screen.getByLabelText('python code example');
  expect(code).toHaveAttribute('tabindex','0');
  expect(code.querySelector('[data-gap="true"]')).toHaveTextContent('return TODO(you)');
  expect(screen.getByText(/flowchart TD/)).toBeVisible();
  expect(screen.getByText('Labels guide readers.')).toBeVisible();
  expect(screen.getByText('A short name.')).toBeVisible();
  expect(screen.getByLabelText('Sources')).toHaveTextContent('[1] Guide · Page 4');
  expect(screen.getByLabelText('Your answer')).toBeVisible();
  expect(screen.getByRole('link',{name:'Take the quiz'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l2/quiz');
 });
 it('optional blocks are absent when the lesson has none',async()=>{
  backend(url=>url.endsWith('/lessons/l2')?json({...lesson({content:content({diagram:null,code_example:null,your_turn:{kind:'apply',prompt:'Apply it.'},coverage_note:'Limited source coverage: few facts.'})}),generation_progress:[]}):undefined);
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  await screen.findByRole('heading',{name:'Explanation'});
  expect(screen.queryByRole('heading',{name:'Diagram'})).not.toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'Code example'})).not.toBeInTheDocument();
  expect(screen.getAllByRole('note').some(n=>/Limited source coverage/.test(n.textContent!))).toBe(true);
 });
 it('shows generation progress, then the content, with the quiz disabled meanwhile',async()=>{
  let polled=0;
  backend(url=>{
   if(url.endsWith('/lessons/l2/events'))return sse([['progress',{type:'progress',version:1,step:'write',id:'write',status:'started',attempt:0,sequence:3}],['status',{content_status:'ready'}]]);
   if(url.endsWith('/lessons/l2'))return json(polled++?{...lesson(),generation_progress:[]}:{...lesson({content_status:'generating',content:null}),generation_progress:[{type:'progress',version:1,step:'evidence',id:'evidence',status:'completed',attempt:0,sequence:2}]});
  });
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  expect(await screen.findByRole('heading',{name:'Explanation'})).toBeVisible();
  expect(polled).toBe(2);
 });
 it('while generating: progress rows and a disabled quiz button',async()=>{
  backend(url=>{
   if(url.endsWith('/lessons/l2/events'))return new Promise<Response>(()=>{});
   if(url.endsWith('/lessons/l2'))return json({...lesson({content_status:'generating',content:null}),generation_progress:[{type:'progress',version:1,step:'evidence',id:'evidence',status:'completed',attempt:0,sequence:2,count:3}]});
  });
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  expect(await screen.findByRole('heading',{name:'Writing this lesson'})).toBeVisible();
  expect(screen.getByText("Lesson sources gathered")).toBeVisible();
  expect(screen.getByRole('button',{name:'Take the quiz'})).toBeDisabled();
  expect(screen.getByText('The quiz opens once the lesson is ready.')).toBeVisible();
 });
 it('a failed lesson explains why and retries through regenerate',async()=>{
  const calls=backend((url,init)=>{
   if(url.endsWith('/regenerate')&&init?.method==='POST')return json({...lesson({content_status:'generating',content:null}),generation_progress:[]},202);
   if(url.endsWith('/lessons/l2/events'))return new Promise<Response>(()=>{});
   if(url.endsWith('/lessons/l2'))return json({...lesson({content_status:'failed',content:null,content_failure_code:'ungrounded'}),generation_progress:[]});
  });
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  expect(await screen.findByText("The draft's citations could not be verified against the document.")).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  expect(await screen.findByRole('heading',{name:'Writing this lesson'})).toBeVisible();
  expect(calls.some(([u,i])=>u==='/api/rag/lessons/l2/regenerate'&&i?.method==='POST')).toBe(true);
 });
 it('locked lessons link to the previous lesson and never show content',async()=>{
  backend(url=>url.endsWith('/lessons/l2')?json({...lesson({content:null,progress:{status:'locked'}}),generation_progress:[]}):undefined);
  render(withStores(<LessonView courseId="c1" lessonId="l2"/>));
  expect(await screen.findByText('This lesson is locked')).toBeVisible();
  expect(await screen.findByRole('link',{name:'Go to the previous lesson'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l1');
  expect(screen.queryByRole('button',{name:'Take the quiz'})).not.toBeInTheDocument();
  expect(screen.queryByRole('link',{name:'Take the quiz'})).not.toBeInTheDocument();
 });
});

const q=(id:string,stem:string)=>({id,stem,bloom_level:'recall',options:['a','b','c','d'].map(o=>({id:o,text:`${stem} option ${o}`}))});
const open={attempt_id:'a1',lesson_id:'l2',attempt_number:1,questions:[q('q1','First?'),q('q2','Second?'),q('q3','Third?')]};
const result=(correct:boolean,id:string)=>({id,stem:`${id} stem`,options:open.questions[0]!.options,chosen:correct?'b':'a',correct,correct_option_id:'b',explanation_for_chosen:correct?null:'A is wrong because.',explanation_for_correct:'B is right because.',citation:cite});

describe('quiz view',()=>{
 function quizBackend(submitBody:unknown,status=200){
  return backend((url,init)=>{
   if(url.endsWith('/lessons/l2'))return json({...lesson(),generation_progress:[]});
   if(url.endsWith('/lessons/l2/quiz-attempts')&&init?.method==='POST')return json(open,201);
   if(url.endsWith('/quiz-attempts/a1/submit'))return json(submitBody,status);
   if(url.endsWith('/lessons/l2/quiz-attempts'))return json([]);
  });
 }
 const choose=(question:string,option:string)=>fireEvent.click(within(screen.getByRole('group',{name:new RegExp(question)})).getByRole('radio',{name:new RegExp(`option ${option}$`)}));

 it('starts an attempt, keeps a refresh-safe URL and enables submit only when all three are answered',async()=>{
  const calls=quizBackend({});
  render(withStores(<QuizView courseId="c1" lessonId="l2"/>));
  await screen.findByText('First?');
  expect(nav.replace).toHaveBeenCalledWith('/workspace/courses/c1/lessons/l2/quiz?attempt=a1');
  expect(calls.filter(([u,i])=>u.endsWith('/quiz-attempts')&&i?.method==='POST')).toHaveLength(1);
  const submit=screen.getByRole('button',{name:'Submit answers'});
  expect(submit).toBeDisabled();
  choose('First','a');choose('Second','b');
  expect(screen.getByText('2 of 3 answered')).toBeVisible();
  expect(submit).toBeDisabled();
  choose('Third','c');
  expect(submit).toBeEnabled();
  expect(document.body.textContent).not.toMatch(/correct_option_id|explanation/);
 });
 it('a pass shows results with explanations and offers the next lesson',async()=>{
  const calls=quizBackend({attempt_id:'a1',lesson_id:'l2',attempt_number:1,status:'submitted',score:2,passed:true,lesson_status:'completed',unlocked_lesson_id:'l3',
   questions_with_results:[result(true,'q1'),result(true,'q2'),result(false,'q3')]});
  render(withStores(<QuizView courseId="c1" lessonId="l2"/>));
  await screen.findByText('First?');
  choose('First','b');choose('Second','b');choose('Third','a');
  fireEvent.click(screen.getByRole('button',{name:'Submit answers'}));
  expect(await screen.findByText('2/3 · Passed')).toBeVisible();
  expect(screen.getByRole('link',{name:'Next lesson'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l3');
  expect(screen.getByText('A is wrong because.')).toBeVisible();
  expect(screen.getAllByText('B is right because.')).toHaveLength(3);
  expect(screen.getByText('Question 3: incorrect')).toBeVisible();
  const body=JSON.parse(calls.find(([u])=>u.endsWith('/submit'))![1]!.body as string);
  expect(body).toEqual({answers:{q1:'b',q2:'b',q3:'a'}});
  // The library refreshes so completion and the unlock show without reload.
  await waitFor(()=>expect(calls.filter(([u])=>u==='/api/rag/courses').length).toBeGreaterThan(0));
 });
 it('a fail offers a retake with a new attempt and no next lesson',async()=>{
  quizBackend({attempt_id:'a1',lesson_id:'l2',attempt_number:1,status:'submitted',score:1,passed:false,lesson_status:'in_progress',unlocked_lesson_id:null,
   questions_with_results:[result(true,'q1'),result(false,'q2'),result(false,'q3')]});
  render(withStores(<QuizView courseId="c1" lessonId="l2"/>));
  await screen.findByText('First?');
  choose('First','b');choose('Second','a');choose('Third','a');
  fireEvent.click(screen.getByRole('button',{name:'Submit answers'}));
  expect(await screen.findByText('1/3 · Not passed')).toBeVisible();
  expect(screen.queryByRole('link',{name:'Next lesson'})).not.toBeInTheDocument();
  expect(screen.getByText(/You need 2 of 3/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Retake with new questions'}));
  await waitFor(()=>expect(nav.replace).toHaveBeenCalledTimes(2));
 });
 it('a superseded attempt (409) offers a new attempt; network errors keep answers',async()=>{
  let fail:'network'|'conflict'='network';
  backend((url,init)=>{
   if(url.endsWith('/lessons/l2'))return json({...lesson(),generation_progress:[]});
   if(url.endsWith('/lessons/l2/quiz-attempts')&&init?.method==='POST')return json(open,201);
   if(url.endsWith('/submit')){if(fail==='network')throw new TypeError('offline');return json({detail:'This attempt was already abandoned. Start a new attempt.'},409)}
  });
  render(withStores(<QuizView courseId="c1" lessonId="l2"/>));
  await screen.findByText('First?');
  choose('First','a');choose('Second','a');choose('Third','a');
  fireEvent.click(screen.getByRole('button',{name:'Submit answers'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
  expect(screen.getByText('3 of 3 answered')).toBeVisible();
  fail='conflict';
  fireEvent.click(screen.getByRole('button',{name:'Submit answers'}));
  expect(await screen.findByRole('button',{name:'Start a new attempt'})).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('abandoned');
 });
 it('refresh reloads the same open attempt instead of starting a new one',async()=>{
  nav.search=new URLSearchParams('attempt=a1');
  const calls=backend((url,init)=>{
   if(url.endsWith('/quiz-attempts/a1'))return json({...open,status:'open'});
   if(url.endsWith('/lessons/l2'))return json({...lesson(),generation_progress:[]});
   if(init?.method==='POST')return json({detail:'should not start'},500);
  });
  render(withStores(<QuizView courseId="c1" lessonId="l2"/>));
  expect(await screen.findByText('First?')).toBeVisible();
  expect(calls.some(([,i])=>i?.method==='POST')).toBe(false);
 });
});
