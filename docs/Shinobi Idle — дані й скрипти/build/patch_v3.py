import re
import shutil
shutil.copy('/home/claude/work/build/build_map.js','/home/claude/work/build/build_map_v3.js')
p='/home/claude/work/build/build_map_v3.js'; s=open(p,encoding='utf8').read()
_i=s.index('// ---------- works ----------'); _j=s.index('const KEYS=[')
s=s[:_i]+"""// ---------- v3: missions, requirements, peaks, web ----------
const D3=require('./v3_data.js');
const MISSIONS=D3.MISSIONS;
for(const r of D3.REQS){ const n=byId[r.skill]; const x=(n.m||[]).find(y=>y.n===r.tech); if(!x) throw new Error('req: no '+r.skill+' '+r.tech); x.d=r.req; x.rqb=r.basis; }
N.forEach(n=>{ const ms=MISSIONS.filter(m=>m.stages.some(st=>st[0].includes(n.id))); if(ms.length) n.missions=ms.map(m=>({rk:m.rk,name:m.name,stage:m.stages.filter(st=>st[0].includes(n.id)).map(st=>st[1]).join('; '),reward:m.res?('Село: '+m.res):[m.reward,m.kind].filter(Boolean).join('; ')})); });
for(const id in D3.PEAKS){ const n=byId[id]; const p=D3.PEAKS[id]; n.peak=p; if(n.pool&&p.pool95) n.pool[3]=p.pool95; }
for(const id in D3.WEB){ byId[id].web=D3.WEB[id]; }
"""+s[_j:]
def rep(a,b):
    global s
    assert s.count(a)==1,(s.count(a),a[:100]); s=s.replace(a,b)
def rep_re(pat,b):
    global s
    s2,n=re.subn(pat,lambda m:b,s,count=1); assert n==1,pat; s=s2
def line_with(prefix,new):
    global s
    L=s.split('\n'); idx=[i for i,l in enumerate(L) if l.startswith(prefix)]; assert len(idx)==1,(prefix,len(idx)); L[idx[0]]=new; s='\n'.join(L)
def drop_lines(pred):
    global s
    L=s.split('\n'); s='\n'.join(l for l in L if not pred(l))

