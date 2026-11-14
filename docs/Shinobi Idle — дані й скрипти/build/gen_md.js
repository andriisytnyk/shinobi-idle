// Generates markdown tables for the concept from v3_data.js (single source with the map).
const fs=require('fs'), path=require('path');
const D=require('./v3_data.js');
const {SK}=D;
const OUT=path.join(__dirname,'..','v3','snippets'); fs.mkdirSync(OUT,{recursive:true});
const nm=id=>id==='all'?'усі навички':id==='item'?'предмети з банку':id==='eyes'?'Очі':(SK[id]||id);
const tbl=(head,rows)=>['| '+head.join(' | ')+' |','| '+head.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+r.map(c=>String(c).replace(/\|/g,'/')).join(' | ')+' |')].join('\n');
const w=(f,s)=>fs.writeFileSync(path.join(OUT,f),s+'\n');

// missions
const civ=D.MISSIONS.filter(m=>m.rk!=='Село'), vil=D.MISSIONS.filter(m=>m.rk==='Село');
const st=m=>m.stages.map(s=>s[1]).join(' → ');
w('missions_civ.md',tbl(['Ранг','Місія','Замовник','Етапи','Нагорода','Плата натурою','Основа'],civ.map(m=>[m.rk,m.name,m.client,st(m),m.reward,m.kind||'—',`${m.basis==='канон'?'**Канон**':'**Лорно**'}: ${m.note}`])));
w('missions_vil.md',tbl(['Місія села','Етапи','Ресурс на склад','Основа'],vil.map(m=>[m.name,st(m),m.res,`${m.basis==='канон'?'**Канон**':'**Лорно**'}: ${m.note}`])));
// requirements
w('reqs.md',tbl(['Навичка','Техніка','Вимога','Основа'],D.REQS.map(r=>[nm(r.skill),r.tech,r.req,r.basis])));
// web
const cell=a=>a.map(([ids,t])=>{ if(ids.length===1&&!['all','tech'].includes(ids[0])&&!t.startsWith(nm(ids[0]))) return nm(ids[0])+': '+t; if(ids.length>1&&ids.every(i=>['katon','futon','raiton','doton','suiton'].includes(i))&&!/природ|стихі/.test(t)) return 'Стихії: '+t; return t; }).join('; ');
w('web.md',tbl(['Навичка','Постійно потребує','Дає іншим','Пул 95%','Знак майстра (99)'],Object.entries(D.WEB).map(([id,x])=>[`**${nm(id)}**`,cell(x.needs),cell(x.gives),D.PEAKS[id].pool95||'— (без майстерностей)',D.PEAKS[id].cape])));
// regions
w('regions.md',tbl(['Регіон','Розвідка','Доступ','Вороги','Що брати','Місце тренування','Домівки й сліди'],D.REGIONS.map(r=>r)));
// sensei
w('sensei.md',tbl(['Сенсей','Чого вчить','Де слід','Випробування','Ціна заняття','Заняття','Основа'],D.SENSEI));
// gear
w('gear.md',tbl(['Спорядження','Навички','Тири','Ефект','Ціна','Основа'],D.GEAR.map(g=>[...g.slice(0,5),g[5]||'—'])));
// earn
w('earn.md',tbl(['Джерело рьо','Що потрібно','Плюс','Мінус'],D.EARN));
w('spend.md',D.SPEND.join(', ')+'.');
console.log('snippets ok',fs.readdirSync(OUT).join(', '));
