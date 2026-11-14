// Render test + rule validation for the v3 skills map
const fs=require('fs'); const {JSDOM}=require('jsdom');
const file=process.argv[2];
const html=fs.readFileSync(file,'utf8');
const errors=[]; const warns=[];
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#skills',beforeParse(w){w.scrollTo=()=>{}; w.onerror=(m)=>errors.push('JS: '+m);}});
const w=dom.window;
w.addEventListener('error',e=>errors.push('JS error: '+e.message));
const N=w.eval('N'), E=w.eval('E'), ITEMS=w.eval('ITEMS'), MISSIONS=w.eval('MISSIONS'), REGIONS=w.eval('REGIONS'), SENSEI=w.eval('SENSEI'), GEAR=w.eval('GEAR');
const checkHidden=()=>{ const t=w.eval('typeof isHidden'); if(t!=='function') errors.push('isHidden відсутня в карті'); };
const views=['skills','masteries','missions','web','world','combat','matrix','items','check','rules'];
try{
  for(const n of N){ w.eval(`current=${JSON.stringify(n.id)};renderCard();renderMCard();`); }
  w.eval('renderMatrix();renderItems();renderCheck();renderMissions();renderWeb();renderWorld();renderCombat();');
  for(const v of views){ w.location.hash=v; w.eval('route()'); const sec=w.document.getElementById('v-'+v); if(!sec) errors.push('Немає секції '+v); else if(sec.textContent.trim().length<40) errors.push('Порожня вкладка '+v); }
  ['wk','wb','wd','cb'].forEach(id=>{ const el=w.document.getElementById(id); if(!el||el.innerHTML.length<200) errors.push('Порожній блок #'+id); });
  if(!w.document.querySelector('nav a[data-view="web"]')) errors.push('Немає вкладки «Мережа» в навігації');
}catch(e){ errors.push('Render: '+e.message); }
const byId=Object.fromEntries(N.map(n=>[n.id,n]));
const ids=new Set(N.map(n=>n.id));
const skills=N.filter(n=>n.g!=='sys'&&n.g!=='village');
const isHidden=x=>x.d&&!/^Контракт роду|^Знаки довіри/.test(x.d)&&(!x.rqb||/лінія доручень|сувій|Ранг|Шарінґан|меч|клинки/.test(x.d));
const bandOk=(rk)=>({D:[1,30],C:[30,50],B:[50,70],A:[70,90],S:[90,99]})[rk];
const SYS_OK=new Set(['all','tech','missions','combat','pouch','bingo','ranks','cl','village','eyes']);
for(const n of skills){
  const m=n.m||[];
  if(!['map','none','village'].includes(n.mt)){
    if(m.length<10) errors.push(`${n.name}: ${m.length} майстерностей (<10)`);
    const lv=[...new Set(m.map(x=>x.l))].sort((a,b)=>a-b);
    lv.forEach(l=>{ if(!(l===1||l===99||l%5===0)) errors.push(`${n.name}: рівень ${l} не кратний 5`); });
    const ord=m.filter(x=>!isHidden(x)).map(x=>x.l).sort((a,b)=>a-b);
    for(let i=1;i<ord.length;i++) if(ord[i]-ord[i-1]>10) errors.push(`${n.name}: розрив ${ord[i-1]}→${ord[i]} між звичайними`);
    const sorted=[...m].sort((a,b)=>a.l-b.l);
    for(let i=1;i<sorted.length;i++) if(isHidden(sorted[i])&&isHidden(sorted[i-1])&&sorted[i].l!==sorted[i-1].l) errors.push(`${n.name}: приховані поруч ${sorted[i-1].n} / ${sorted[i].n}`);
    if(n.mt==='tech'){
      const exempt=['mednin','sage','fusion'].includes(n.id);
      m.forEach(x=>{ if(!x.rk) errors.push(`${n.name}: ${x.n} без рангу`);
        if(x.rkc&&!exempt){ const b=bandOk(x.rk); if(b&&(x.l<b[0]||x.l>b[1])) errors.push(`${n.name}: ${x.n} — ранг ${x.rk} на рівні ${x.l}`); }
        if(!x.role) errors.push(`${n.name}: ${x.n} без ролі`);
        if(x.src&&x.src!=='N'&&!x.home) errors.push(`${n.name}: ${x.n} без домівки`);
        if(!exempt&&(x.rk==='A'||x.rk==='S')&&!x.d) errors.push(`Правило 3: ${n.name}: ${x.n} (${x.rk}) без вимоги поза навичкою`);
        if(x.rqb&&!/^(Канон|Лорно)/.test(x.rqb)) errors.push(`Правило 5: ${n.name}: ${x.n} — обґрунтування без позначки`); });
      const peaceful=(n.missions||[]).length+(n.keys||[]).length;
      if(n.id!=='sage'&&peaceful<2) errors.push(`Правило 4: ${n.name}: мирних ролей ${peaceful} (<2)`);
    }
  }
  // web rules
  if(!n.web) errors.push(`Правило 1: ${n.name}: немає запису мережі`);
  else{
    const needs=n.web.needs.flatMap(x=>x[0]).filter(i=>i!==n.id), gives=n.web.gives.flatMap(x=>x[0]).filter(i=>i!==n.id);
    if(!needs.length) errors.push(`Правило 1: ${n.name}: немає потреби з іншої навички`);
    if(!gives.length) errors.push(`Правило 1: ${n.name}: немає внеску в іншу навичку`);
    [...needs,...gives].forEach(i=>{ if(!ids.has(i)&&!SYS_OK.has(i)) errors.push(`${n.name}: мережа посилається на невідоме «${i}»`); });
    n.web.needs.forEach(([fs])=>fs.forEach(f=>{ if(ids.has(f)&&f!==n.id&&!E.some(e=>e[0]===f&&e[1]===n.id)) errors.push(`${n.name}: потреба з «${f}» без ребра`); }));
    n.web.gives.forEach(([ts])=>ts.forEach(t=>{ if(ids.has(t)&&t!==n.id&&!E.some(e=>e[0]===n.id&&e[1]===t)) errors.push(`${n.name}: внесок у «${t}» без ребра`); }));
  }
  if(!n.peak||!n.peak.cape) errors.push(`Правило 2: ${n.name}: немає Знака майстра`);
  else{
    if(!(n.peak.helps||[]).some(h=>h!==n.id)) errors.push(`Правило 2: ${n.name}: пік не допомагає іншим`);
    if(n.pool&&n.pool.length&&(!n.peak.pool95||n.pool[3]!==n.peak.pool95)) errors.push(`Правило 2: ${n.name}: пул 95% не збігається з піком`);
  }
  if((n.poles||[]).length<2&&!['vit','eva'].includes(n.id)) errors.push(`${n.name}: полюсів ${(n.poles||[]).length}`);
  (n.m||[]).forEach(x=>(x.ing||[]).forEach(([i])=>{ if(!ITEMS[i]) errors.push(`${n.name}: інгредієнт ${i} відсутній`); }));
}
// missions
MISSIONS.forEach(m=>{ if(!['канон','лорно'].includes(m.basis)) errors.push(`Правило 5: місія «${m.name}» без позначки`);
  m.stages.forEach(([sk])=>sk.forEach(i=>{ if(!ids.has(i)&&!['combat','item'].includes(i)) errors.push(`Місія «${m.name}»: невідома навичка ${i}`); }));
  if(m.rk==='Село'&&!m.res) errors.push(`Місія села «${m.name}» без ресурсу`); });
