import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {site} from '@/config/site';
const state=vi.hoisted(()=>({reduced:false}));
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>false,usePrefersReducedMotion:()=>state.reduced}));
vi.mock('@/components/landing/galaxy-backdrop',()=>({GalaxyBackdrop:()=><div data-testid="galaxy"/>}));
vi.mock('@/components/ui/flickering-grid',()=>({FlickeringGrid:(props:any)=><div data-testid="mask" style={props.style}/>}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
import {Hero} from '@/components/landing/hero';
beforeEach(()=>{state.reduced=false});

it('renders the page sentences, the stars and module names, with the CTA to the chooser',()=>{
 render(<Hero/>);
 for(const star of site.hero.constellation.stars){
  expect(screen.getByText(new RegExp(star.sentence.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))).toBeInTheDocument();
  expect(screen.getByText(star.label)).toBeInTheDocument();
 }
 for(const title of site.hero.constellation.modules)expect(screen.getByText(title.toUpperCase())).toBeInTheDocument();
 expect(document.querySelectorAll('[data-constellation-star]')).toHaveLength(6);
 expect(screen.getByRole('link',{name:/Start learning/})).toHaveAttribute('href','/workspace');
 expect(screen.getByText(site.hero.constellation.caption)).toHaveClass('sr-only');
 expect(document.querySelector('[data-constellation]')).toHaveAttribute('aria-hidden','true');
});

it('starts the scroll stage at progress 0 and shows the scroll cue',()=>{
 render(<Hero/>);
 const stage=document.querySelector('[data-hero-stage]') as HTMLElement;
 expect(stage.style.getPropertyValue('--hero-progress')).toBe('0');
 expect(stage.className).toContain('h-[180svh]');
 expect(screen.getByText('Scroll')).toBeInTheDocument();
});

it('reduced motion shows the finished constellation without a scroll stage',()=>{
 state.reduced=true;
 render(<Hero/>);
 const stage=document.querySelector('[data-hero-stage]') as HTMLElement;
 expect(stage.style.getPropertyValue('--hero-progress')).toBe('1');
 expect(stage.className).toContain('h-svh');
 expect(screen.queryByText('Scroll')).not.toBeInTheDocument();
 const page=document.querySelector('[data-constellation-page]') as HTMLElement;
 expect(page.style.opacity).toBe('0');
 const label=document.querySelector('[data-constellation-label]') as SVGTextElement;
 expect(label.style.opacity).toBe('1');
});
