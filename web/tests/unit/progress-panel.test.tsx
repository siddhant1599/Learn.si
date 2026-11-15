import {it,expect} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {demoProgress,demoWeek} from '@/content/landing-demo';
import {ProgressPanel} from '@/components/landing/progress-panel';

it('progress numbers follow the planned progress shape',()=>{
 const before=demoProgress(3,null);
 expect(before).toMatchObject({completed:3,total:9,percent:33,quiz:'No quiz yet'});
 expect(before.modules.map(m=>m.level)).toEqual(['Mastered','Not started','Not started']);
 const after=demoProgress(4,true);
 expect(after.percent).toBe(44);
 expect(after.modules[1]).toMatchObject({done:1,level:'Developing'});
 expect(after.quiz).toBe('3/3 first try');
 expect(demoProgress(4,false).quiz).toBe('Passed on retake');
});

it('mini sky and stats update with completed lessons; the week scrubber replays up to today',()=>{
 const view=render(<ProgressPanel completed={3} quizFirstTry={null}/>);
 const states=()=>[...document.querySelectorAll('[data-mini-sky] g[data-state]')].map(g=>g.getAttribute('data-state'));
 expect(states().filter(s=>s==='mastered')).toHaveLength(3);
 expect(states()[3]).toBe('next');
 expect(screen.getByText('3/9')).toBeInTheDocument();
 view.rerender(<ProgressPanel completed={4} quizFirstTry={true}/>);
 expect(states().filter(s=>s==='mastered')).toHaveLength(4);
 expect(screen.getByText('4/9')).toBeInTheDocument();
 expect(screen.getByText('3/3 first try')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Replay the week'),{target:{value:'0'}});
 expect(states().filter(s=>s==='mastered')).toHaveLength(demoWeek[0]!.completed);
 expect(screen.getByText('Mon',{selector:'[aria-live]'})).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Replay the week'),{target:{value:String(demoWeek.length-1)}});
 expect(states().filter(s=>s==='mastered')).toHaveLength(4);
});
