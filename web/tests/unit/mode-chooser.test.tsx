import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {LAST_MODE_KEY} from '@/core/workspace/mode';
const mocks=vi.hoisted(()=>({push:vi.fn()}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace',useRouter:()=>({push:mocks.push})}));
vi.mock('@/components/chat/workspace-sidebar-trigger',()=>({WorkspaceSidebarTrigger:()=>null}));
import {ModeChooser} from '@/components/workspace/mode-chooser';

it('offers both modes with the approved copy and destinations, without redirecting',()=>{
 render(<ModeChooser/>);
 const ask=screen.getByRole('link',{name:/^Ask: Get answers\. Understand anything\. Mode 01$/});
 const master=screen.getByRole('link',{name:/^Master: Learn deeply\. Build mastery\. Mode 02$/});
 expect(ask).toHaveAttribute('href','/workspace/chats/new');
 expect(master).toHaveAttribute('href','/workspace/courses');
 expect(screen.getByText('Mode 01')).toBeVisible();
 expect(screen.getByText('Mode 02')).toBeVisible();
 expect(mocks.push).not.toHaveBeenCalled();
 expect(document.title).toContain('Choose a mode');
});

it('highlights the last used mode and records the new choice',async()=>{
 localStorage.setItem(LAST_MODE_KEY,'master');
 render(<ModeChooser/>);
 await waitFor(()=>expect(screen.getByText('Last used')).toBeVisible());
 expect(screen.getByText('Last used').closest('a')).toHaveAttribute('data-mode','master');
 fireEvent.click(screen.getByRole('link',{name:/^Ask:/}));
 expect(localStorage.getItem(LAST_MODE_KEY)).toBe('ask');
});
