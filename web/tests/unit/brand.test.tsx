import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {site} from '@/config/site';
import {Header} from '@/components/landing/header';
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));

it('brand is Study Buddy with a single workspace entry point',()=>{
 expect(site.name).toBe('Study Buddy');
 expect(site.shortName).toBe('SB');
 expect(site.hero.ctaHref).toBe('/workspace');
 expect(site.repositoryUrl).toBe('https://github.com/code-bot-sid/Document-Lab');
 expect(site.header.links.map(l=>l.label).sort()).toEqual(['Docs','Workspace']);
 expect(JSON.stringify(site)).not.toContain('Document Lab');
});

it('landing copy names both modes without numbering and links to neither directly',()=>{
 const labels=site.whatsNew.features.map(f=>f.label).join(' ');
 expect(labels).toMatch(/Ask mode/);
 expect(labels).toMatch(/Master mode/);
 expect(JSON.stringify(site)).not.toMatch(/Mode 0\d/);
 for(const link of site.header.links)expect(link.label).not.toMatch(/^(Ask|Master)$/);
});

it('landing header shows the brand and the frontend-sample GitHub button, with no mode links',()=>{
 render(<Header/>);
 expect(screen.getAllByText('Study Buddy').length).toBeGreaterThan(0);
 const star=screen.getByRole('link',{name:'Star on GitHub'});
 expect(star).toHaveAttribute('href',site.repositoryUrl);
 expect(star).toHaveAttribute('target','_blank');
 expect(star).toHaveAttribute('rel','noopener noreferrer');
 expect(screen.queryByRole('link',{name:'Open workspace'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:/^(Ask|Master)$/})).not.toBeInTheDocument();
});

it('hero shows a "Beta version" label under the SuperAgent line, with no link',async()=>{
 const {Hero}=await import('@/components/landing/hero');
 render(<Hero/>);
 const badge=document.querySelector('[data-beta-badge]') as HTMLElement;
 expect(badge).toHaveTextContent(/^Beta version$/);
 expect(badge.tagName).toBe('DIV');
 expect(badge.closest('a')).toBeNull();
 expect(badge.querySelector('a,button')).toBeNull();
 expect(screen.queryByRole('link',{name:/Beta version/})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Beta version/})).not.toBeInTheDocument();
 const suffix=screen.getByText(site.hero.rotatingSuffix);
 expect(suffix.compareDocumentPosition(badge)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
