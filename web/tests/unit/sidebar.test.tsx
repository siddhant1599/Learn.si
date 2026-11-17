import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {LAST_MODE_KEY} from '@/core/workspace/mode';
const nav=vi.hoisted(()=>({pathname:'/workspace/chats/new',push:vi.fn()}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>nav.pathname,useRouter:()=>({push:nav.push})}));
vi.mock('@/core/chat/adapter',()=>({chatAdapter:{stream:vi.fn()}}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn(),message:vi.fn()}}));
import {ChatSidebar} from '@/components/chat/chat-sidebar';
import {SidebarProvider} from '@/components/ui/sidebar';
import {ChatStoreProvider} from '@/core/chat/store';
import {StudyStoreProvider} from '@/core/study/store';

const mount=()=>render(<ChatStoreProvider><StudyStoreProvider><SidebarProvider><ChatSidebar/></SidebarProvider></StudyStoreProvider></ChatStoreProvider>);
const modeGroup=()=>within(screen.getByRole('group',{name:'Workspace mode'}));
beforeEach(()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>[]}))});

it('Ask routes show Ask navigation and press the Ask switch',()=>{
 nav.pathname='/workspace/chats/new';mount();
 expect(modeGroup().getByRole('button',{name:'Ask'})).toHaveAttribute('aria-pressed','true');
 expect(modeGroup().getByRole('button',{name:'Master'})).toHaveAttribute('aria-pressed','false');
 expect(screen.getByRole('link',{name:'New chat'})).toHaveAttribute('href','/workspace/chats/new');
 expect(screen.getByRole('link',{name:'Chats'})).toHaveAttribute('href','/workspace/chats');
 expect(screen.queryByRole('link',{name:'Courses'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Learn.si'})).toHaveAttribute('href','/workspace');
});

it('Master routes show Master navigation and hide Ask-only panels',()=>{
 nav.pathname='/workspace/courses';mount();
 expect(modeGroup().getByRole('button',{name:'Master'})).toHaveAttribute('aria-pressed','true');
 expect(screen.getByRole('link',{name:'Courses'})).toHaveAttribute('href','/workspace/courses');
 expect(screen.getByRole('link',{name:'Progress'})).toHaveAttribute('href','/workspace/progress');
 expect(screen.queryByRole('link',{name:'New chat'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Chats'})).not.toBeInTheDocument();
 expect(screen.queryByText('Sources')).not.toBeInTheDocument();
 expect(fetch).not.toHaveBeenCalledWith('/api/rag/health',expect.anything());
});

it('the chooser is neutral: no mode pressed and no mode navigation',()=>{
 nav.pathname='/workspace';mount();
 expect(modeGroup().getByRole('button',{name:'Ask'})).toHaveAttribute('aria-pressed','false');
 expect(modeGroup().getByRole('button',{name:'Master'})).toHaveAttribute('aria-pressed','false');
 expect(screen.queryByRole('link',{name:'Chats'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'Courses'})).not.toBeInTheDocument();
});

it('switching mode navigates to that mode home and remembers it',()=>{
 nav.pathname='/workspace/chats/new';mount();
 fireEvent.click(modeGroup().getByRole('button',{name:'Master'}));
 expect(nav.push).toHaveBeenCalledWith('/workspace/courses');
 expect(localStorage.getItem(LAST_MODE_KEY)).toBe('master');
});

it('Ask routes probe web availability once',async()=>{
 nav.pathname='/workspace/chats/new';mount();
 await vi.waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/rag/health',expect.anything()));
 expect((fetch as any).mock.calls.filter((c:any[])=>c[0]==='/api/rag/health')).toHaveLength(1);
});
