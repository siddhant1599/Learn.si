import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace/courses',useRouter:()=>({push:vi.fn()}),useParams:()=>({course_id:'c 1',lesson_id:'l1'})}));
vi.mock('@/components/chat/workspace-sidebar-trigger',()=>({WorkspaceSidebarTrigger:()=>null}));
import CoursesPage from '@/app/workspace/(shell)/courses/page';
import CoursePage from '@/app/workspace/(shell)/courses/[course_id]/page';
import LessonPage from '@/app/workspace/(shell)/courses/[course_id]/lessons/[lesson_id]/page';
import ProgressPage from '@/app/workspace/(shell)/progress/page';
import CoursesLoading from '@/app/workspace/(shell)/courses/loading';

it('courses page renders an accessible empty state and sets the title',()=>{
 render(<CoursesPage/>);
 expect(screen.getByRole('heading',{level:1,name:'Courses'})).toBeVisible();
 expect(screen.getByRole('heading',{level:2,name:'No courses yet'})).toBeVisible();
 expect(document.title).toBe('Courses - Study Buddy');
});

it('course and lesson pages link back up the hierarchy',()=>{
 const course=render(<CoursePage/>);
 expect(screen.getByRole('link',{name:'Back to courses'})).toHaveAttribute('href','/workspace/courses');
 course.unmount();
 render(<LessonPage/>);
 expect(screen.getByRole('link',{name:'Back to the course'})).toHaveAttribute('href','/workspace/courses/c%201');
});

it('progress page explains what will be tracked',()=>{
 render(<ProgressPage/>);
 expect(screen.getByText(/quiz performance, topic mastery and study time/)).toBeVisible();
 expect(screen.getByRole('link',{name:'Go to courses'})).toHaveAttribute('href','/workspace/courses');
});

it('loading skeleton marks the region busy',()=>{
 render(<CoursesLoading/>);
 expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
});
