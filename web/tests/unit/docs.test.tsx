import {expect,it,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {site} from '@/config/site';
import {docs,docHref,findDoc,searchDocs} from '@/content/docs';
import {DocsSearch,DocsNavigation} from '@/components/docs/navigation';
vi.mock('next/navigation',()=>({usePathname:()=>'/docs/api'}));
vi.mock('next/link',()=>({default:({children,...props}:any)=><a {...props}>{children}</a>}));
it('every published route has useful content and unique stable anchors',()=>{
 expect(new Set(docs.map(d=>d.slug)).size).toBe(docs.length);
 expect(findDoc('')!.title).toBe('Study Buddy Docs');
 expect(JSON.stringify(docs)).not.toContain('Document Lab');
 for(const page of docs){
  expect(findDoc(page.slug)).toBe(page);
  expect(page.sections.length).toBeGreaterThan(1);
  expect(new Set(page.sections.map(s=>s.id)).size).toBe(page.sections.length);
  for(const s of page.sections){
   expect(s.id).toMatch(/^[a-z][a-z0-9-]+$/);
   expect(s.paragraphs.join('').length).toBeGreaterThan(100);
   for(const link of s.links??[]){
    if(!link.href.startsWith('/docs'))continue;
    const [path,anchor]=link.href.split('#');
    const target=docs.find(d=>docHref(d.slug)===path);
    expect(target).toBeDefined();
    if(anchor)expect(target!.sections.some(s=>s.id===anchor)).toBe(true);
   }
  }
 }
 expect(findDoc('missing')).toBeUndefined();
});
it('search finds section text and code, with only valid docs destinations',()=>{
 expect(searchDocs('TAVILY_KEY').length).toBeGreaterThan(0);
 expect(searchDocs('')).toEqual([]);
 expect(searchDocs('unfindable-zebra')).toEqual([]);
 for(const result of searchDocs('evidence')){
  const [path,anchor]=result.href.split('#');
  expect(docs.some(d=>docHref(d.slug)===path&&d.sections.some(s=>s.id===anchor))).toBe(true);
 }
});
it('search opens, reports empty results and ignores markup as executable input',()=>{
 render(<DocsSearch/>);fireEvent.click(screen.getByRole('button',{name:'Search docs'}));
 const input=screen.getByRole('searchbox',{name:'Search documentation'});
 fireEvent.change(input,{target:{value:'unfindable-zebra'}});
 expect(screen.getByRole('status')).toHaveTextContent('0 results');
 fireEvent.change(input,{target:{value:'TAVILY_KEY'}});
 expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
 fireEvent.keyDown(input,{key:'ArrowDown'});
 expect(screen.getAllByRole('link')[0]).toHaveFocus();
 fireEvent.click(screen.getAllByRole('link')[0]!);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('navigation identifies the current page',()=>{
 render(<DocsNavigation/>);
 const current=screen.getAllByRole('link',{name:'API and SSE reference',hidden:true});
 for(const link of current)expect(link).toHaveAttribute('aria-current','page');
});

it('shared landing navigation points to published docs and retains workspace',()=>{
 expect(site.header.links).toContainEqual({href:'/docs',label:'Docs'});
 expect(site.header.links).toContainEqual({href:'/workspace',label:'Workspace'});
 expect(site.header.links.some(link=>link.label==='Examples')).toBe(false);
});
it('docs are grouped by mode and Master mode is searchable with valid destinations',()=>{
 // Distinct sections per mode, in this order in the navigation.
 expect([...new Set(docs.map(d=>d.group))]).toEqual(['Start here','Ask mode','Master mode','Developers']);
 for(const slug of ['getting-started','evidence','deletion']) expect(findDoc(slug)?.group).toBe('Ask mode');
 for(const slug of ['master-mode','lessons','quizzes','progress','master-data'])
  expect(findDoc(slug)?.group).toBe('Master mode');
 expect(findDoc('choose-a-mode')?.group).toBe('Start here');
 // Ask pages no longer carry Master-only sections; the shared privacy summary is on the home page.
 expect(findDoc('evidence')!.sections.map(s=>s.id)).not.toContain('master-storage');
 expect(findDoc('deletion')!.sections.map(s=>s.id)).not.toContain('courses');
 expect(findDoc('master-data')!.sections.map(s=>s.id)).toEqual(['master-storage','courses']);
 expect(findDoc('')!.sections.map(s=>s.id)).toContain('at-a-glance');
 for(const query of ['mastery','quiz','Your turn','study time','lesson_id']){
  const results=searchDocs(query);
  expect(results.length,query).toBeGreaterThan(0);
  for(const result of results){
   const [path,anchor]=result.href.split('#');
   expect(docs.some(d=>docHref(d.slug)===path&&d.sections.some(s=>s.id===anchor))).toBe(true);
  }
 }
 expect(searchDocs('mastery').some(r=>r.href==='/docs/progress#mastery')).toBe(true);
 // Estimates are never described as limits.
 expect(findDoc('progress')!.sections.map(s=>s.paragraphs.join(' ')).join(' ')).toMatch(/never a countdown or a limit/);
});
