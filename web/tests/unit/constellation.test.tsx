import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {site} from '@/config/site';
const state=vi.hoisted(()=>({reduced:false}));
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>false,usePrefersReducedMotion:()=>state.reduced}));
import {ConstellationSection} from '@/components/landing/constellation-section';
beforeEach(()=>{state.reduced=false});
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

it('renders the section heading, nine sentences, nine stars, three modules and the legend',()=>{
 render(<ConstellationSection/>);
 expect(screen.getByRole('heading',{level:2,name:site.constellation.title})).toBeInTheDocument();
 expect(screen.getByText(site.constellation.eyebrow)).toBeInTheDocument();
 expect(site.constellation.stars).toHaveLength(9);
 const sentences=[...document.querySelectorAll('[data-constellation-sentence]')].map(n=>n.textContent?.trim());
 for(const star of site.constellation.stars){
  expect(sentences).toContain(star.sentence);
  expect(screen.getByText(star.label)).toBeInTheDocument();
 }
 expect(escape(site.constellation.stars[0]!.sentence)).toContain('Dockerfile');
 for(const title of site.constellation.modules)expect(screen.getByText(title)).toHaveClass('uppercase');
 expect(document.querySelectorAll('[data-constellation-star]')).toHaveLength(9);
 expect(screen.getByText(site.constellation.nextLesson)).toBeInTheDocument();
 for(const text of Object.values(site.constellation.states))expect(screen.getByText(text)).toBeInTheDocument();
 expect(screen.getByText(site.constellation.caption)).toHaveClass('sr-only');
 expect(document.querySelector('[data-constellation]')).toHaveAttribute('aria-hidden','true');
});

it('starts at progress 0 with a tall stage and the scroll cue',()=>{
 render(<ConstellationSection/>);
 const stage=document.querySelector('[data-constellation-stage]') as HTMLElement;
 expect(stage.style.getPropertyValue('--stage-progress')).toBe('0');
 expect(stage.className).toContain('h-[220svh]');
 expect(screen.getByText('Scroll')).toBeInTheDocument();
 expect((document.querySelector('[data-constellation-legend]') as HTMLElement).style.opacity).toBe('0');
});

it('reduced motion shows the finished map: page gone, labels, legend and next-lesson chip visible',()=>{
 state.reduced=true;
 render(<ConstellationSection/>);
 const stage=document.querySelector('[data-constellation-stage]') as HTMLElement;
 expect(stage.style.getPropertyValue('--stage-progress')).toBe('1');
 expect(stage.className).toContain('h-svh');
 expect(screen.queryByText('Scroll')).not.toBeInTheDocument();
 expect((document.querySelector('[data-constellation-page]') as HTMLElement).style.opacity).toBe('0');
 expect((document.querySelector('[data-constellation-label]') as SVGTextElement).style.opacity).toBe('1');
 expect((document.querySelector('[data-constellation-legend]') as HTMLElement).style.opacity).toBe('1');
 expect((document.querySelector('[data-constellation-chip]') as SVGTextElement).style.opacity).toBe('1');
});