s=s.replace('// Builds skills_map_v2.html from the original map + v2 changes.','// Builds the v3 skills map from the original map + v2/v3 changes (v3 data: v3_data.js).')
# ---- node texts ----
rep_re(r'"Мирні роботи: Мокутон[^"]*"','"Місії: Мокутон — відбудова кварталів, Йотон — вапно, Хьотон — льодовні, Бакутон і Футтон — демонтаж, Дзітон — золотий пил"')
line_with('for(const n of N){ if(n.mt==="tech"){ n.train=','for(const n of N){ if(n.mt==="tech"){ n.train="Практика на полігоні: інтервал дорівнює часу касту, 100% досвіду в обрану техніку. Мирне застосування — етапи місій і місії села; прискорюють сенсеї, місця тренувань, Полігони й Академія, тоніки"; } }')
rep('Рівень 6: робота «Спаринг в Академії» дає більше','Рівень 6: місія «Спаринг в Академії» дає вдвічі більше Сили шинобі')
rep('Рівень 6: «Чергування» дає Репутацію вдвічі','Рівень 6: місія «Чергування в госпіталі» дає Репутацію вдвічі')
rep('Рівень 6: «Вистава» дає рьо вдвічі','Рівень 6: місія «Вистава на святі даймьо» дає рьо вдвічі')
rep('базові інструменти й мітки, підсумки медика (до −20% цін)','базові інструменти й мітки, підсумки медика, тренувальне спорядження (до −20% цін)')
line_with('V.shres=[','const RES_USE={"Охорона":"Бар\'єр, Склад, Вежа Каге; оборона під час нападів","Кладка":"Кам\'яні будівлі вищих тирів","Ділянки":"Нові місця під будівлі й угіддя","Зрошення":"Ферми, Сади, Раменна; ріст населення","Здоров\'я":"Госпіталь; ріст населення","Робоча сила":"Пришвидшення черги будівництва (заряди)","Житло":"Населення; будь-яке житло ×2"};\nV.shres=Object.keys(RES_USE).map(r=>[r,MISSIONS.filter(m=>m.res&&m.res.startsWith(r)).map(m=>m.name).join(", "),RES_USE[r]]);')
rep('"Рівні будівель 1–5 — цивільними ресурсами, 6–10 — ресурсами шинобі з робіт"','"Рівні будівель 1–5 — цивільними ресурсами, 6–10 — ресурсами шинобі з місій села"')
# ---- edges: drop v2 work edges, add v3 ones ----
drop_lines(lambda l: l.startswith('setE(') and ('","Роботи:' in l or '","Робота:' in l or '","Служба тварин:' in l))
rep('setE("cc","nin","Техніка тіньового клонування — Контроль чакри 30");','setE("cc","nin","Расенґан — Контроль чакри 50");\nsetE("med","nin","Тіньове клонування — Медитація 40; множинне й Великий вибух клонів — Медитація 60");')
rep('setE("nin","missions","Техніка мерехтіння тіла: кур\'єрські місії");\n','')
rep('// remove medal of ideas/proposals flags','''// v3: mission edges, requirement edges, web edges
{ const ids=new Set(N.map(n=>n.id));
  for(const n of N){ if(!n.missions) continue; if(n.g==='sys') continue;
    const vil=n.missions.filter(m=>m.rk==='Село'), civ=n.missions.filter(m=>m.rk!=='Село');
    if(vil.length) setE(n.id,'village','Місії села: '+vil.map(m=>m.name+' ('+m.reward.replace('Село: ','')+')').join(', '));
    if(civ.length) setE(n.id,'missions','Етапи місій: '+civ.map(m=>m.name).join(', ')); }
  const add=(a,b,t)=>{ if(!ids.has(a)||!ids.has(b)||a===b) return; const i=ix(a,b); if(i<0){E.push([a,b,t,0]);} else if(!String(E[i][2]).includes(t)){ E[i][2]=String(E[i][2])+'; '+t; } };
  for(const r of D3.REQS) for(const id of r.ids) add(id,r.skill,r.tech+' — '+r.req);
  for(const id in D3.WEB){ const w=D3.WEB[id];
    for(const [fs,t] of w.needs) for(const f of fs){ if(ids.has(f)&&f!==id&&ix(f,id)<0) E.push([f,id,t,0]); }
    for(const [ts,t] of w.gives) for(const g of ts){ if(ids.has(g)&&g!==id&&ix(id,g)<0) E.push([id,g,t,0]); } }
}
// remove medal of ideas/proposals flags''')

