// Simulates a SECOND page load using the state persisted by the first.
import { JSDOM } from 'jsdom';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const ROOT=process.cwd(), PORT=4174, BASE=`http://localhost:${PORT}`;
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'};
const server=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(ROOT,u==='/'?'index.html':u);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}
 r.writeHead(200,{'Content-Type':MIME[path.extname(f)]??'text/plain'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>server.listen(PORT,r));

// State a returning user would have: dark theme, annual billing, FAQ open, subscribed.
const seeded = {version:1,preferences:{theme:'dark',billingCycle:'annual',reducedMotion:false},
 ui:{openFaqId:'faq-security'},subscription:{status:'success',email:'alex@company.com',updatedAt:'2026-08-01T00:00:00Z'},
 session:{visits:7,lastVisitAt:'2026-08-01T00:00:00Z',statsRevealed:true}};

const dom=new JSDOM(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),{url:`${BASE}/index.html`,
 runScripts:'outside-only',pretendToBeVisual:true});
const {window}=dom;
window.localStorage.setItem('prodesk:app-state',JSON.stringify(seeded));

// Now run the inline pre-paint script exactly as the browser would.
const inline=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
window.eval(inline);
const classAtPaint=window.document.documentElement.className;

window.matchMedia=()=>{const t=new window.EventTarget();t.matches=false;t.addListener=()=>{};t.removeListener=()=>{};return t;};
window.IntersectionObserver=class{constructor(c){this.c=c;}observe(){this.c([{isIntersecting:true}]);}unobserve(){}disconnect(){}};
window.requestAnimationFrame=f=>Number(global.setTimeout(()=>f(performance.now()),8));
window.cancelAnimationFrame=i=>global.clearTimeout(i);
window.scrollTo=()=>{};
const nf=globalThis.fetch;
const pf=(i,o)=>{
  const opts = o ? { ...o } : {};
  if (opts.signal && !(opts.signal instanceof global.AbortSignal)) delete opts.signal;
  return String(i).includes('formspree')?Promise.resolve(new Response('{}',{status:200})):nf(new URL(String(i),`${BASE}/`).href,opts);
};
window.fetch=pf;
for(const k of ['window','document','navigator','location','localStorage','fetch','requestAnimationFrame','cancelAnimationFrame','IntersectionObserver','AbortController','FormData','Node','MouseEvent','Event','EventTarget','DocumentFragment']){
 const v=k==='window'?window:window[k];
 try{globalThis[k]=v;}catch{Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}}
Object.defineProperty(globalThis,'fetch',{value:pf,configurable:true,writable:true});
Object.defineProperty(window,'performance',{value:performance,configurable:true});

await import(`${ROOT}/js/app.js?reload=1`);
await new Promise(r=>setTimeout(r,600));
const doc=window.document, api=window.__PRODESK__;
const out=[];const chk=(n,p,d='')=>out.push([n,p,d]);

chk('theme class correct AT FIRST PAINT (no flicker)', classAtPaint.includes('theme--dark')&&!classAtPaint.includes('theme--light'), classAtPaint);
chk('dark theme restored after boot', doc.documentElement.classList.contains('theme--dark'));
chk('annual billing restored', doc.querySelector('[data-plan-id="plan-growth"] .card__price-value').textContent==='$39');
chk('FAQ panel restored open', doc.querySelector('[data-faq-id="faq-security"] .faq__button').getAttribute('aria-expanded')==='true');
chk('other FAQ panels stay closed', doc.querySelector('[data-faq-id="faq-golive"] .faq__button').getAttribute('aria-expanded')==='false');
chk('subscribe shows subscribed state', doc.querySelector('#subscribe-btn').textContent==='Subscribed ✓' && doc.querySelector('#subscribe-btn').disabled);
chk('visit counter advanced 7 -> 8', api.state.get('session.visits')===8, String(api.state.get('session.visits')));
chk('nav starts CLOSED (transient not restored)', !doc.querySelector('.nav__menu').classList.contains('nav__menu--open'));
chk('counters skip animation when already revealed', doc.querySelector('p.stat__value[data-stat-id="stat-uptime"]').textContent==='99.99%');

console.log('\n═════════ RELOAD / PERSISTENCE VERIFICATION ═════════');
out.forEach(([n,p,d])=>console.log(`${p?'✓':'✗'}  ${n}${d?`\n     └─ ${d}`:''}`));
const f=out.filter(x=>!x[1]).length;
console.log(`\n${out.length-f}/${out.length} checks passed`);
server.close();process.exit(f?1:0);
