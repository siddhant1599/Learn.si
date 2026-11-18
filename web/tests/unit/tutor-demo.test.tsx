import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,act,fireEvent} from '@testing-library/react';
import {demoTutor,tutorFrameAt,tutorScriptDuration,TUTOR_TIMING} from '@/content/landing-demo';
const state=vi.hoisted(()=>({reduced:false}));
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>true,usePrefersReducedMotion:()=>state.reduced}));
import {TutorDemo} from '@/components/landing/tutor-demo';

afterEach(()=>{vi.useRealTimers();state.reduced=false;});
const [hint,answer]=demoTutor.turns;

it('the script types a question, thinks, streams a hint, then the chip asks for the answer',()=>{
 expect(tutorFrameAt(0)).toMatchObject({sent:0,draft:'',answered:0});
 expect(tutorFrameAt(TUTOR_TIMING.typePerChar*5).draft).toBe(hint!.question.slice(0,5));
 const typed=hint!.question.length*TUTOR_TIMING.typePerChar;
 expect(tutorFrameAt(typed+10)).toMatchObject({sent:1,thinking:true,chars:0});
 expect(tutorFrameAt(typed+TUTOR_TIMING.think+TUTOR_TIMING.streamPerChar*10).chars).toBe(10);
 const second=tutorScriptDuration-(TUTOR_TIMING.chipPress+TUTOR_TIMING.think+answer!.answer.length*TUTOR_TIMING.streamPerChar+TUTOR_TIMING.hold);
 expect(tutorFrameAt(second+10)).toMatchObject({sent:1,answered:1,chip:'Just tell me the answer'});
 expect(tutorFrameAt(tutorScriptDuration)).toMatchObject({sent:2,answered:2,thinking:false});
 // Pods only, guided first: the hint asks back instead of answering.
 expect(hint!.answer).toMatch(/\?$/);
 expect(answer!.answer).toMatch(/Pod dies with it/);
});

it('plays by itself once on screen and ends with both answers and their lesson sources',()=>{
 vi.useFakeTimers();
 render(<TutorDemo/>);
 expect(screen.queryByText(hint!.question)).not.toBeInTheDocument();
 act(()=>{vi.advanceTimersByTime(700);});
 for(let t=0;t<tutorScriptDuration+2000;t+=50) act(()=>{vi.advanceTimersByTime(50);});
 expect(screen.getByText(hint!.question)).toBeVisible();
 expect(screen.getByText(answer!.answer)).toBeVisible();
 expect(screen.getByText(`“${answer!.source}”`)).toBeVisible();
 expect(document.querySelector('[data-tutor-done]')).not.toBeNull();
 // Replay starts over.
 fireEvent.click(screen.getByRole('button',{name:'Replay the tutor demo'}));
 expect(screen.queryByText(answer!.answer)).not.toBeInTheDocument();
});

it('reduced motion shows the finished conversation without animating',()=>{
 state.reduced=true;
 render(<TutorDemo/>);
 expect(screen.getByText(hint!.answer)).toBeVisible();
 expect(screen.getByText(answer!.answer)).toBeVisible();
});

it('makes no network calls',()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 state.reduced=true;render(<TutorDemo/>);
 expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