WMAP_JS = """
const WMAP={"Ілюзорна варта сховищ":"Місія села «Ілюзорна варта сховищ»","Боротьба з епідеміями":"Місія «Епідемія в селищі»","Будинки чотирьох стовпів":"Канон: Ямато будує будинок для ночівлі загону","Випалювання заростей":"Місія села «Розчищення ділянок»","Вирівнювання ділянок":"Місія села «Вирівнювання ділянок»","Відбудова кварталів":"Місія села «Відбудова кварталів»","Гасіння пожеж":"Місія «Пожежа на рисовому складі»","Запечатування вантажів":"Місії «Запечатаний вантаж» і «Запечатування запасів»","Заряджені дротяні загородження":"Місія села «Заряджені загородження»","Зведення стін":"Місія села «Зведення стін»","Золотий пил":"Місія «Золотий пил для Піску»","Зрошення полів (більше)":"Місія села «Зрошення полів села» (більше)","Зрошення полів (з рівня 70 — Хвилями вибухової води, більше)":"Місії «Посуха на полях» і «Зрошення полів села» (з рівня 70 — Хвилями вибухової води, більше)","Клони на будівництві":"Місія села «Клони на будівництві»","Крамниця ніндзя-інструментів":"Місія «Допомога в крамниці інструментів»","Навіювання на допитах":"Місія «Допит полоненого»","Негашене вапно":"Місія села «Негашене вапно»","Перенесення вантажів":"Місія села «Перенесення вантажів»","Розбирання завалів":"Місії «Обвал на перевалі» й «Розбір завалів після нападу»","Розгін диму, газу й піщаних бур":"Місія «Піщана буря над оазою»","Розчищення ділянок":"Місія села «Розчищення ділянок»","Різання каменю":"Місія села «Різання каменю»","Санітарне спалювання":"Місія села «Санітарна варта»","Спаринг в Академії":"Місія села «Спаринг в Академії»","Термінові доставки":"Місія «Термінова доставка»","Чергування в бар'єрній команді":"Місія села «Бар'єрна команда»","Чергування в госпіталі":"Місія села «Чергування в госпіталі»"};
N.forEach(n=>(n.m||[]).forEach(x=>{ if(x.g&&x.g.includes('Робота: ')) x.g=x.g.replace(/Робота: ([^;]+)/,(m0,w)=>{ if(!WMAP[w]) throw new Error('no work map '+w); return WMAP[w]; }); }));
"""
rep("for(const id in D3.WEB){ byId[id].web=D3.WEB[id]; }\n","for(const id in D3.WEB){ byId[id].web=D3.WEB[id]; }\n"+WMAP_JS.strip()+"\n")

