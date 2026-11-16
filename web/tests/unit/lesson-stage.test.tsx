import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {LessonStage} from '@/components/landing/lesson-stage';
import {demoLesson} from '@/content/landing-demo';
const state=vi.hoisted(()=>({reduced:true}));
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>true,usePrefersReducedMotion:()=>state.reduced}));
beforeEach(()=>{state.reduced=true});
const lessonStates=()=>[...document.querySelectorAll('[data-b-lesson-state]')].map(n=>n.getAttribute('data-b-lesson-state'));

it('shows the same lesson and progress content, labelled for comparison',()=>{
 render(<LessonStage/>);
 expect(screen.getByText('Design B · for comparison')).toBeInTheDocument();
 expect(screen.getAllByText(/Lesson 4 · Pods/).length).toBeGreaterThan(0);
 expect(screen.getByText(demoLesson.objective)).toBeInTheDocument();
 expect(screen.getByText(demoLesson.insight.text)).toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'Your sky, filling in'})).toBeInTheDocument();
 expect(lessonStates().filter(s=>s==='mastered')).toHaveLength(3);
 expect(lessonStates()[3]).toBe('next');
});
it('ordering exercise grades with the same verdicts',()=>{
 render(<LessonStage/>);
 fireEvent.click(screen.getByRole('button',{name:'Check order'}));
 expect(document.querySelector('[data-b-order-verdict]')).toHaveAttribute('data-b-order-verdict','incorrect');
 const up=(text:string)=>fireEvent.click(screen.getByRole('button',{name:`Move up: ${text}`}));
 const [describe,schedule]=demoLesson.order.steps.map(s=>s.text);
 up(describe!);up(describe!);up(schedule!);up(schedule!);
 fireEvent.click(screen.getByRole('button',{name:'Check order'}));
 expect(document.querySelector('[data-b-order-verdict]')).toHaveAttribute('data-b-order-verdict','correct');
 expect(document.querySelectorAll('[data-b-placed="true"]')).toHaveLength(4);
});
it('failing then passing the quiz lights Pods in the tree and opens the next lesson',()=>{
 render(<LessonStage/>);
 fireEvent.click(screen.getByRole('button',{name:/Take the quiz/}));
 const submit=()=>screen.getByRole('button',{name:'Submit answers'});
 expect(submit()).toBeDisabled();
 const choose=(qid:string,value:string)=>fireEvent.click(document.querySelector(`[data-b-question="${qid}"] input[value="${value}"]`)!);
 choose('a1','a');choose('a2','c');choose('a3','b');
 fireEvent.click(submit());
 expect(document.querySelector('[data-b-quiz-result]')).toHaveAttribute('data-b-quiz-result','failed');
 fireEvent.click(screen.getByRole('button',{name:'Retake with new questions'}));
 expect(document.querySelector('[data-b-quiz]')).toHaveAttribute('data-b-attempt','2');
 choose('b1','b');choose('b2','a');choose('b3','b');
 fireEvent.click(submit());
 expect(document.querySelector('[data-b-quiz-result]')).toHaveAttribute('data-b-quiz-result','passed');
 expect(document.querySelector('[data-b-progress]')).toHaveAttribute('data-b-completed','4');
 expect(lessonStates()[3]).toBe('mastered');
 expect(lessonStates()[4]).toBe('next');
 expect(screen.getByText('Passed on retake')).toBeInTheDocument();
 fireEvent.click(within(document.querySelector('[data-b-quiz-result]') as HTMLElement).getByRole('button',{name:/Back to the lesson/}));
 expect(document.querySelector('[data-b-lesson]')).toHaveAttribute('data-b-side','lesson');
});
it('replaying the week shows earlier progress',()=>{
 render(<LessonStage/>);
 fireEvent.change(screen.getByLabelText('Replay the week'),{target:{value:'0'}});
 expect(document.querySelector('[data-b-progress]')).toHaveAttribute('data-b-completed','1');
 expect(lessonStates()[1]).toBe('next');
});
