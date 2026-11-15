import {beforeEach,describe,it,expect,vi} from 'vitest';
import {act,render,screen,fireEvent,within,waitFor} from '@testing-library/react';
const nav=vi.hoisted(()=>({pathname:'/workspace/courses',push:vi.fn()}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>nav.pathname,useRouter:()=>({push:nav.push,replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(),useParams:()=>({course_id:'c1'})}));
vi.mock('@/components/chat/workspace-sidebar-trigger',()=>({WorkspaceSidebarTrigger:()=>null}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn(),message:vi.fn()}}));
import {ChatStoreProvider} from '@/core/chat/store';
import {StudyStoreProvider,reconcileCourses} from '@/core/study/store';
import {followCourse,stepsFrom} from '@/core/study/api';
import {COURSES_KEY,readCourses,writeCourses} from '@/core/study/cache';
import {formatMinutes,failureReason} from '@/core/study/format';
import type {CourseSummary,CourseView} from '@/core/study/types';
import {CoursesLibrary} from '@/components/study/courses-library';
import {CourseDetail} from '@/components/study/course-detail';
import {CourseCard} from '@/components/study/course-card';

const summary=(over:Partial<CourseSummary>={}):CourseSummary=>({id:'c1',document_id:'d1',title:'Guide',status:'ready',failure_code:null,estimated_minutes:45,module_count:2,lesson_count:4,completed_lessons:1,next_lesson_id:'l2',...over});
const view=(over:Partial<CourseView>={}):CourseView=>({...summary(),modules:[{id:'m1',position:1,title:'Basics',summary:'',estimated_minutes:10,lessons:[
 {id:'l1',module_id:'m1',position:1,title:'Labels',objective:'',estimated_minutes:5,content_status:'pending',status:'completed'},
 {id:'l2',module_id:'m1',position:2,title:'Colors',objective:'',estimated_minutes:5,content_status:'pending',status:'locked'}]}],...over});
