import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {DeleteButton} from '@/components/chat/delete-button';
it('cancel preserves data and names the item',()=>{
 const remove=vi.fn();render(<DeleteButton title="Fixture" description="Keep sources" onDelete={remove}/>);
 fireEvent.click(screen.getByRole('button',{name:'Delete Fixture'}));
 expect(screen.getByRole('dialog')).toHaveTextContent('Delete Fixture?');
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(remove).not.toHaveBeenCalled();
});
it('blocks duplicates while pending and offers retry after error',async()=>{
 let reject!:(e:Error)=>void;
 const remove=vi.fn().mockImplementationOnce(()=>new Promise((_,r)=>{reject=r})).mockResolvedValue(undefined);
 render(<DeleteButton title="Fixture" description="Keep sources" onDelete={remove}/>);
 fireEvent.click(screen.getByRole('button',{name:'Delete Fixture'}));fireEvent.click(screen.getByRole('button',{name:'Delete',exact:true}));
 expect(screen.getByRole('button',{name:'Deleting…'})).toBeDisabled();
 reject(new Error('Offline'));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Offline'));
 fireEvent.click(screen.getByRole('button',{name:'Retry deletion'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(remove).toHaveBeenCalledTimes(2);
});
