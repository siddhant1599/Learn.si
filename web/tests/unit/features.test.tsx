import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {site} from '@/config/site';
const state=vi.hoisted(()=>({inView:false,reduced:false,mobile:false,bentoMounted:0}));
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>state.inView,usePrefersReducedMotion:()=>state.reduced}));
vi.mock('@/hooks/use-mobile',()=>({useIsMobile:()=>state.mobile}));
vi.mock('next/dynamic',()=>({default:()=>()=>{state.bentoMounted++;return <div data-testid="magic-bento"/>}}));
import {WhatsNewSection} from '@/components/landing/sections/whats-new-section';
import {Section} from '@/components/landing/section';
beforeEach(()=>{state.inView=false;state.reduced=false;state.mobile=false;state.bentoMounted=0});

it('renders every feature as static, untruncated markup before the enhancement mounts',()=>{
 render(<WhatsNewSection/>);
 for(const f of site.whatsNew.features){
  expect(screen.getByRole('heading',{level:3,name:f.title as string})).toBeInTheDocument();
  expect(screen.getByText(f.description as string)).toBeInTheDocument();
 }
 expect(document.querySelectorAll('.magic-bento-card')).toHaveLength(site.whatsNew.features.length);
 expect(document.querySelector('.magic-bento-card--text-autohide')).toBeNull();
 expect(screen.queryByTestId('magic-bento')).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{level:2,name:site.whatsNew.title})).toBeInTheDocument();
});

it('mounts the animated grid only on in-view desktop pointer contexts',()=>{
 state.inView=true;state.mobile=true;
 const mobile=render(<WhatsNewSection/>);
 expect(screen.queryByTestId('magic-bento')).not.toBeInTheDocument();
 mobile.unmount();
 state.mobile=false;state.reduced=true;
 const reduced=render(<WhatsNewSection/>);
 expect(screen.queryByTestId('magic-bento')).not.toBeInTheDocument();
 reduced.unmount();
 state.reduced=false;
 render(<WhatsNewSection/>);
 expect(screen.getByTestId('magic-bento')).toBeInTheDocument();
});

it('Section renders a real h2 and a paragraph subtitle',()=>{
 render(<Section title="Watch a question become an answer" subtitle="Three examples."><div/></Section>);
 expect(screen.getByRole('heading',{level:2,name:'Watch a question become an answer'})).toBeInTheDocument();
 expect(screen.getByText('Three examples.').tagName).toBe('P');
});
