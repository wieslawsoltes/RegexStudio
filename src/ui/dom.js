export const escapeHtml = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const el = (selector,root=document) => root.querySelector(selector);
export const els = (selector,root=document) => [...root.querySelectorAll(selector)];
export function formatBytes(n){return n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;}
export function debounce(fn,ms=300){let timer; const run=(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),ms)};run.cancel=()=>clearTimeout(timer);return run;}
export function preserveFocus(callback){const current=document.activeElement;const id=current?.id;const start=current?.selectionStart,end=current?.selectionEnd;const scroll=current?.scrollTop;callback();if(id){const next=document.getElementById(id);if(next&&next!==current){next.focus({preventScroll:true});if(typeof start==='number')try{next.setSelectionRange(start,end)}catch{};next.scrollTop=scroll||0;}}}
export function downloadText(name,text,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export async function copyText(text){try{await navigator.clipboard.writeText(text);return true;}catch{const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';document.body.append(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;}}
export function highlightText(input,matches,{limit=180000,selected=-1,color='#127a6b'}={}){
  const text=input.slice(0,limit), events=[];
  for(let i=0;i<matches.length;i++){const m=matches[i];if(m.index>text.length)continue;events.push({...m,i,end:Math.min(text.length,m.index+m.length)});}
  events.sort((a,b)=>a.index-b.index||a.i-b.i);let out='',pos=0;
  for(const m of events){if(m.index<pos)continue;out+=escapeHtml(text.slice(pos,m.index));const cls=m.i===selected?' selected':'';out+=`<mark class="match-highlight${m.length?'':' zero-width'}${cls}" data-match="${m.i}" title="Match ${m.i+1} · position ${m.index} · ${m.length} characters" style="--match-color:${color}">${m.length?escapeHtml(text.slice(m.index,m.end)):'<span aria-label="zero-width match">│</span>'}</mark>`;pos=m.end;}
  out+=escapeHtml(text.slice(pos));return out+(input.length>limit?'\n\n… Highlight preview limited to 180,000 characters. Matching uses all input.':'')+'\n';
}
