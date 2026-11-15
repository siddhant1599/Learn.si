import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {demoLesson,gradeOrder,gradeQuiz} from '@/content/landing-demo';
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>false,usePrefersReducedMotion:()=>false}));
import {LessonCard} from '@/components/landing/lesson-card';

const answerAll=(bank:typeof demoLesson.quizBanks[number],pick:(q:typeof bank[number])=>string)=>{
 for(const q of bank){
  const fieldset=document.querySelector(`[data-question="${q.id}"]`) as HTMLElement;
  const option=q.options.find(o=>o.id===pick(q))!;
  fireEvent.click(within(fieldset).getByLabelText(option.text));
 }
};
const currentOrder=()=>[...document.querySelectorAll('[data-order-item]')].map(li=>li.getAttribute('data-order-item'));
const stepText=(id:string)=>demoLesson.order.steps.find(s=>s.id===id)!.text;

it('grades the order by positions that match',()=>{
 const correct=demoLesson.order.steps.map(s=>s.id);
 expect(gradeOrder(correct)).toEqual({verdict:'correct',correctPositions:4});
 expect(gradeOrder(demoLesson.order.start).verdict).toBe('incorrect');
 expect(gradeOrder([...correct, 'extra']).verdict).not.toBe('correct');
 expect(gradeOrder(correct.slice(0, 3)).verdict).not.toBe('correct');
 expect(gradeOrder([correct[0]!,correct[1]!,correct[3]!,correct[2]!]).verdict).toBe('partial');
 expect(gradeQuiz(demoLesson.quizBanks[0]!,{})).toEqual({score:0,passed:false});
});

it('paragraphs are short and the lesson shows the contract blocks',()=>{
 for(const paragraph of demoLesson.explanation)expect(paragraph.split(/\s+/).length).toBeLessThanOrEqual(45);
 render(<LessonCard onPass={vi.fn()} passed={false}/>);
 expect(screen.getByRole('heading',{level:3,name:/Lesson 4 · Pods/})).toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveTextContent(demoLesson.insight.kind);
 expect(screen.getByText('Your turn · set the order')).toBeInTheDocument();
 expect(currentOrder()).toEqual(demoLesson.order.start);
 expect(screen.queryByText(/TODO\(you\)/)).not.toBeInTheDocument();
});