# ---- MECH ----
rep('MECH.tech.name="Практика й роботи";','MECH.tech.name="Практика";')
rep('MECH.tech.analog="Бойові стилі + Лісорубство";','MECH.tech.analog="Бойові стилі";')
line_with('MECH.tech.how=','MECH.tech.how="Практика на полігоні: інтервал дорівнює часу касту, 100% досвіду в обрану техніку. Мирне застосування — етапи місій (місія дає за годину приблизно стільки ж досвіду, але розподіляє його між навичками етапів і платить рьо, натурою й ресурсами села). Техніку дає наставник (база, приблизно третина) або сувій із конкретної домівки: Бібліотека, руїни, ціль Інфільтрації, ворог-носій, легендарний сенсей, клан, призовний рід, лінія доручень, власне відкриття. Дублікат сувою стає Нотатками — досвідом Майстерності цієї техніки.";')
line_with('MECH.tech.gives=','MECH.tech.gives="Менше печаток: на 50 — на чверть, на 99 — половина (не менше однієї), тож каст до −50% видно на смузі печаток; вартість чакри до −25%, шкода до +10%; стеля скорочення касту з усіх джерел −60%. Канонічні етапи: Расенґан до 50 — лише з клоном, Расенсюрікен до 50 — лише в руці й з Раною, Чідорі до 50 — тунельний зір. На 99 — печатки однією рукою й постійний бонус до пулу.";')
s=s.replace('MECH.puppet.skills="Ляльководство (бойова навичка)";','MECH.puppet.skills="Ляльководство (бойова навичка)";\nfor(const k in MECH){ for(const f of ["how","gives","name"]) if(MECH[k][f]) MECH[k][f]=String(MECH[k][f]).replace(/; робота з лялькою/g,"; ляльки витрачають отрути Алхімії").replace(/служба тварин як робота/g,"служба тварин — бонуси поза боєм і етапи місій"); }')
# ---- render: mastery card sections ----
i=s.index("render=rep(render,'    if(n.finds){','    if(n.works){"); j=s.index('\n',i)
s=s[:i]+r"""render=rep(render,'    if(n.finds){','    if(n.missions){body+=`<div class="sec"><h4>Місії (${n.missions.length})</h4>${table(["Ранг","Місія","Етап цієї навички","Нагорода"],n.missions.map(m=>`<tr><td class="lv">${esc(m.rk)}</td><td class="nm">${esc(m.name)}</td><td>${esc(m.stage)}</td><td>${esc(m.reward)}</td></tr>`))}</div>`;}\n    if(n.keys){body+=`<div class="sec"><h4>Ключі (${n.keys.length})</h4>${table(["Техніка","Що відкриває"],n.keys.map(k=>`<tr><td class="nm">${esc(k.tech)}</td><td>${esc(k.what)}</td></tr>`))}</div>`;}\n    if(n.roles){body+=`<div class="sec"><h4>Роди: ролі без повторів</h4>${table(["Рід","Бій і служба"],n.roles.map(r=>`<tr><td class="nm">${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`))}</div>`;}\n    if(n.finds){');"""+s[j:]
# tech table: requirement basis under requirement
rep('<td>${x.d?esc(x.d):"—"}</td><td>${x.g?esc(x.g):"—"}${flag(x.p)}</td></tr>`));\');','<td>${x.d?esc(x.d)+sub(x.rqb||""):"—"}</td><td>${x.g?esc(x.g):"—"}${flag(x.p)}</td></tr>`));\');')
# village card text
rep('Рівні 1–5 будуються цивільними ресурсами, 6–10 — ще й ресурсами шинобі з робіт технік.','Рівні 1–5 будуються цивільними ресурсами, 6–10 — ще й ресурсами шинобі з місій села.')
rep('table(["Ресурс","Звідки (роботи)","На що йде"]','table(["Ресурс","Звідки (місії села)","На що йде"]')
# skill card: missions + web + peak
i=s.index("render=rep(render,'   <div class=\"sec\"><h4>Що дає іншим (${outE(n.id).length})</h4>'"); j=s.index('\n',i)
s=s[:i]+r"""render=rep(render,'   <div class="sec"><h4>Що дає іншим (${outE(n.id).length})</h4>','   ${n.web?`<div class="sec"><h4>Мережа потреб</h4><div class="web2"><div><b>Постійно потребує</b><ul>${n.web.needs.map(x=>`<li>${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(x[1])}</li>`).join("")}</ul></div><div><b>Дає іншим</b><ul>${n.web.gives.map(x=>`<li>${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(x[1])}</li>`).join("")}</ul></div></div>${n.peak?`<p class="note"><b>Пік.</b> ${n.peak.pool95?`Пул 95%: ${esc(n.peak.pool95)}. `:""}Знак майстра (99): ${esc(n.peak.cape)}.</p>`:""}</div>`:""}\n   ${n.missions?`<div class="sec"><h4>Місії</h4><ul>${n.missions.map(m=>`<li><b>${esc(m.name)}</b> (${esc(m.rk)}) — ${esc(m.stage)}</li>`).join("")}</ul></div>`:""}\n   <div class="sec"><h4>Що дає іншим (${outE(n.id).length})</h4>');"""+s[j:]
# check view
rep('<th>Роботи / ключі</th><th>Полюси</th>','<th>Місії / ключі</th><th>Потреби / внески</th><th>Полюси</th>')
rep('<td class="n">${(n.works||[]).length} / ${(n.keys||[]).length}</td>','<td class="n">${(n.missions||[]).length} / ${(n.keys||[]).length}</td><td class="n">${n.web?n.web.needs.length+" / "+n.web.gives.length:"—"}</td>')
# stats
rep('[String(N.reduce((a,n)=>a+(n.works||[]).length,0)),"робіт"]','[String(MISSIONS.length),"місій"],[String(N.reduce((a,n)=>a+(n.m||[]).filter(x=>x.rqb).length,0)),"вимог технік"]')
# routes
rep('views=["skills","masteries","works","combat","matrix","items","check","rules"]','views=["skills","masteries","missions","web","world","combat","matrix","items","check","rules"]')
# replace renderWorks with renderMissions + renderWeb + renderWorld
i=s.index('function renderWorks(){'); j=s.index('function renderCombat(){')
FN=r"""function renderMissions(){
  const st=m=>m.stages.map(x=>`${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(x[1])}`).join("<br>");
  const civ=MISSIONS.filter(m=>m.rk!=="Село"), vil=MISSIONS.filter(m=>m.rk==="Село");
  const V=byId.village;
  document.getElementById("wk").innerHTML=`<div class="sec"><h4>Мирні місії (${civ.length})</h4>${table(["Ранг","Місія","Замовник","Етапи","Нагорода","Плата натурою","Основа"],civ.map(m=>`<tr><td class="lv">${m.rk}</td><td class="nm">${esc(m.name)}</td><td>${esc(m.client)}</td><td>${st(m)}</td><td>${esc(m.reward)}</td><td>${esc(m.kind||"—")}</td><td>${esc(m.basis)}${sub(m.note)}</td></tr>`))}</div>
   <div class="sec"><h4>Місії села (${vil.length})</h4>${table(["Місія","Етапи","Ресурс на склад","Основа"],vil.map(m=>`<tr><td class="nm">${esc(m.name)}</td><td>${st(m)}</td><td>${esc(m.res)}</td><td>${esc(m.basis)}${sub(m.note)}</td></tr>`))}</div>
   <div class="sec"><h4>Ресурси шинобі на складі села</h4>${table(["Ресурс","Звідки (місії села)","На що йде"],V.shres.map(t=>`<tr><td class="nm">${esc(t[0])}</td><td>${esc(t[1])}</td><td>${esc(t[2])}</td></tr>`))}</div>
   <div class="sec"><h4>Ключі</h4>${table(["Навичка","Техніка","Що відкриває"],N.flatMap(n=>(n.keys||[]).map(k=>`<tr><td>${chip(n.id)}</td><td class="nm">${esc(k.tech)}</td><td>${esc(k.what)}</td></tr>`)))}</div>`;
  wire(document.getElementById("wk"));
}
function renderWeb(){
  const el=document.getElementById("wb");
  const sk=N.filter(n=>n.web);
  const li=a=>a.map(x=>`<li>${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(x[1])}</li>`).join("");
  const reqs=[];N.forEach(n=>(n.m||[]).forEach(x=>{ if(x.rqb) reqs.push([n,x]); }));
  el.innerHTML=`<div class="sec"><h4>Хто кому що дає (${sk.length} навичок)</h4>${table(["Навичка","Постійно потребує","Дає іншим","Пул 95%","Знак майстра (99)"],sk.map(n=>`<tr><td>${chip(n.id)}</td><td><ul class="tight">${li(n.web.needs)}</ul></td><td><ul class="tight">${li(n.web.gives)}</ul></td><td>${esc(n.peak&&n.peak.pool95||"—")}</td><td>${esc(n.peak?n.peak.cape:"—")}</td></tr>`))}</div>
   <div class="sec"><h4>Вимоги великих технік (${reqs.length})</h4>${table(["Навичка","Техніка","Ранг","Вимога","Основа"],reqs.map(([n,x])=>`<tr><td>${chip(n.id)}</td><td class="nm">${esc(x.n)}</td><td>${x.rk?RKB(x):"—"}</td><td>${esc(x.d)}</td><td>${esc(x.rqb)}</td></tr>`))}</div>`;
  wire(el);
}
function renderWorld(){
  const el=document.getElementById("wd");
  el.innerHTML=`<div class="sec"><h4>Регіони: природи ворогів, відповіді, місця тренувань</h4>${table(["Регіон","Розвідка","Доступ","Вороги","Що брати","Місце тренування","Домівки й сліди"],REGIONS.map(r=>`<tr><td class="nm">${esc(r[0])}</td><td class="lv">${r[1]}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td>${esc(r[5])}</td><td>${esc(r[6])}</td></tr>`))}<p class="note">Колесо: Катон &gt; Футон &gt; Райтон &gt; Дотон &gt; Суйтон &gt; Катон. Місце тренування — активна точка: поки персонаж там, навичка качається на 10% швидше.</p></div>
   <div class="sec"><h4>Легендарні сенсеї: ціна заняття</h4>${table(["Сенсей","Чого вчить","Де слід","Випробування","Ціна заняття","Заняття","Основа"],SENSEI.map(r=>`<tr><td class="nm">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td><td>${esc(r[5])}</td><td>${esc(r[6])}</td></tr>`))}</div>
   <div class="sec"><h4>Тренувальне спорядження</h4>${table(["Спорядження","Навички","Тири","Ефект","Ціна"],GEAR.map(r=>`<tr><td class="nm">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${esc(r[4])}</td></tr>`))}</div>
   <div class="sec"><h4>Рьо: звідки й куди</h4>${table(["Джерело","Що потрібно","Плюс","Мінус"],EARN.map(r=>`<tr><td class="nm">${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`))}<p class="note">Куди йдуть рьо: ${esc(SPEND.join(", "))}.</p></div>`;
  wire(el);
}
"""
s=s[:i]+FN.replace('`','\\`').replace('${','\\${')+s[j:]
rep('renderWorks(); renderCombat(); route();','renderMissions(); renderWeb(); renderWorld(); renderCombat(); route();')
# data constants
rep('const TOOLS=${J(TOOLS)};\\n','const TOOLS=${J(TOOLS)};\\nconst MISSIONS=${J(MISSIONS)};\\nconst REGIONS=${J(D3.REGIONS)};\\nconst SENSEI=${J(D3.SENSEI)};\\nconst GEAR=${J(D3.GEAR)};\\nconst EARN=${J(D3.EARN)};\\nconst SPEND=${J(D3.SPEND)};\\n')
rep("fs.writeFileSync(path.join(path.dirname(OUT),'map_data.json'),J({N,E,ITEMS,WORKS:WORKS.length}));","fs.writeFileSync(path.join(path.dirname(OUT),'map_data_v3.json'),J({N,E,ITEMS,MISSIONS:MISSIONS.length}));")
# ---- head patches ----
rep(".poles{margin:6px 0 10px;font-size:13px;color:var(--muted)}",".poles{margin:6px 0 10px;font-size:13px;color:var(--muted)}.web2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.web2 ul,ul.tight{margin:4px 0 0;padding-left:16px}ul.tight li{margin:2px 0}@media(max-width:700px){.web2{grid-template-columns:1fr}}")
i=s.index("out=out.replace(/<p class=\"sub\">"); j=s.index('\n',i)
s=s[:i]+"""out=out.replace(/<p class="sub">[\\s\\S]*?<\\/p>/,'<p class="sub">Shinobi Idle, версія 3: навички персонажа, приховані навички, Село й ключові системи. «Навички» — як відкривається, як качається, що постійно потребує й дає, пік і полюси. «Майстерності» — техніки з рангом, роллю, відповідями, вимогами й домівкою; рецепти, практики, ляльки, тварини. «Місії» — мирне застосування технік і місії села. «Мережа» — хто кому що дає, пул 95% і Знак майстра, вимоги великих технік. «Світ» — регіони з природами ворогів, сенсеї з ціною, спорядження, рьо. «Бій» — риси ворогів, відповіді, набір і підсумок. Карта — обов\\'язкове джерело разом із концептом.</p>');"""+s[j:]
rep("""r2('<a href="#masteries" data-view="masteries">Майстерності</a>','<a href="#masteries" data-view="masteries">Майстерності</a>\\n  <a href="#works" data-view="works">Роботи</a>\\n  <a href="#combat" data-view="combat">Бій</a>');""","""r2('<a href="#masteries" data-view="masteries">Майстерності</a>','<a href="#masteries" data-view="masteries">Майстерності</a>\\n  <a href="#missions" data-view="missions">Місії</a>\\n  <a href="#web" data-view="web">Мережа</a>\\n  <a href="#world" data-view="world">Світ</a>\\n  <a href="#combat" data-view="combat">Бій</a>');""")
i=s.index("""r2('<section class="view" id="v-matrix">','<section class="view" id="v-works">"""); j=s.index('\n',i)
s=s[:i]+"""r2('<section class="view" id="v-matrix">','<section class="view" id="v-missions"><div class="doc"><h2>Місії й ключі</h2><p>Мирне застосування технік живе на дошці місій, як і в каноні. Етап перевіряє навичку, природу чи роль (гра бере найкращу підхожу техніку, а її Майстерність підвищує шанс і скорочує етап), бій або предмети з банку. Бідні замовники платять натурою. Місії села виставляє саме село, коли будівлі бракує ресурсу шинобі. «Канон» — показано в першоджерелі; «лорно» — природно випливає з того, як канон описує техніку.</p></div><div id="wk"></div></section>\\n<section class="view" id="v-web"><div class="doc"><h2>Мережа потреб</h2><p>Кожна навичка постійно чогось потребує від інших і щось дає іншим; пул 95% і Знак майстра прискорюють інші навички; великі техніки мають канонічні вимоги з інших навичок. Так одна мета веде гравця через кілька навичок, як у Melvor.</p></div><div id="wb"></div></section>\\n<section class="view" id="v-world"><div class="doc"><h2>Світ і прискорення</h2><p>Регіони з канонічними природами ворогів і місцями тренувань, легендарні сенсеї з ціною заняття, тренувальне спорядження й джерела рьо.</p></div><div id="wd"></div></section>\\n<section class="view" id="v-combat"><div class="doc"><h2>Бій: риси, відповіді, набір, підсумок</h2><p>Бій автоматичний. Гравець визначає бойовий набір (автонабір за замовчуванням) і підсумок інструментів; ШІ застосовує відповіді на відомі риси ворога. Аналіз бою до і звіт після роблять глибину видимою.</p></div><div id="cb"></div></section>\\n<section class="view" id="v-matrix">');"""+s[j:]
rep("<p>Кожна навичка, крім Живучості й Ухилення, працює щонайменше на два полюси: Сила, Село, Світ. Кожна навичка технік, крім Сендзюцу, має щонайменше дві роботи або ключі. Окремій техніці мирна роль не обов'язкова.</p>","<p>Кожна навичка, крім Живучості й Ухилення, працює щонайменше на два полюси: Сила, Село, Світ. Кожна навичка технік, крім Сендзюцу, має щонайменше дві мирні ролі — етапи місій або ключі. Окремій техніці мирна роль не обов'язкова.</p>\\n    <h3>Мережа потреб</h3>\\n    <p>Кожна навичка має постійну потребу з іншої навички чи системи і внесок в іншу. Пул 95% і Знак майстра кожної навички допомагають іншим. Кожна техніка рангу A і S має вимогу поза своєю навичкою (крім Медичного ніндзюцу, Сендзюцу й Злиття природ із вхідною вимогою). Кожна вимога, ціна й місія має позначку «канон» або «лорно».</p>")
rep("<li><b>Робота:</b> робота навички A дає ресурс шинобі для Села.</li>","<li><b>Місія:</b> техніка навички A працює на етапі місії; місії села дають ресурс шинобі для Села.</li>")

