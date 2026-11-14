import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {LAST_MODE_KEY} from '@/core/workspace/mode';
const mocks=vi.hoisted(()=>({push:vi.fn()}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/workspace',useRouter:()=>({push:mocks.push})}));
import {ModeChooser} from '@/components/workspace/mode-chooser';

it('offers both modes with the approved copy and destinations, without numbering or redirecting',()=>{
 render(<ModeChooser/>);
 const ask=screen.getByRole('link',{name:'Ask: Get answers. Understand anything.'});
 const master=screen.getByRole('link',{name:'Master: Learn deeply. Build mastery.'});
 expect(ask).toHaveAttribute('href','/workspace/chats/new');
 expect(master).toHaveAttribute('href','/workspace/courses');
 expect(screen.queryByText(/Mode 0\d/)).not.toBeInTheDocument();
 expect(mocks.push).not.toHaveBeenCalled();
 expect(document.title).toContain('Choose a mode');
});

it('is a standalone page: brand and Docs links, no sidebar controls',()=>{
 render(<ModeChooser/>);
 expect(screen.getByRole('link',{name:'Study Buddy'})).toHaveAttribute('href','/');
 expect(screen.getByRole('link',{name:'Docs'})).toHaveAttribute('href','/docs');
 expect(screen.queryByRole('button',{name:/Toggle Sidebar/})).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{level:1})).toHaveTextContent('How do you want to learn today?');
});

it('highlights the last used mode and records the new choice',async()=>{
 localStorage.setItem(LAST_MODE_KEY,'master');
 render(<ModeChooser/>);
 await waitFor(()=>expect(screen.getByText('Last used')).toBeVisible());
 expect(screen.getByText('Last used').closest('a')).toHaveAttribute('data-mode','master');
 fireEvent.click(screen.getByRole('link',{name:/^Ask:/}));
 expect(localStorage.getItem(LAST_MODE_KEY)).toBe('ask');
});
