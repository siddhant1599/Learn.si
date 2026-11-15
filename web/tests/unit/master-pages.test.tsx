import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace/courses',useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(),useParams:()=>({course_id:'c 1',lesson_id:'l1'})}));
vi.mock('@/components/chat/workspace-sidebar-trigger',()=>({WorkspaceSidebarTrigger:()=>null}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn(),message:vi.fn()}}));
import {ChatStoreProvider} from '@/core/chat/store';
import {StudyStoreProvider} from '@/core/study/store';
import CoursesPage from '@/app/workspace/(shell)/courses/page';
import CoursePage from '@/app/workspace/(shell)/courses/[course_id]/page';
import LessonPage from '@/app/workspace/(shell)/courses/[course_id]/lessons/[lesson_id]/page';
import ProgressPage from '@/app/workspace/(shell)/progress/page';
import CoursesLoading from '@/app/workspace/(shell)/courses/loading';

const respond=(url:string)=>url==='/api/rag/progress'?{ok:true,status:200,json:async()=>({totals:{courses:0,lessons_completed:0,lessons_total:0,study_seconds:0,quiz_attempts:0,quizzes_passed:0},courses:[],recent:[]})}:url.includes('/courses/')||url.includes('/lessons/')?{ok:false,status:404,json:async()=>({detail:'Course does not exist'})}:{ok:true,status:200,json:async()=>[]};
const withStores=(ui:React.ReactNode)=><ChatStoreProvider><StudyStoreProvider>{ui}</StudyStoreProvider></ChatStoreProvider>;
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn(async(url:string)=>respond(url)))});

it('courses page renders an accessible empty state and sets the title',async()=>{
 render(withStores(<CoursesPage/>));
 expect(await screen.findByRole('heading',{level:2,name:'No courses yet'})).toBeVisible();
 expect(screen.getByRole('heading',{level:1,name:'Courses'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Add a document'})).toBeVisible();
 expect(document.title).toBe('Courses - Study Buddy');
});

it('course and lesson pages link back up the hierarchy',async()=>{
 const course=render(withStores(<CoursePage/>));
 expect(await screen.findByRole('link',{name:'Back to courses'})).toHaveAttribute('href','/workspace/courses');
 course.unmount();
 render(withStores(<LessonPage/>));
 expect(await screen.findByRole('link',{name:'Back to the course'})).toHaveAttribute('href','/workspace/courses/c%201');
});

it('progress page explains what will be tracked when there are no courses',async()=>{
 render(withStores(<ProgressPage/>));
 expect(await screen.findByText(/quiz performance, topic mastery and study time/)).toBeVisible();
 expect(screen.getByRole('link',{name:'Go to courses'})).toHaveAttribute('href','/workspace/courses');
});

it('loading skeleton marks the region busy',()=>{
 render(<CoursesLoading/>);
 expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
});