# hidden masteries vs requirements of big techniques
rep("render=rep(render,'renderLists(); renderCard();","render=rep(render,'const isHidden=x=>x.d&&!/^Контракт роду|^Знаки довіри/.test(x.d);','const isHidden=x=>x.d&&!/^Контракт роду|^Знаки довіри/.test(x.d)&&(!x.rqb||/лінія доручень|сувій|Ранг|Шарінґан|меч|клинки/.test(x.d));');\nrender=rep(render,'renderLists(); renderCard();")
rep("<li><b>Місія:</b>","<li><b>Вимога великої техніки:</b> рівень навички A потрібен для техніки рангу A чи S у навичці B (канонічне обґрунтування — у таблиці технік).</li>\\n      <li><b>Місія:</b>")


rep("const fix=[","const fix=[[\"Дві приховані майстерності ніколи не стоять поруч, а між звичайними майстерностями — не більше 10 рівнів.\",\"Дві приховані майстерності ніколи не стоять поруч, а між звичайними майстерностями — не більше 10 рівнів. Вимоги великих технік — інший випадок: техніка стоїть на своєму рівні й відкривається, щойно виконано вимогу з іншої навички; це двигун мережі потреб, тож такі техніки рахуються як звичайні. Прихованими лишаються ті, що потребують лінії доручень, сувою, рангу, очей чи предмета.\"],")


