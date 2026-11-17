import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import {RagExamples,STAGE_HOLD_MS} from '@/components/landing/rag-examples';
import {demoRuns,runDurationMs,stepsAt,answerCharsAt} from '@/content/landing-demo';
const run=demoRuns[0]!;
const state=vi.hoisted(()=>({active:true,reduced:false}));
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>state.active,usePrefersReducedMotion:()=>state.reduced}));
beforeEach(()=>{state.active=true;state.reduced=false;vi.useFakeTimers()});

it('timeline uses the product step labels and completes the answer step after streaming',()=>{
 expect(stepsAt(run,0).map(s=>s.label)).toEqual(['Choosing how to handle your question']);
 expect(stepsAt(run,700).map(s=>s.label)).toEqual(['Request routed','Searching selected documents']);
 expect(answerCharsAt(run,run.answerAt)).toBe(0);
 const steps=stepsAt(run,runDurationMs(run));
 expect(steps.find(s=>s.id==='answer')?.status).toBe('complete');
 expect(demoRuns[1]!.timeline.some(e=>e.step.parent==='retrieve')).toBe(true);
 expect(demoRuns[2]!.timeline.some(e=>e.step.results?.includes('Partial evidence'))).toBe(true);
});
it('shows the section heading and no comparison label',()=>{
 render(<RagExamples/>);
 expect(screen.getByRole('heading',{name:'Understand what you read'})).toBeInTheDocument();
 expect(screen.getByText('Ask mode answers with evidence.')).toBeInTheDocument();
 expect(screen.queryByText(/Master mode turns a document/)).not.toBeInTheDocument();
 expect(screen.queryByText(/Design B|for comparison/)).not.toBeInTheDocument();
});

it('waits behind a play overlay, then auto-plays once visible',()=>{
 state.active=false;
 const {rerender}=render(<RagExamples/>);
 expect(screen.getAllByText('Click to play').length).toBe(2); // overlay + bottom-left control, as in the sample
 expect(screen.queryByText(demoRuns[0]!.question)).not.toBeInTheDocument();
 state.active=true;rerender(<RagExamples/>);
 act(()=>vi.advanceTimersByTime(400));
 expect(screen.getByText(demoRuns[0]!.question)).toBeInTheDocument();
 expect(screen.getByText(/Choosing how to handle your question/)).toBeInTheDocument();
});
it('runs the same script: routed, researched, answer with citations, grounded card',()=>{
 vi.stubGlobal('fetch',vi.fn());
 render(<RagExamples/>);
 act(()=>vi.advanceTimersByTime(400)); // auto-play starts
 act(()=>vi.advanceTimersByTime(runDurationMs(demoRuns[0]!)+200));
 expect(screen.getByText(/Routed: Direct document search/)).toBeInTheDocument();
 expect(screen.getByText(/A Pod is the unit Kubernetes schedules/)).toBeInTheDocument();
 expect(screen.getByText(/Grounded in 2 cited sentences/)).toBeInTheDocument();
 expect(document.querySelectorAll('[data-stage-passage="done"]').length).toBeGreaterThanOrEqual(2);
 expect(fetch).not.toHaveBeenCalled();
});
it('switching question restarts with that run; the missing-evidence run ends partial',()=>{
 render(<RagExamples/>);
 fireEvent.click(screen.getByRole('button',{name:demoRuns[2]!.label}));
 expect(screen.getByRole('button',{name:demoRuns[2]!.label})).toHaveAttribute('aria-pressed','true');
 act(()=>vi.advanceTimersByTime(runDurationMs(demoRuns[2]!)+200));
 expect(screen.getByText(demoRuns[2]!.question)).toBeInTheDocument();
 expect(screen.getByText(/Partly answered/)).toBeInTheDocument();
});
it('pause freezes the run',()=>{
 render(<RagExamples/>);
 act(()=>vi.advanceTimersByTime(400));
 fireEvent.click(screen.getByRole('button',{name:'Pause demo'}));
 act(()=>vi.advanceTimersByTime(3000));
 expect(screen.queryByText(/Routed:/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Play demo'}));
 act(()=>vi.advanceTimersByTime(800));
 expect(screen.getByText(/Routed:/)).toBeInTheDocument();
});
it('reduced motion shows the finished run without overlay or controls',()=>{
 state.reduced=true;state.active=false;
 render(<RagExamples/>);
 expect(screen.queryByText('Click to play')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/demo$/})).not.toBeInTheDocument();
 expect(screen.getByText(/Grounded in 2 cited sentences/)).toBeInTheDocument();
});
it('plays all three questions in order, then stops on the last',()=>{
 render(<RagExamples/>);
 const pressed=()=>screen.getAllByRole('button',{pressed:true}).map(b=>b.textContent);
 act(()=>vi.advanceTimersByTime(400));
 for(let i=0;i<demoRuns.length;i++){
  expect(pressed()).toEqual([demoRuns[i]!.label]);
  act(()=>vi.advanceTimersByTime(runDurationMs(demoRuns[i]!)+100));
  expect(screen.getByText(demoRuns[i]!.question)).toBeInTheDocument();
  act(()=>vi.advanceTimersByTime(STAGE_HOLD_MS+100));
 }
 // Stopped on the last question, finished, with a replay control.
 expect(pressed()).toEqual([demoRuns[2]!.label]);
 expect(screen.getByText(/Partly answered/)).toBeInTheDocument();
 expect(screen.getByText('Click to replay')).toBeInTheDocument();
 act(()=>vi.advanceTimersByTime(10000));
 expect(pressed()).toEqual([demoRuns[2]!.label]);
 // Replay starts the sequence over from the first question.
 fireEvent.click(screen.getByRole('button',{name:'Play demo'}));
 expect(pressed()).toEqual([demoRuns[0]!.label]);
});
it('pausing during the hold keeps the finished run until play',()=>{
 render(<RagExamples/>);
 act(()=>vi.advanceTimersByTime(400));
 act(()=>vi.advanceTimersByTime(runDurationMs(demoRuns[0]!)+100));
 fireEvent.click(screen.getByRole('button',{name:'Pause demo'}));
 act(()=>vi.advanceTimersByTime(STAGE_HOLD_MS*3));
 expect(screen.getByRole('button',{name:demoRuns[0]!.label})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByRole('button',{name:'Play demo'}));
 expect(screen.getByRole('button',{name:demoRuns[1]!.label})).toHaveAttribute('aria-pressed','true');
});
it('advances by elapsed time even when timer ticks arrive late',()=>{
 render(<RagExamples/>);
 act(()=>vi.advanceTimersByTime(400)); // auto-play starts (~100 ms played)
 // Two ticks that each arrive ~300 ms late: counting ticks would add only 100 ms,
 // wall-clock time adds ~700 ms, enough to pass routing (650 ms).
 for(let i=0;i<2;i++)act(()=>{vi.setSystemTime(Date.now()+300);vi.advanceTimersToNextTimer();});
 expect(screen.getByText(/Routed: Direct document search/)).toBeInTheDocument();
});
