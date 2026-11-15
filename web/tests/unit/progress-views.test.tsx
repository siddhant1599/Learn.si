import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
const nav=vi.hoisted(()=>({search:new URLSearchParams(),replace:vi.fn()}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace/progress',useRouter:()=>({push:vi.fn(),replace:nav.replace}),useSearchParams:()=>nav.search,useParams:()=>({course_id:'c1'})}));
vi.mock('@/components/chat/workspace-sidebar-trigger',()=>({WorkspaceSidebarTrigger:()=>null}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn(),message:vi.fn()}}));
import {ChatStoreProvider} from '@/core/chat/store';
import {StudyStoreProvider} from '@/core/study/store';
import {ProgressOverview} from '@/components/study/progress-overview';
import {CourseDetail} from '@/components/study/course-detail';
import {MasteryBar,masterySummary} from '@/components/study/progress-charts';
import {formatDuration,formatRate} from '@/core/study/format';

const dist={not_started:2,learning:1,developing:0,proficient:1,mastered:2};
const overview={totals:{courses:2,lessons_completed:5,lessons_total:12,study_seconds:4320,quiz_attempts:7,quizzes_passed:5},
 courses:[{course_id:'c1',title:'Guide',percent:50,completed_lessons:3,lesson_count:6,study_seconds:3600,mastery_distribution:dist,last_activity:'2026-11-15T10:00:00Z',next_lesson_id:'l4'},
  {course_id:'c2',title:'Manual',percent:33,completed_lessons:2,lesson_count:6,study_seconds:720,mastery_distribution:{not_started:4,learning:0,developing:2,proficient:0,mastered:0},last_activity:null,next_lesson_id:null}],
 recent:[{kind:'quiz',course_id:'c1',lesson_id:'l3',title:'Colors',score:2,passed:true,at:'2026-11-15T10:00:00Z'},{kind:'quiz',course_id:'c1',lesson_id:'l3',title:'Colors',score:1,passed:false,at:'2026-11-15T09:00:00Z'},{kind:'lesson_completed',course_id:'c1',lesson_id:'l2',title:'Labels',at:'2026-11-15T08:00:00Z'}]};
const quiz={attempts:4,passed:3,pass_rate:0.75,first_try_pass_rate:0.667,average_score:2.25,bloom:{recall:{questions:6,correct:5},apply:{questions:4,correct:2},analyze:{questions:2,correct:0}}};
const course={id:'c1',document_id:'d1',title:'Guide',status:'ready',estimated_minutes:18,module_count:2,lesson_count:3,completed_lessons:1,next_lesson_id:'l2',progress:[],
 modules:[{id:'m1',position:1,title:'Basics',summary:'',estimated_minutes:6,lessons:[{id:'l1',module_id:'m1',position:1,title:'Labels',objective:'',estimated_minutes:6,content_status:'ready',status:'completed'}]},
  {id:'m2',position:2,title:'Practice',summary:'',estimated_minutes:12,lessons:[{id:'l2',module_id:'m2',position:2,title:'Colors',objective:'',estimated_minutes:6,content_status:'ready',status:'in_progress'},{id:'l3',module_id:'m2',position:3,title:'Spacing',objective:'',estimated_minutes:6,content_status:'pending',status:'locked'}]}]};
const courseProgress={course_id:'c1',title:'Guide',percent:33,completed_lessons:1,lesson_count:3,estimated_minutes_remaining:12,study_seconds:4320,next_lesson_id:'l2',last_activity:null,
 mastery_distribution:{not_started:1,learning:1,developing:0,proficient:0,mastered:1},quiz,
 modules:[{id:'m1',title:'Basics',position:1,completed_lessons:1,lesson_count:1,percent:100,mastery:'mastered',quiz},{id:'m2',title:'Practice',position:2,completed_lessons:0,lesson_count:2,percent:0,mastery:'learning',quiz:{...quiz,pass_rate:0.5}}],
 lessons:[{id:'l1',module_id:'m1',position:1,title:'Labels',status:'completed',estimated_minutes:6,completed_at:null,study_seconds:3600,quiz_attempts:1,first_try_pass:true,best_score:3,last_score:3,passed:true,mastery:'mastered'},
  {id:'l2',module_id:'m2',position:2,title:'Colors',status:'in_progress',estimated_minutes:6,completed_at:null,study_seconds:720,quiz_attempts:2,first_try_pass:false,best_score:1,last_score:1,passed:false,mastery:'learning'},
  {id:'l3',module_id:'m2',position:3,title:'Spacing',status:'locked',estimated_minutes:6,completed_at:null,study_seconds:0,quiz_attempts:0,first_try_pass:null,best_score:null,last_score:null,passed:false,mastery:'not_started'}]};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const withStores=(ui:React.ReactNode)=><ChatStoreProvider><StudyStoreProvider>{ui}</StudyStoreProvider></ChatStoreProvider>;
