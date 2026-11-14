import type { ChatStep } from "./types";
const stages: Record<string, [string,string]> = {
 triage: ["Choosing how to handle your question", "Request routed"],
 conversational: ["Preparing a response", "Response prepared"],
 plan: ["Preparing research questions", "Search planned"],
 hyde: ["Preparing retrieval hints", "Retrieval hints prepared"],
 retrieve: ["Searching selected documents", "Document search finished"],
 assess: ["Checking document evidence coverage", "Document evidence checked"],
 refine: ["Searching documents for remaining gaps", "Document search refined"],
 web: ["Researching missing evidence on the web", "Web research finished"],
 answer: ["Preparing the answer", "Answer prepared"],
 error_handler: ["Checking recovery options", "Recovery handled"],
};
const outcomes: Record<string,string> = {
 sufficient:"Sufficient evidence",partial:"Partial evidence",none:"Missing evidence",assessment_error:"Assessment unavailable",
 retrieved:"Evidence retrieved",empty:"No evidence found",blocked:"Blocked by an earlier task",unavailable:"Unavailable",budget:"Skipped to preserve answer budget",
 greeting:"Conversational response",clarify:"Clarification needed",direct_retrieval:"Direct document search",complex_research:"Multi-question research",
 retry:"Retry or fallback selected",fallback:"Using the original question",search:"Web search",checking:"Checking web evidence",hints:"Retrieval hints",
};
export function progressStep(data: unknown): ChatStep | undefined {
 if (!data || typeof data !== "object") return;
 const d = data as Record<string, unknown>;
 if (typeof d.step !== "string" || !stages[d.step]) return;
 const status = d.status === undefined && d.version === undefined ? "complete" : d.status === "started" ? "active" : d.status === "completed" ? "complete" : d.status === "failed" ? "failed" : d.status === "stopped" ? "stopped" : undefined;
 if (!status) return;
 if (d.version !== undefined && d.version !== 1) return;
 const modern = d.version === 1;
 if (modern && (!Number.isSafeInteger(d.attempt) || (d.attempt as number)<0 || !Number.isSafeInteger(d.sequence) || (d.sequence as number)<1)) return;
 const task = typeof d.task === "string" && /^(q[1-4]|wq[12]|check-wq[12])$/.test(d.task) ? d.task : undefined;
 if (modern && (d.task !== undefined && !task || d.id !== d.step + (task ? ':'+task : ''))) return;
 const results: string[] = [];
 let label = stages[d.step]![(modern ? status !== 'complete' : status === 'active') ? 0 : 1];
 if (!modern) {
   if (d.step === 'retrieve') label = 'Evidence retrieved';
   if (d.step === 'assess') label = 'Evidence checked';
   if (d.step === 'web') label = 'Web search and evidence assessment completed';
 }
 if (task) {
   const number = task.match(/\d+$/)![0];
   label = d.step === 'web' ? (task.startsWith('q') ? `Web fallback for document task ${number}` : task.startsWith('check-') ? `Web evidence check ${number}` : `Web search ${number}`)
     : `${d.step === 'assess' ? 'Document evidence check' : d.step === 'hyde' ? 'Retrieval hints for task' : 'Document search'} ${number}`;
 }
 if (typeof d.outcome === 'string' && outcomes[d.outcome]) results.push(outcomes[d.outcome]!);
 if (typeof d.count === 'number' && Number.isSafeInteger(d.count) && d.count>=0 && d.count<=1000) results.push(`${d.count} ${d.step === 'plan' ? 'research tasks' : d.step === 'hyde' ? 'retrieval hints' : 'evidence items'}`);
 return {id: d.step + (task ? ':'+task : ''), kind:d.step==='web'?'fetch':d.step==='answer'?'write':'search',label,status,
   ...(modern ? {progressVersion:1 as const,attempt:d.attempt as number,sequence:d.sequence as number,parent:task?d.step:undefined,results} : {})};
}