it('moving steps and checking gives specific feedback, then marks placed steps',()=>{
 render(<LessonCard onPass={vi.fn()} passed={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Check order'}));
 expect(screen.getByRole('status')).toHaveTextContent(demoLesson.order.feedback.incorrect);
 // Move "describe" to the top and "schedule" to second place.
 fireEvent.click(screen.getByRole('button',{name:`Move up: ${stepText('describe')}`}));
 fireEvent.click(screen.getByRole('button',{name:`Move up: ${stepText('describe')}`}));
 fireEvent.click(screen.getByRole('button',{name:`Move up: ${stepText('schedule')}`}));
 fireEvent.click(screen.getByRole('button',{name:`Move up: ${stepText('schedule')}`}));
 expect(currentOrder()).toEqual(['describe','schedule','start','network']);
 fireEvent.click(screen.getByRole('button',{name:'Check order'}));
 expect(screen.getByRole('status')).toHaveTextContent(demoLesson.order.feedback.correct);
 expect(document.querySelectorAll('[data-placed="true"]')).toHaveLength(4);
 expect(screen.getByRole('button',{name:'Check order'})).toBeDisabled();
 expect(screen.getByRole('button',{name:`Move up: ${stepText('describe')}`})).toBeDisabled();
 expect(screen.getByRole('button',{name:`Move down: ${stepText('describe')}`})).toBeDisabled();
});

it('offers to show the order after two misses',()=>{
 render(<LessonCard onPass={vi.fn()} passed={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'Check order'}));
 fireEvent.click(screen.getByRole('button',{name:'Check order'}));
 fireEvent.click(screen.getByText('Show the order'));
 expect(currentOrder()).toEqual(demoLesson.order.steps.map(s=>s.id));
 expect(screen.getByRole('status')).toHaveTextContent(demoLesson.order.feedback.correct);
});

it('quiz: fail on bank one, retake with new questions, pass on bank two, reports not-first-try',()=>{
 const onPass=vi.fn();
 render(<LessonCard onPass={onPass} passed={false}/>);
 fireEvent.click(screen.getByRole('button',{name:/Take the quiz/}));
 expect(document.querySelector('[data-lesson-card]')).toHaveAttribute('data-side','quiz');
 const [bank1,bank2]=demoLesson.quizBanks as [typeof demoLesson.quizBanks[number],typeof demoLesson.quizBanks[number]];
 expect(screen.getByRole('button',{name:'Submit answers'})).toBeDisabled();
 answerAll(bank1,q=>q.options.find(o=>o.id!==q.correct)!.id);
 fireEvent.click(screen.getByRole('button',{name:'Submit answers'}));
 expect(document.querySelector('[data-quiz-result]')).toHaveAttribute('data-quiz-result','failed');
 expect(document.querySelectorAll('[data-explanation]')).toHaveLength(3);
 expect(onPass).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Retake with new questions'}));
 expect(document.querySelector('[data-quiz]')).toHaveAttribute('data-attempt','2');
 expect(screen.getByText(bank2[0]!.stem,{exact:false})).toBeInTheDocument();
 expect(screen.queryByText(bank1[0]!.stem,{exact:false})).not.toBeInTheDocument();
 answerAll(bank2,q=>q.correct);
 fireEvent.click(screen.getByRole('button',{name:'Submit answers'}));
 expect(document.querySelector('[data-quiz-result]')).toHaveAttribute('data-quiz-result','passed');
 expect(onPass).toHaveBeenCalledWith(false);
});

it('passing two of three on the first attempt reports first try',()=>{
 const onPass=vi.fn();
 render(<LessonCard onPass={onPass} passed={false}/>);
 fireEvent.click(screen.getByRole('button',{name:/Take the quiz/}));
 const bank=demoLesson.quizBanks[0]!;
 answerAll(bank,q=>q.id==='a3'?q.options.find(o=>o.id!==q.correct)!.id:q.correct);
 fireEvent.click(screen.getByRole('button',{name:'Submit answers'}));
 expect(screen.getByText(/2\/3 · Passed/)).toBeInTheDocument();
 expect(onPass).toHaveBeenCalledWith(true);
});

it('keeps placed steps movable after partial feedback and clears stale grading',()=>{
 render(<LessonCard onPass={vi.fn()} passed={false}/>);
 expect(screen.getByRole('button',{name:`Move up: ${stepText('start')}`})).toBeDisabled();
 expect(screen.getByRole('button',{name:`Move down: ${stepText('schedule')}`})).toBeDisabled();
 for(let i=0;i<2;i++)fireEvent.click(screen.getByRole('button',{name:`Move up: ${stepText('describe')}`}));
 expect(currentOrder()).toEqual(['describe','start','network','schedule']);
 fireEvent.click(screen.getByRole('button',{name:`Move up: ${stepText('network')}`}));
 fireEvent.click(screen.getByRole('button',{name:'Check order'}));
 expect(screen.getByRole('status')).toHaveTextContent(demoLesson.order.feedback.partial);
 expect(document.querySelectorAll('[data-placed="true"]')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:`Move down: ${stepText('describe')}`}));
 expect(screen.getByRole('status')).toBeEmptyDOMElement();
 expect(document.querySelectorAll('[data-placed]')).toHaveLength(0);
 expect(screen.queryByRole('button',{name:'Show the order'})).not.toBeInTheDocument();
 const order=currentOrder();
 fireEvent.click(screen.getByRole('button',{name:/Take the quiz/}));
 fireEvent.click(screen.getByRole('button',{name:/Back to the lesson/}));
 expect(currentOrder()).toEqual(order);
});
