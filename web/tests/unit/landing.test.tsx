import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import {RagExamples} from '@/components/landing/rag-examples';
import {demoRuns,runDurationMs,stepsAt,answerCharsAt} from '@/content/landing-demo';
const state=vi.hoisted(()=>({active:true,reduced:false}));
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>state.active,usePrefersReducedMotion:()=>state.reduced}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
beforeEach(()=>{state.active=true;state.reduced=false});
const run=demoRuns[0]!;

it('labels the runs as scripted and makes no network calls',()=>{
 vi.stubGlobal('fetch',vi.fn());
 render(<RagExamples/>);
 expect(screen.getByText(/Scripted illustration · no model calls/)).toBeVisible();
 expect(fetch).not.toHaveBeenCalled();
});
it('first run is selected and associated with its panel',()=>{render(<RagExamples/>);const tab=screen.getByRole('tab',{name:run.label});expect(tab).toHaveAttribute('aria-selected','true');expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby',tab.id)});
it('switching run changes the question and the passages',()=>{render(<RagExamples/>);fireEvent.click(screen.getByRole('tab',{name:demoRuns[1]!.label}));expect(screen.getByText(demoRuns[1]!.question)).toBeVisible();expect(screen.getByText('Deployments keep the desired replica count running.')).toBeVisible()});
it('timeline uses the product step labels and completes the answer step after streaming',()=>{
 expect(stepsAt(run,0).map(s=>s.label)).toEqual(['Choosing how to handle your question']);
 expect(stepsAt(run,700).map(s=>s.label)).toEqual(['Request routed','Searching selected documents']);
 expect(answerCharsAt(run,run.answerAt)).toBe(0);
 const steps=stepsAt(run,runDurationMs(run));
 expect(steps.find(s=>s.id==='answer')?.status).toBe('complete');
 expect(demoRuns[1]!.timeline.some(e=>e.step.parent==='retrieve')).toBe(true);
 expect(demoRuns[2]!.timeline.some(e=>e.step.results?.includes('Partial evidence'))).toBe(true);
});
it('advances the real activity panel on the timer',()=>{vi.useFakeTimers();render(<RagExamples/>);expect(screen.getAllByText(/Choosing how to handle your question/).length).toBeGreaterThan(0);act(()=>vi.advanceTimersByTime(800));expect(screen.getByText('Request routed')).toBeInTheDocument();expect(screen.getAllByText(/Searching selected documents/).length).toBeGreaterThan(0)});
it('streams the answer with citation markers and highlights cited passages',()=>{
 vi.useFakeTimers();render(<RagExamples/>);
 act(()=>vi.advanceTimersByTime(runDurationMs(run)+100));
 expect(screen.getByRole('button',{name:'Citation 1'})).toBeInTheDocument();
 expect(screen.getByText(/A Pod is the unit Kubernetes schedules/)).toBeInTheDocument();
 expect(document.querySelectorAll('[data-cited]')).toHaveLength(2);
 expect(screen.getByText('Answer prepared')).toBeInTheDocument();
 fireEvent.focus(screen.getByRole('button',{name:'Citation 2'}));
 expect(document.querySelector('[data-cited="focus"]')).toHaveTextContent('Keep containers stateless');
});
it('pause freezes and play resumes',()=>{vi.useFakeTimers();render(<RagExamples/>);fireEvent.click(screen.getByRole('button',{name:'Pause preview'}));act(()=>vi.advanceTimersByTime(3000));expect(screen.queryByText('Request routed')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Play preview'}));act(()=>vi.advanceTimersByTime(800));expect(screen.getByText('Request routed')).toBeInTheDocument()});
it('replay restarts from the beginning',()=>{vi.useFakeTimers();render(<RagExamples/>);act(()=>vi.advanceTimersByTime(2000));fireEvent.click(screen.getByRole('button',{name:'Replay preview'}));expect(screen.queryByText('Request routed')).not.toBeInTheDocument()});
it('offscreen runs do not advance',()=>{state.active=false;vi.useFakeTimers();render(<RagExamples/>);act(()=>vi.advanceTimersByTime(9000));expect(screen.queryByText('Request routed')).not.toBeInTheDocument()});
it('reduced motion renders the complete answer without waiting',()=>{state.reduced=true;render(<RagExamples/>);expect(screen.getByText(/A Pod is the unit Kubernetes schedules/)).toBeInTheDocument();expect(screen.getByText('Answer prepared')).toBeInTheDocument()});
it('keyboard navigation moves focus and selection across tabs',()=>{render(<RagExamples/>);const first=screen.getByRole('tab',{name:demoRuns[0]!.label});first.focus();fireEvent.keyDown(first,{key:'ArrowRight'});const second=screen.getByRole('tab',{name:demoRuns[1]!.label});expect(second).toHaveFocus();expect(second).toHaveAttribute('aria-selected','true');fireEvent.keyDown(second,{key:'End'});expect(screen.getByRole('tab',{name:demoRuns[2]!.label})).toHaveFocus()});