const progress=(step:string,status:string,sequence:number,extra={})=>({type:'progress',version:1,step,id:step,status,attempt:0,sequence,...extra});
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const sse=(frames:[string,unknown][])=>new Response(frames.map(([e,d])=>`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});

type Route=(url:string,init?:RequestInit)=>Response|Promise<Response>|undefined;
function backend(route:Route){
 const calls:[string,RequestInit|undefined][]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push([url,init]);return (await route(url,init))??json([])}));
 return calls;
}
const withStores=(ui:React.ReactNode)=><ChatStoreProvider><StudyStoreProvider>{ui}</StudyStoreProvider></ChatStoreProvider>;
beforeEach(()=>{nav.pathname='/workspace/courses';nav.push.mockReset()});

describe('format and cache',()=>{
 it('formats informational estimates and safe failure reasons',()=>{
  expect(formatMinutes(45)).toBe('≈ 45 min');expect(formatMinutes(80)).toBe('≈ 1 h 20 min');expect(formatMinutes(0)).toBe('');
  expect(failureReason('timeout')).toBe('Planning took too long.');
  expect(failureReason('<script>')).toBe('Planning failed.');
 });
 it('caches only IDs, titles, statuses and counts',()=>{
  writeCourses(localStorage,[{...summary(),modules:[{title:'secret lesson text'}],objective:'private'} as any]);
  const raw=localStorage.getItem(COURSES_KEY)!;
  expect(raw).not.toMatch(/secret|private|modules/);
  expect(readCourses(localStorage)).toEqual([summary()]);
  localStorage.setItem(COURSES_KEY,'{bad');expect(readCourses(localStorage)).toEqual([]);
  localStorage.setItem(COURSES_KEY,JSON.stringify([{id:'x',status:'weird'}]));expect(readCourses(localStorage)).toEqual([]);
 });
 it('tombstones for a course or its document remove it',()=>{
  const courses=[summary(),summary({id:'c2',document_id:'d2'}),summary({id:'c3',document_id:'d3'})];
  expect(reconcileCourses(courses,[{kind:'document',id:'d2'},{kind:'course',id:'c3'}]).map(c=>c.id)).toEqual(['c1']);
  expect(reconcileCourses(courses,[{kind:'conversation',id:'c1'}])).toBe(courses);
 });
});

describe('generation follower',()=>{
 it('SSE events update steps and the final status reloads the course',async()=>{
  backend(url=>url.endsWith('/events')?sse([['progress',progress('outline','started',1)],['progress',progress('outline','completed',2,{count:3})],['progress',progress('topics','started',3,{task:'w1',id:'topics:w1',parent:'topics'})],['status',{status:'ready'}]])
   :url.includes('/courses/c1')?json({...view(),progress:[]}):undefined);
  const updates:any[]=[];
  const final=await followCourse('c1',{course:view({status:'generating'}),steps:[]},{signal:new AbortController().signal,onUpdate:d=>updates.push(d),wait:async()=>{}});
  expect(final.course.status).toBe('ready');
  const steps=updates.at(-1).steps;
  expect(steps.find((s:any)=>s.id==='outline')).toMatchObject({status:'complete',label:'Document read',results:['3 sections']});
  expect(steps.find((s:any)=>s.id==='topics:w1')).toMatchObject({label:'Topics in part 1',parent:'topics'});
 });
 it('falls back to polling when the stream errors',async()=>{
  let polls=0;
  const calls=backend(url=>{
   if(url.endsWith('/events'))return new Response('nope',{status:502});
   polls++;return json({...view({status:polls<3?'generating':'ready'}),progress:[progress('estimate',polls<3?'started':'completed',polls)]});
  });
  const wait=vi.fn(async()=>{});
  const final=await followCourse('c1',{course:view({status:'generating'}),steps:[]},{signal:new AbortController().signal,onUpdate:()=>{},wait});
  expect(final.course.status).toBe('ready');expect(polls).toBe(3);expect(wait).toHaveBeenCalledTimes(2);
  expect(final.steps[0]).toMatchObject({id:'estimate',status:'complete'});
  expect(calls.filter(([u])=>u.endsWith('/events'))).toHaveLength(1);
 });
 it('drops unsafe progress payloads',()=>{
  expect(stepsFrom([{...progress('outline','started',1),label:'SECRET'},{step:'unknown'}])).toHaveLength(1);
  expect(JSON.stringify(stepsFrom([{...progress('outline','started',1),detail:'SECRET'}]))).not.toMatch(/SECRET/);
 });
});

describe('library',()=>{
 it('renders generating, ready and failed cards with truthful text and targets',async()=>{
  backend(url=>url.endsWith('/api/rag/courses')?json([summary(),summary({id:'c2',document_id:'d2',title:'Manual',status:'generating',next_lesson_id:null,module_count:0,lesson_count:0,completed_lessons:0}),summary({id:'c3',document_id:'d3',title:'Notes',status:'failed',failure_code:'unreadable',next_lesson_id:null})]):undefined);
  render(withStores(<CoursesLibrary/>));
  const list=await screen.findByRole('list',{name:'Your courses'});
  const cards=within(list).getAllByRole('listitem');
  expect(cards).toHaveLength(3);
  const ready=within(cards[0]!);
  expect(ready.getByRole('link',{name:'Guide: Continue'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l2');
  expect(ready.getByText('Ready')).toBeVisible();expect(ready.getByText('≈ 45 min')).toBeVisible();
  expect(ready.getByText('2 modules')).toBeVisible();expect(ready.getByText('4 lessons')).toBeVisible();
  expect(ready.getByText('1 of 4 lessons complete · 25%')).toBeVisible();
  expect(within(cards[1]!).getByText('Generating')).toBeVisible();
  expect(within(cards[1]!).getByRole('link',{name:'Manual: View progress'})).toHaveAttribute('href','/workspace/courses/c2');
  expect(within(cards[2]!).getByText('Failed')).toBeVisible();
  expect(within(cards[2]!).getByText('The document has too little readable text to plan.')).toBeVisible();
  // One link per card: a single tab stop besides delete.
  for(const card of cards) expect(within(card).getAllByRole('link')).toHaveLength(1);
 });
 it('a finished course opens its plan',()=>{
  render(<CourseCard course={summary({completed_lessons:4,next_lesson_id:null})} onDelete={async()=>{}}/>);
  expect(screen.getByRole('link',{name:'Guide: Open plan'})).toHaveAttribute('href','/workspace/courses/c1');
 });
 it('shows an error with retry, and deletion keeps the document',async()=>{
  let fail=true;
  const calls=backend((url,init)=>{
   if(url.endsWith('/api/rag/courses'))return fail?json({detail:'Cannot load courses.'},503):json([summary()]);
   if(init?.method==='DELETE')return json({status:'deleted',id:'c1'});
  });
  render(withStores(<CoursesLibrary/>));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load courses.');
  fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await screen.findByRole('list',{name:'Your courses'});
  fireEvent.click(screen.getByRole('button',{name:'Delete Guide'}));
  expect(screen.getByText(/source document is kept/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Delete'}));
  await screen.findByRole('heading',{name:'No courses yet'});
  expect(calls.some(([u,i])=>u==='/api/rag/courses/c1'&&i?.method==='DELETE')).toBe(true);
  expect(calls.some(([u,i])=>u.includes('/documents/')&&i?.method==='DELETE')).toBe(false);
 });
 it('a document tombstone from Ask removes its course on reconciliation',async()=>{
  let tombstones:unknown[]=[];
  backend(url=>url.endsWith('/api/rag/courses')?json([summary()]):url.endsWith('/deletions')?json(tombstones):undefined);
  render(withStores(<CoursesLibrary/>));
  await screen.findByRole('list',{name:'Your courses'});
  tombstones=[{kind:'document',id:'d1',pending:false}];
  await act(async()=>{window.dispatchEvent(new Event('focus'))});
  await screen.findByRole('heading',{name:'No courses yet'});
 });
});

describe('create course flow',()=>{
 it('upload errors surface the backend message and success navigates to the course',async()=>{
  let uploadOk=false;
  const calls=backend((url,init)=>{
   if(url.startsWith('/api/rag/documents/upload'))return uploadOk?json({id:'d9',title:'New doc',edition:'',chunks:3},201):json({detail:'PDF has no extractable text. Run OCR first.'},422);
   if(url.endsWith('/api/rag/courses')&&init?.method==='POST')return json(summary({id:'c9',document_id:'d9',title:'New doc',status:'generating'}),202);
  });
  render(withStores(<CoursesLibrary/>));
  fireEvent.click(await screen.findByRole('button',{name:'Add a document'}));
  const file=new File(['# Title\nbody'],'notes.md',{type:'text/markdown'});
  fireEvent.change(screen.getByLabelText('Upload a document for a new course'),{target:{files:[file]}});
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF has no extractable text. Run OCR first.');
  uploadOk=true;
  fireEvent.change(screen.getByLabelText('Upload a document for a new course'),{target:{files:[file]}});
  await waitFor(()=>expect(nav.push).toHaveBeenCalledWith('/workspace/courses/c9'));
  const post=calls.find(([u,i])=>u==='/api/rag/courses'&&i?.method==='POST')!;
  expect(JSON.parse(post[1]!.body as string)).toEqual({document_id:'d9'});
  // Master uploads never start an Ask chat.
  expect(nav.push).not.toHaveBeenCalledWith('/workspace/chats/new');
  expect(calls.some(([u])=>u==='/api/rag/query')).toBe(false);
 });
 it('creates from an existing source without a course',async()=>{
  backend((url,init)=>{
   if(url==='/api/rag/documents')return json([{id:'d1',title:'Has course',edition:''},{id:'d2',title:'Fresh source',edition:'v1'}]);
   if(url.endsWith('/api/rag/courses')&&init?.method==='POST')return json(summary({id:'c2',document_id:'d2',status:'generating'}),202);
   if(url.endsWith('/api/rag/courses'))return json([summary()]);
  });
  render(withStores(<CoursesLibrary/>));
  fireEvent.click(await screen.findByRole('button',{name:'New course'}));
  fireEvent.mouseDown(screen.getByRole('tab',{name:'From your sources'}));
  fireEvent.click(screen.getByRole('tab',{name:'From your sources'}));
  const radio=await screen.findByRole('radio',{name:/Fresh source/});
  expect(screen.queryByRole('radio',{name:/Has course/})).not.toBeInTheDocument();
  fireEvent.click(radio);
  fireEvent.click(screen.getByRole('button',{name:'Create course'}));
  await waitFor(()=>expect(nav.push).toHaveBeenCalledWith('/workspace/courses/c2'));
 });
});

describe('course page',()=>{
 it('resumes generation progress after a refresh and swaps to the plan when ready',async()=>{
  backend(url=>{
   if(url.endsWith('/courses/c1/events'))return sse([['progress',progress('structure','started',4)],['status',{status:'ready'}]]);
   if(url.endsWith('/courses/c1'))return json(polled++?{...view(),progress:[]}:{...view({status:'generating'}),progress:[progress('outline','completed',2)]});
   if(url.endsWith('/api/rag/courses'))return json([summary({status:'generating'})]);
  });
  let polled=0;
  render(withStores(<CourseDetail courseId="c1"/>));
  expect(await screen.findByRole('button',{name:/^1\. Basics/})).toHaveAttribute('aria-expanded','true');
  expect(screen.getByRole('link',{name:'Continue'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l2');
  expect(screen.getByText('Colors')).toBeVisible();
  expect(screen.queryByRole('link',{name:'Colors'})).not.toBeInTheDocument();
 });
 it('shows the generation rows while planning',async()=>{
  backend(url=>{
   if(url.endsWith('/courses/c1/events'))return new Promise<Response>(()=>{});
   if(url.endsWith('/courses/c1'))return json({...view({status:'generating'}),progress:[progress('outline','completed',2,{count:3}),progress('topics','started',3,{count:2})]});
  });
  render(withStores(<CourseDetail courseId="c1"/>));
  expect(await screen.findByRole('heading',{name:'Preparing your lesson plan'})).toBeVisible();
  expect(screen.getByText('Document read')).toBeVisible();
  expect(screen.getAllByText('Finding topics — running').length).toBeGreaterThan(0);
 });
 it('a failed course shows the reason and retries with a fresh plan',async()=>{
  let restarted=false;
  const calls=backend((url,init)=>{
   if(url.endsWith('/api/rag/courses')&&init?.method==='POST'){restarted=true;return json(summary({status:'generating'}),202)}
   if(url.endsWith('/courses/c1/events'))return new Promise<Response>(()=>{});
   if(url.endsWith('/courses/c1'))return json({...view({status:restarted?'generating':'failed',failure_code:'timeout'}),progress:[]});
  });
  render(withStores(<CourseDetail courseId="c1"/>));
  expect(await screen.findByText(/Planning took too long\./)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  expect(await screen.findByRole('heading',{name:'Preparing your lesson plan'})).toBeVisible();
  expect(JSON.parse(calls.find(([,i])=>i?.method==='POST')![1]!.body as string)).toEqual({document_id:'d1'});
 });
});