beforeEach(()=>{nav.search=new URLSearchParams();nav.replace.mockReset();
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/rag/progress'?json(overview):url.endsWith('/courses/c1/progress')?json(courseProgress):url.endsWith('/courses/c1')?json(course):json([])))});

describe('formatting',()=>{
 it('formats study time and rates without suggesting limits',()=>{
  expect(formatDuration(4320)).toBe('1 h 12 min');expect(formatDuration(0)).toBe('0 min');
  expect(formatDuration(30)).toBe('< 1 min');expect(formatDuration(3600)).toBe('1 h');expect(formatDuration(720)).toBe('12 min');
  expect(formatRate(0.667)).toBe('67%');expect(formatRate(null)).toBe('—');
 });
 it('mastery chart has a text summary and a legend with counts for every level',()=>{
  expect(masterySummary(dist)).toBe('6 lessons: 2 not started, 1 learning, 1 proficient, 2 mastered.');
  render(<MasteryBar distribution={dist}/>);
  expect(screen.getByRole('img')).toHaveAccessibleName('Mastery distribution. 6 lessons: 2 not started, 1 learning, 1 proficient, 2 mastered.');
  for(const [label,count] of [['Not started','2'],['Learning','1'],['Developing','0'],['Proficient','1'],['Mastered','2']])
   expect(document.querySelector(`[data-legend="${label.toLowerCase().replace(' ','_')}"]`)).toHaveTextContent(`${label} ${count}`);
  // Zero-count levels draw no segment; hovering a segment shows its count.
  expect(document.querySelector('[data-level="developing"]')).toBeNull();
  fireEvent.mouseEnter(document.querySelector('[data-level="mastered"]')!);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Mastered: 2 of 6');
 });
});

describe('progress overview',()=>{
 it('renders tiles, course cards with percentages and mastery, and recent activity',async()=>{
  render(withStores(<ProgressOverview/>));
  const totals=await screen.findByRole('region',{name:'Totals'});
  expect(within(totals).getByText('1 h 12 min')).toBeVisible();
  expect(within(totals).getByText('of 12').parentElement).toHaveTextContent('Lessons completed5of 12');
  expect(within(totals).getByText('of 7 attempts')).toBeVisible();
  const card=document.querySelector('[data-course="c1"]') as HTMLElement;
  expect(within(card).getByText('50%')).toBeVisible();
  expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuetext','50% complete');
  expect(within(card).getByRole('img')).toHaveAccessibleName(/2 mastered/);
  expect(within(card).getByRole('link',{name:'Continue'})).toHaveAttribute('href','/workspace/courses/c1/lessons/l4');
  expect(within(card).getByRole('link',{name:'Guide'})).toHaveAttribute('href','/workspace/courses/c1?tab=progress');
  expect(within(document.querySelector('[data-course="c2"]') as HTMLElement).queryByRole('link',{name:'Continue'})).toBeNull();
  expect(screen.getByText(/Quiz passed 2\/3 · Colors/)).toBeVisible();
  expect(screen.getByText(/Quiz not passed 1\/3 · Colors/)).toBeVisible();
  expect(screen.getByText(/Lesson completed · Labels/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/countdown|remaining time|limit/i);
 });
 it('shows an error with retry and refreshes on focus',async()=>{
  let fail=true;
  const fetchMock=vi.fn(async()=>fail?json({detail:'Cannot load progress.'},503):json(overview));
  vi.stubGlobal('fetch',fetchMock);
  render(withStores(<ProgressOverview/>));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot load progress.');
  fail=false;
  fireEvent.focus(window);
  expect(await screen.findByRole('region',{name:'Totals'})).toBeVisible();
 });
});

describe('course progress tab',()=>{
 it('the tab follows ?tab=progress and shows tables, quiz stats and the Bloom breakdown',async()=>{
  nav.search=new URLSearchParams('tab=progress');
  render(withStores(<CourseDetail courseId="c1"/>));
  expect(await screen.findByRole('tab',{name:'Progress',selected:true})).toBeVisible();
  const lessons=await screen.findByRole('table',{name:/per lesson/});
  const rows=within(lessons).getAllByRole('row').slice(1);
  expect(rows.map(r=>within(r).getAllByRole('cell')[0]!.textContent)).toEqual(['Completed','In progress','Locked']);
  expect(within(rows[0]!).getByText('1 h')).toBeVisible();expect(within(rows[1]!).getByText('Not passed')).toBeVisible();
  expect(within(rows[2]!).queryByRole('link')).toBeNull();
  const modules=screen.getByRole('table',{name:/per module/});
  expect(within(modules).getByText('Mastered')).toBeVisible();expect(within(modules).getByText('50%')).toBeVisible();
  const quizStats=screen.getByRole('region',{name:'Quiz performance'});
  expect(quizStats).toHaveTextContent('Attempts4Pass rate75%First-try pass rate67%Average score2.25/3');
  const bloom=screen.getByRole('table',{name:'Correct answers by question type'});
  expect(within(bloom).getAllByRole('row').slice(1).map(r=>r.textContent)).toEqual(['Recall56','Apply24','Analyze02']);
  expect(screen.getByText('5/6 · 83%')).toBeInTheDocument();
  fireEvent.click(screen.getByText('What do the mastery levels mean?'));
  expect(screen.getByText(/First attempt 3\/3/)).toBeVisible();
  fireEvent.mouseDown(screen.getByRole('tab',{name:'Plan'}),{button:0});
  expect(nav.replace).toHaveBeenCalledWith('/workspace/courses/c1',{scroll:false});
 });
});
