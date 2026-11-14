// Render test + rule validation for skills_map_v2.html
const fs=require('fs'); const {JSDOM}=require('jsdom');
const file=process.argv[2];
const html=fs.readFileSync(file,'utf8');
const errors=[]; const warns=[];
const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/#skills',beforeParse(w){w.scrollTo=()=>{}; w.onerror=(m)=>errors.push('JS: '+m);}});
const w=dom.window;
w.addEventListener('error',e=>errors.push('JS error: '+e.message));
const N=w.eval('N'), E=w.eval('E'), ITEMS=w.eval('ITEMS');
// render every view for every node
try{
  for(const n of N){ w.eval(`current=${JSON.stringify(n.id)};renderCard();renderMCard();`); }
  w.eval('renderMatrix();renderItems();renderCheck();renderWorks();renderCombat();');
  for(const v of ['skills','masteries','works','combat','matrix','items','check','rules']){ w.location.hash=v; w.eval('route()'); }
}catch(e){ errors.push('Render: '+e.message); }
const byId=Object.fromEntries(N.map(n=>[n.id,n]));
const skills=N.filter(n=>n.g!=='sys'&&n.g!=='village');
const isHidden=x=>x.d&&!/^Контракт роду|^Знаки довіри/.test(x.d);
const bandOk=(rk,l)=>({D:[1,30],C:[30,50],B:[50,70],A:[70,90],S:[90,99]})[rk];
for(const n of skills){
  const m=n.m||[];
  if(['map','none','village'].includes(n.mt)) { /* no masteries */ }
  else{
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
        if(x.src&&x.src!=='N'&&!x.home) errors.push(`${n.name}: ${x.n} без домівки`); });
      const wk=(n.works||[]).length+(n.keys||[]).length;
      if(n.id!=='sage'&&wk<2) errors.push(`${n.name}: робіт+ключів ${wk} (<2)`);
      const mentor=m.filter(x=>(x.src||'N')==='N').length/m.length;
      if(!exempt&&(mentor>0.6)) warns.push(`${n.name}: від наставника ${(mentor*100).toFixed(0)}%`);
    }
  }
  if((n.poles||[]).length<2&&!['vit','eva'].includes(n.id)) errors.push(`${n.name}: полюсів ${(n.poles||[]).length}`);
  (n.works||[]).forEach(wk=>{ if(wk.lvl==null&&!/Будь-яка|Контракт|Кацую|Тренувальна|Листяний вихор|Вправа/.test(wk.tech)) errors.push(`${n.name}: робота «${wk.name}» — техніку «${wk.tech}» не знайдено`); });
  (n.m||[]).forEach(x=>(x.ing||[]).forEach(([i])=>{ if(!ITEMS[i]) errors.push(`${n.name}: інгредієнт ${i} відсутній`); }));
}
const ids=new Set(N.map(n=>n.id));
E.forEach(e=>{ if(!ids.has(e[0])||!ids.has(e[1])) errors.push('Ребро до невідомого: '+e[0]+'>'+e[1]); });
N.filter(n=>n.g!=='sys').forEach(n=>{ if(!E.some(e=>e[0]===n.id)||!E.some(e=>e[1]===n.id)) errors.push('Без зв\'язків: '+n.name); });
Object.keys(ITEMS).forEach(k=>{ const used=N.some(n=>(n.m||[]).some(x=>(x.ing||[]).some(([i])=>i===k))); if(!used) warns.push('Предмет ніде не використовується: '+ITEMS[k][0]); });
// v1 leftovers
['кварц','Лазерний цирк|raiton','фокус-навич','Жар'].forEach(s=>{});
const txt=html;
[['Чідорі (Райтон 40)','стара вимога Чідорі'],['Ранг технік: до C','старе правило рангів'],['Удар вишневого цвіту — Контроль 40','старе ребро']].forEach(([s,why])=>{ if(txt.includes(s)) errors.push('Залишок v1: '+why); });
console.log(JSON.stringify({errors,warns,counts:{nodes:N.length,edges:E.length,masteries:N.reduce((a,n)=>a+(n.m||[]).length,0),works:N.reduce((a,n)=>a+(n.works||[]).length,0)}},null,1));
