import { FileTextIcon, CircleAlertIcon, SquareIcon, GlobeIcon, LoaderCircleIcon, SearchIcon, SquareTerminalIcon, type LucideIcon } from "lucide-react";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtSearchResult, ChainOfThoughtSearchResults, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";
import type { ChatStep, ChatStepKind } from "@/core/chat/types";
const STEP_ICONS: Record<ChatStepKind, LucideIcon> = { search:SearchIcon,fetch:GlobeIcon,bash:SquareTerminalIcon,write:FileTextIcon };
function Activity({step}:{step:ChatStep}) {
 const active=step.status==='active',failed=step.status==='failed',stopped=step.status==='stopped';
 return <ChainOfThoughtStep icon={active?<LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none"/>:failed?<CircleAlertIcon className="size-4 text-destructive"/>:stopped?<SquareIcon className="size-4"/>:STEP_ICONS[step.kind]}
 label={failed?`${step.label} — failed`:stopped?`${step.label} — stopped`:active?`${step.label} — running`:step.label}
 className="min-w-0 break-words" status={active?'active':'complete'}>
 {step.results?.length ? <ChainOfThoughtSearchResults>{step.results.map((result,index)=><ChainOfThoughtSearchResult key={index}>{result}</ChainOfThoughtSearchResult>)}</ChainOfThoughtSearchResults>:null}
 </ChainOfThoughtStep>;
}
export function MessageSteps({steps}:{steps:ChatStep[]}) {
 const parents=steps.filter(s=>!s.parent);
 return <ChainOfThought className="w-full min-w-0 gap-2 rounded-lg border p-0.5" open={true}>
   <p className="px-4 pt-2 text-xs text-muted-foreground break-words" role="status" aria-live="polite" aria-atomic="true">{parents.filter(s=>s.status==='active').map(s=>s.label).join('. ') || 'No activity running'}</p>
   <ChainOfThoughtContent className="max-h-80 overflow-y-auto px-4 py-2">
   {parents.map(step=><div key={step.id} className="space-y-2">
     <Activity step={step}/>
     {steps.some(s=>s.parent===step.id)&&<details className="ml-4 text-xs">
       <summary className="cursor-pointer py-1">{step.kind==='fetch'?'Web':'Research'} task details ({steps.filter(s=>s.parent===step.id).length})</summary>
       <div className="space-y-2 pt-2">{steps.filter(s=>s.parent===step.id).sort((a,b)=>a.id.localeCompare(b.id)).map(child=><Activity key={child.id} step={child}/>)}</div>
     </details>}
   </div>)}
   </ChainOfThoughtContent>
 </ChainOfThought>;
}