const skillNames=new Set(N.map(n=>n.name));
REGIONS.forEach(r=>{ const mm=r[5].match(/досвіду ([^;,.]+?)$/); if(mm){ const nm=mm[1]; const ok=[...skillNames].some(s=>nm.startsWith(s.slice(0,5))); if(!ok) warns.push('Регіон '+r[0]+': навичка місця «'+nm+'»'); } });
SENSEI.forEach(r=>{ if(!/^Канон|^Лорно/.test(r[6])) errors.push('Сенсей без позначки: '+r[0]); });
// graph
E.forEach(e=>{ if(!ids.has(e[0])||!ids.has(e[1])) errors.push('Ребро до невідомого: '+e[0]+'>'+e[1]); });
N.filter(n=>n.g!=='sys').forEach(n=>{ if(!E.some(e=>e[0]===n.id)||!E.some(e=>e[1]===n.id)) errors.push('Без зв\'язків: '+n.name); });
Object.keys(ITEMS).forEach(k=>{ const used=N.some(n=>(n.m||[]).some(x=>(x.ing||[]).some(([i])=>i===k))); if(!used) warns.push('Предмет ніде не використовується: '+ITEMS[k][0]); });
// leftovers of v2 works
const dataTxt=JSON.stringify({N,E,MECH:w.eval('MECH')})+w.document.body.textContent;
const bad=dataTxt.match(/[Рр]обот[аиуіо]|[Рр]обіт\b|Робоча техніка/g);
if(bad) errors.push('Залишки «робіт»: '+[...new Set(bad)].join(', '));
[['Чідорі (Райтон 40)','стара вимога Чідорі'],['Ранг технік: до C','старе правило рангів'],['Контроль чакри 30 + лінія','стара вимога клонів']].forEach(([s,why])=>{ if(html.includes(s)) errors.push('Залишок: '+why); });
console.log(JSON.stringify({errors,warns,counts:{nodes:N.length,edges:E.length,masteries:N.reduce((a,n)=>a+(n.m||[]).length,0),missions:MISSIONS.length,reqs:N.reduce((a,n)=>a+(n.m||[]).filter(x=>x.rqb).length,0),regions:REGIONS.length,sensei:SENSEI.length}},null,1));