# web text without duplicated skill-name prefix; title
s=s.replace('${n.web.needs.map(x=>`<li>${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(x[1])}</li>`).join("")}','${n.web.needs.map(x=>`<li>${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(webTxt(x))}</li>`).join("")}')
s=s.replace('${n.web.gives.map(x=>`<li>${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(x[1])}</li>`).join("")}','${n.web.gives.map(x=>`<li>${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} ${esc(webTxt(x))}</li>`).join("")}')
s=s.replace('const li=a=>a.map(x=>\\`<li>\\${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} \\${esc(x[1])}</li>\\`).join("");','const li=a=>a.map(x=>\\`<li>\\${x[0].filter(i=>byId[i]).map(i=>chip(i)).join(" ")} \\${esc(webTxt(x))}</li>\\`).join("");')
rep("render=rep(render,'const srcTag=c=>','const RKB=","render=rep(render,'const srcTag=c=>','const webTxt=x=>{const t=x[1];const k=t.indexOf(\": \");if(k>0&&k<70){const pre=t.slice(0,k);if(x[0].some(i=>byId[i]&&pre.includes(byId[i].name.slice(0,5))))return t.slice(k+2);}return t;};\\nconst RKB=")
rep("r2('</style>',","out=out.replace('<title>Карта навичок</title>','<title>Shinobi Idle — карта навичок v3</title>').replace('<h1>Карта навичок</h1>','<h1>Shinobi Idle — карта навичок v3</h1>');\nr2('</style>',")


