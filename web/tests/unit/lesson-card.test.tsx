import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within} from '@testing-library/react';
import {demoLesson,gradeImage,gradeQuiz} from '@/content/landing-demo';
vi.mock('@/core/dom/render-activity',()=>({useRenderActivity:()=>false,usePrefersReducedMotion:()=>false}));
import {LessonCard} from '@/components/landing/lesson-card';

const answerAll=(bank:typeof demoLesson.quizBanks[number],pick:(q:typeof bank[number])=>string)=>{
 for(const q of bank){
  const fieldset=document.querySelector(`[data-question="${q.id}"]`) as HTMLElement;
  const option=q.options.find(o=>o.id===pick(q))!;
  fireEvent.click(within(fieldset).getByLabelText(option.text));
 }
};

it('grades the TODO(you) image gap: tagged, untagged, junk',()=>{
 expect(gradeImage('nginx:1.27')).toBe('correct');
 expect(gradeImage('ghcr.io/acme/web:2.0.1')).toBe('correct');
 expect(gradeImage('nginx')).toBe('partial');
 expect(gradeImage('not an image!')).toBe('incorrect');
 expect(gradeQuiz(demoLesson.quizBanks[0]!,{})).toEqual({score:0,passed:false});
});

it('lesson front shows the contract blocks and checks the gap with specific feedback',()=>{
 render(<LessonCard onPass={vi.fn()} passed={false}/>);
 expect(screen.getByRole('heading',{level:3,name:/Lesson 4 · Pods/})).toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveTextContent(demoLesson.insight.kind);
 const input=screen.getByLabelText('Image for the web container');
 fireEvent.change(input,{target:{value:'nginx'}});fireEvent.click(screen.getByRole('button',{name:'Check'}));
 expect(screen.getByRole('status')).toHaveTextContent(/without a tag/);
 fireEvent.change(input,{target:{value:'nginx:1.27'}});fireEvent.click(screen.getByRole('button',{name:'Check'}));
 expect(screen.getByRole('status')).toHaveTextContent(demoLesson.yourTurn.correct);
 expect(screen.queryByText('Show the answer')).not.toBeInTheDocument();
});

it('reveal appears after two misses',()=>{
 render(<LessonCard onPass={vi.fn()} passed={false}/>);
 const input=screen.getByLabelText('Image for the web container');
 fireEvent.change(input,{target:{value:'???'}});fireEvent.click(screen.getByRole('button',{name:'Check'}));
 fireEvent.change(input,{target:{value:'!!!'}});fireEvent.click(screen.getByRole('button',{name:'Check'}));
 fireEvent.click(screen.getByText('Show the answer'));
 expect(input).toHaveValue(demoLesson.yourTurn.reveal);
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
