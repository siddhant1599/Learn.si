import {beforeEach,describe,it,expect,vi} from 'vitest';
import {act,render,renderHook,screen,fireEvent,within} from '@testing-library/react';
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace/courses/c1',useRouter:()=>({push:vi.fn(),replace:vi.fn()})}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn(),message:vi.fn()}}));
import {ChatStoreProvider} from '@/core/chat/store';
import {StudyStoreProvider,useStudyStore} from '@/core/study/store';
import {CoursePlan} from '@/components/study/course-plan';
import {HEARTBEAT_MS,useStudyTime} from '@/core/study/use-study-time';
import type {CourseView,LessonStatus} from '@/core/study/types';

const lessonRow=(id:string,position:number,module:string,status:LessonStatus)=>({id,module_id:module,position,title:`Lesson ${position}`,objective:`Objective ${position}`,estimated_minutes:6,content_status:'ready' as const,status});
const course=(third:LessonStatus='locked'):CourseView=>({id:'c1',document_id:'d1',title:'Guide',status:'ready',estimated_minutes:18,module_count:2,lesson_count:3,completed_lessons:1,next_lesson_id:'l2',
 modules:[
  {id:'m1',position:1,title:'Basics',summary:'Start here',estimated_minutes:6,lessons:[lessonRow('l1',1,'m1','completed')]},
  {id:'m2',position:2,title:'Practice',summary:'',estimated_minutes:12,lessons:[lessonRow('l2',2,'m2','in_progress'),lessonRow('l3',3,'m2',third)]}]});
const progress={course_id:'c1',title:'Guide',percent:33,completed_lessons:1,lesson_count:3,estimated_minutes_remaining:12,study_seconds:300,next_lesson_id:'l2',last_activity:null,
 mastery_distribution:{not_started:1,learning:1,developing:0,proficient:0,mastered:1},quiz:{},
 modules:[{id:'m1',title:'Basics',position:1,completed_lessons:1,lesson_count:1,percent:100,mastery:'mastered',quiz:{}},{id:'m2',title:'Practice',position:2,completed_lessons:0,lesson_count:2,percent:0,mastery:'learning',quiz:{}}],
 lessons:[{id:'l1',quiz_attempts:1,passed:true,best_score:3,mastery:'mastered'},{id:'l2',quiz_attempts:2,passed:false,best_score:1,mastery:'learning'},{id:'l3',quiz_attempts:0,passed:false,best_score:null,mastery:'not_started'}]};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/courses/c1/progress')?json(progress):url==='/api/rag/documents'?json([{id:'d1',title:'Guide.pdf',edition:'2026'}]):json([])))});

function Unlock({id}:{id:string}){const {markUnlocked}=useStudyStore();return <button onClick={()=>markUnlocked(id)}>unlock</button>}
const mount=(view:CourseView)=>render(<ChatStoreProvider><StudyStoreProvider><Unlock id="l3"/><CoursePlan course={view}/></StudyStoreProvider></ChatStoreProvider>);