# review fixes: regions in scout node, village tiers, legendary S wording
rep('V.tiers=[','byId.scout.regions=byId.scout.regions.map(r=>r[0]==="Землі звірів"?[r[0],"—",r[2],r[3]]:r[0]==="Ліси Країни Вогню"?[r[0],r[1],r[2],"Рідна країна (якщо село гравця — Листя). Ліс смерті — полігон №44 біля села (активна точка: Травництво)"]:r[0]==="Південні рівнини Вогню"?[r[0],r[1],r[2],"Храм Вогню (активна точка: Катон)"]:r);\nV.tiers=[')
rep('"+ рідкісні: житло з Мокутону, чакровий метал, посилені бар\'єрні мітки, реліквії"','"+ рідкісні: чакровий метал, посилені бар\'єрні мітки, реліквії; житло з Мокутону прискорює, але не обов\'язкове"')
s=s.replace("легендарні S — лише Саннін.","легендарні S (з вимогою «Ранг Саннін») — лише Саннін.")
s=s.replace("Чунін — до 70; легендарні S — Саннін","Чунін — до 70; легендарні S (з вимогою «Ранг Саннін») — Саннін")

# leftover fix list entry
rep('"Мирні ролі: роботи (доставки, запечатування вантажів, бар\'єрна команда, клони на будівництві) і ключі (Інфільтрація, сенсорний пошук, Бінґо-книга, банк)"','"Мирні ролі: місії (доставки, запечатаний вантаж, бар\'єрна команда, клони на будівництві, запечатування запасів) і ключі (Інфільтрація, сенсорний пошук, Бінґо-книга, банк)"')
open(p,'w',encoding='utf8').write(s)
print('patched')