describe('course plan',()=>{
 it('offers Continue when the first lesson is already in progress',async()=>{
  const view=course();
  view.completed_lessons=0;
  view.next_lesson_id='l1';
  view.modules[0]!.lessons[0]!.status='in_progress';
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/progress')?json({...progress,completed_lessons:0,next_lesson_id:'l1'}):json([])));
  mount(view);
  expect(await screen.findByRole('link',{name:'Continue'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l1');
  expect(screen.queryByRole('link',{name:'Start the first lesson'})).not.toBeInTheDocument();
 });

 it('renders the header, counts, estimates and the module holding the next lesson open',async()=>{
  mount(course());
  expect(await screen.findByText('Source: Guide.pdf · 2026')).toBeVisible();
  expect(screen.getByLabelText('Course progress',{selector:'[role="progressbar"]'})).toHaveAttribute('aria-valuetext','33% complete');
  expect(screen.getByText(/1 of 3 lessons completed/)).toBeVisible();
  expect(screen.getByText(/≈ 18 min of lessons/)).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Continue'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l2');
  expect(screen.getByRole('button',{name:/^1\. Basics/})).toHaveAttribute('aria-expanded','false');
  expect(screen.getByRole('button',{name:/^2\. Practice/})).toHaveAttribute('aria-expanded','true');
  expect(await screen.findByText('Mastered')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'2. Practice, 0 of 2 lessons completed, mastery: Learning'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Delete Guide'})).toBeVisible();
 });
 it('locked lessons are not links; others link with status and quiz chips',async()=>{
  mount(course());
  const practice=await screen.findByRole('list',{name:'Lessons in Practice'});
  const locked=practice.querySelector('[data-lesson="l3"] > *')!;
  expect(locked.tagName).toBe('DIV');expect(locked).toHaveAttribute('aria-disabled','true');
  expect(locked).toHaveAttribute('title','Pass the previous quiz to unlock');
  expect(within(practice).queryByRole('link',{name:/Lesson 3/})).not.toBeInTheDocument();
  const current=within(practice).getByRole('link',{name:/Lesson 2/});
  expect(current).toHaveAttribute('href','/workspace/courses/c1/lessons/l2');
  expect(await within(practice).findByText('Retake needed')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:/^1\. Basics/}));
  expect(await screen.findByText('Passed 3/3')).toBeVisible();
  expect(screen.getByRole('link',{name:/Lesson 1/})).toHaveTextContent('Completed');
 });
 it('an unlock from a quiz re-renders the lesson as available and highlights it',async()=>{
  const view=mount(course());
  await screen.findByRole('list',{name:'Lessons in Practice'});
  fireEvent.click(screen.getByRole('button',{name:'unlock'}));
  view.rerender(<ChatStoreProvider><StudyStoreProvider><Unlock id="l3"/><CoursePlan course={course('available')}/></StudyStoreProvider></ChatStoreProvider>);
  fireEvent.click(screen.getByRole('button',{name:'unlock'}));
  const row=await screen.findByRole('link',{name:/Lesson 3/});
  expect(row).toHaveAttribute('href','/workspace/courses/c1/lessons/l3');
  expect(row).toHaveTextContent('Available');
  expect(row.closest('li')).toHaveAttribute('data-unlocked','true');
 });
});

describe('study-time heartbeat',()=>{
 it('posts bounded beats only while visible and focused, and stops when hidden',async()=>{
  vi.useFakeTimers();
  const calls:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push([url,JSON.parse(init.body as string)]);return json({study_seconds:0})}));
  let visible='visible';
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visible});
  const focus=vi.spyOn(document,'hasFocus').mockReturnValue(true);
  const hook=renderHook(()=>useStudyTime('l2',true));
  await act(async()=>{vi.advanceTimersByTime(HEARTBEAT_MS)});
  expect(calls).toEqual([['/api/rag/lessons/l2/study-time',{seconds:30}]]);
  // Hidden: one flush of the partial interval, then nothing while hidden.
  await act(async()=>{vi.advanceTimersByTime(10_000);visible='hidden';document.dispatchEvent(new Event('visibilitychange'))});
  expect(calls.at(-1)[1]).toEqual({seconds:10});
  const count=calls.length;
  await act(async()=>{vi.advanceTimersByTime(HEARTBEAT_MS*4)});
  expect(calls.length).toBe(count);
  // Back and focused: credits resume; every beat is at most 60 s.
  await act(async()=>{visible='visible';document.dispatchEvent(new Event('visibilitychange'));vi.advanceTimersByTime(HEARTBEAT_MS)});
  expect(calls.every(([,b])=>b.seconds>=1&&b.seconds<=60)).toBe(true);
  expect(calls.length).toBe(count+1);
  focus.mockReturnValue(false);
  await act(async()=>{window.dispatchEvent(new Event('blur'));vi.advanceTimersByTime(HEARTBEAT_MS*3)});
  const afterBlur=calls.length;
  hook.unmount();
  expect(calls.length).toBe(afterBlur);
  delete (document as any).visibilityState;
 });
 it('sends nothing when disabled',async()=>{
  vi.useFakeTimers();
  const spy=vi.fn();vi.stubGlobal('fetch',spy);
  renderHook(()=>useStudyTime('l2',false));
  await act(async()=>{vi.advanceTimersByTime(HEARTBEAT_MS*3)});
  expect(spy).not.toHaveBeenCalled();
 });
});
