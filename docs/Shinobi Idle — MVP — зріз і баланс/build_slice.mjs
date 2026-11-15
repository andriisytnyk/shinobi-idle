// Збирає дані зрізу MVP: заморожені джерела + patch.mjs → slice.json, і перевіряє замкненість → audit.md
// Запуск: node build_slice.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as P from "./patch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..", "Shinobi Idle — дані й скрипти", "concept", "map_data_v3.json");
const D = JSON.parse(fs.readFileSync(src, "utf8"));
const by = Object.fromEntries(D.N.map(n => [n.id, n]));
const TECH_SK = ["tai","nin",...P.NATURES];
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const BAND = { E:[1,30], D:[1,30], C:[30,50], B:[50,70], A:[70,90], S:[90,99] };

// ---------- техніки ----------
const techniques = [];
for (const sk of TECH_SK) {
  for (const x of by[sk].m.filter(x => x.l <= P.CAP || P.TECH.change[x.n])) {
    if (P.TECH.hide.includes(x.n)) continue;
    const ch = P.TECH.change[x.n] || {};
    const t = { skill:sk, level:ch.l ?? x.l, uk:x.n, en:x.en, rank:ch.rk ?? x.rk, rankCanon:ch.rkc ?? !!x.rkc, role:x.role, tags:x.tags||[], state:ch.st ?? (x.state||""),
      src:ch.src ?? x.src, home:ch.home ?? x.home, home2:ch.home2||"", req:ch.d ?? x.d ?? "", note:x.g||"", patched:ch.why||"" };
    if (t.level <= P.CAP) techniques.push(t);
  }
}
for (const [skill,level,uk,en,rank,canon,role,tags,state,srcc,home,note] of P.TECH.add)
  techniques.push({ skill, level, uk, en, rank, rankCanon:canon, role, tags, state, src:srcc, home, home2:"", req:"", note, patched:"Додано в зріз" });
for (const t of techniques) {
  t.id = "core:" + slug(t.en.replace(/^(Fire|Wind|Lightning|Earth|Water) Release: /,"").replace(/ Technique$/,""));
  t.sealSeq = P.SEAL_SEQ[t.uk] ?? (t.role === "Тренування" ? [P.DRILL_SEAL[t.skill]] : []);
  t.seals = t.sealSeq.length;
  t.sealsCanon = !P.SEAL_INVENTED.includes(t.uk) && t.role !== "Тренування";
  t.tier = P.TECH.tier[t.uk] ?? 0;
  if (P.TECH.rankVerified.includes(t.uk)) t.rankCanon = true;
  t.noDamage = P.TECH.noDamage.includes(t.uk);
  if (P.TECH.cast[t.uk] !== undefined) t.castOverride = P.TECH.cast[t.uk];
}
techniques.sort((a,b) => TECH_SK.indexOf(a.skill) - TECH_SK.indexOf(b.skill) || a.level - b.level);

// ---------- інші майстерності ----------
const simple = (id) => by[id].m.filter(x => x.l <= P.CAP).map(x => ({ level:x.l, uk:x.n, req:x.d||"", note:x.g||"" }));
const exercises = simple("cc"), obstacles = simple("ath"), herbs = simple("herb");
for (const o of obstacles) if (P.OBSTACLES[o.uk]) Object.assign(o, P.OBSTACLES[o.uk]);
const idByName = Object.fromEntries(Object.entries(D.ITEMS).map(([k,v]) => [v[0],k]));
herbs.forEach(h => h.id = idByName[h.uk]);
const practices = by.med.m.filter(x => x.l <= P.CAP).map(x => {
  const p = P.PRACTICES[x.n] || {}; const rep = p.replace || {};
  return { level:x.l, uk:x.n, pair:p.sk || x.sk, insight:x.s.map(s => rep[s] || s), enlight:x.u.map(s => rep[s] || s) };
});
const recipes = [];
for (const sk of ["alch","prov"]) for (const x of by[sk].m) {
  if (P.RECIPES.hide.includes(x.n)) continue;
  const ch = P.RECIPES.change[x.n] || {};
  const r = { skill:sk, level:ch.l ?? x.l, uk:x.n, act:x.act, ing:ch.ing ?? x.ing, out:x.out, tags:x.tags||[], patched:ch.why||"" };
  if (r.level <= P.CAP) recipes.push(r);
}
recipes.sort((a,b) => a.skill.localeCompare(b.skill) || a.level - b.level);

// ---------- пули ----------
const pools = {};
for (const sk of P.SKILLS) if (by[sk].pool) {
  pools[sk] = by[sk].pool.map((txt,i) => { const pct=[10,25,50,95][i]; const rep=P.POOLS.find(p=>p[0]===sk&&p[1]===pct); return { pct, text:rep?rep[3]:txt, patched:!!rep }; });
}

const seals = Object.fromEntries(Object.entries(P.SEALS).map(([id,[uk,jp,glyph,kind]]) => [id,{ uk, jp, glyph, kind }]));
const slice = { seals, meta:{ built:new Date().toISOString().slice(0,10), cap:P.CAP, skills:P.SKILLS, wheel:P.WHEEL },
  techniques, exercises, practices, obstacles, herbs, recipes, coat:P.RECIPES.coat, pools,
  tools:P.TOOLS, misc:P.MISC, market:P.MARKET, missions:P.MISSIONS, regions:P.REGIONS, enemies:P.ENEMIES, bosses:P.BOSSES, buildings:P.BUILDINGS, gear:P.GEAR };
fs.writeFileSync(path.join(here,"slice.json"), JSON.stringify(slice,null,1));

// ================= АУДИТ =================
const out = []; let fails = 0;
const ok = (c,msg) => { if(!c){ fails++; out.push("- ❌ "+msg); } };
const h = t => out.push("\n## "+t+"\n");
const SKN = Object.fromEntries(D.N.map(n=>[n.id,n.name]));

h("1. Техніки: склад, розриви, ролі");
out.push("| Навичка | Усього | Бойових | Атак | Перша атака | Найбільший розрив | Рівні |","| --- | --- | --- | --- | --- | --- | --- |");
const DMG = ["Снаряд","Серія","Площа","Сигнатурна"];
for (const sk of TECH_SK) {
  const ts = techniques.filter(t=>t.skill===sk);
  const regular = ts.filter(t=>["N","S","Q"].includes(t.src)).map(t=>t.level);
  const lv = [...new Set(regular)].sort((a,b)=>a-b); let gap=0; for(let i=1;i<lv.length;i++) gap=Math.max(gap,lv[i]-lv[i-1]);
  const dmg = ts.filter(t=>DMG.includes(t.role)); const first = dmg.length?Math.min(...dmg.map(t=>t.level)):"—";
  out.push(`| ${SKN[sk]} | ${ts.length} | ${ts.filter(t=>t.role!=="Тренування").length} | ${dmg.length} | ${first} | ${gap} | ${[...new Set(ts.map(t=>t.level))].join(", ")} |`);
  ok(gap<=10, `${SKN[sk]}: розрив ${gap} рівнів між техніками, доступними без боса`);
  ok(dmg.length>=2, `${SKN[sk]}: менше двох атакувальних технік`);
  ok(dmg.some(t=>t.level<=35 && t.src!=="O"), `${SKN[sk]}: немає атаки до рівня 35 без боса`);
}
for (const t of techniques) {
  if (t.rankCanon && BAND[t.rank]) ok(t.level>=BAND[t.rank][0] && t.level<=BAND[t.rank][1], `${t.uk}: ранг ${t.rank} поза смугою (рівень ${t.level})`);
  t.sealSeq.forEach(s => ok(P.SEALS[s], `${t.uk}: невідома печатка ${s}`));
  ok(t.level%5===0 || t.level===1, `${t.uk}: рівень ${t.level} не кратний 5`);
}
out.push(`\nРазом технік і вправ стихій: **${techniques.length}** (бойових і службових — ${techniques.filter(t=>t.role!=="Тренування").length}, тренувальних — ${techniques.filter(t=>t.role==="Тренування").length}). Послідовності печаток: з канону — ${techniques.filter(t=>t.sealsCanon&&t.seals>0).length} технік, без печаток за каноном — ${techniques.filter(t=>t.sealsCanon&&t.seals===0).length}, не з канону — ${techniques.filter(t=>!t.sealsCanon).length} (з них вправ — ${techniques.filter(t=>t.role==="Тренування").length}).`);

h("2. Предмети: джерело і споживач");
const used = {}, made = {};
for (const r of recipes) for (const [i] of r.ing) (used[i] ||= []).push(r.uk);
for (const m of P.MISSIONS) for (const s of m.stages) if (s.t==="items") (used[s.item] ||= []).push("місія «"+m.name+"»");
const src2 = {};
herbs.forEach(x => src2[x.id] = "Травництво "+x.level);
P.MARKET.forEach(([id,b,l]) => src2[id] = (src2[id]?src2[id]+"; ":"")+"Ринок "+l+(b!=="—"?" ("+b+")":""));
for (const m of P.MISSIONS) for (const p of (m.pay||[])) if (D.ITEMS[p]) src2[p] = (src2[p]?src2[p]+"; ":"")+"плата: «"+m.name+"»";
["oil","salt","spice"].forEach(i => src2[i] += "; ящик торговця");
src2.wire = "Кузня 2"; (used.wire ||= []).push("Дротяна пастка");
src2.antidote = "Алхімія 1";
out.push("| Предмет | Джерело | Споживачі |","| --- | --- | --- |");
const ids = [...new Set([...Object.keys(src2), ...Object.keys(used)])];
for (const id of ids) {
  const name = D.ITEMS[id]?.[0] || P.TOOLS[id]?.[0] || (id==="antidote"?"Протиотрута":id);
  out.push(`| ${name} | ${src2[id]||"—"} | ${(used[id]||[]).length?[...new Set(used[id])].join(", "):"—"} |`);
  ok(src2[id], `${name}: немає джерела в зрізі`);
  ok((used[id]||[]).length>0 || id==="antidote", `${name}: немає споживача в зрізі`);
}

h("3. Риси ворогів: відповіді");
const TRAITS = { "Броня":"Пробиття","Кастер":"Переривання","Зграя":"Площа","Ухильний":"Сковування","Регенерація":"Тривала шкода","Ілюзіоніст":"Розсіювання","Прихований":"Виявлення","Отруйник":"Очищення" };
out.push("| Риса | Тег | Нестихійні техніки | Стихійні техніки | Інструменти | Без жодної природи |","| --- | --- | --- | --- | --- | --- |");
for (const [trait,tag] of Object.entries(TRAITS)) {
  const tt = techniques.filter(t=>t.tags.includes(tag));
  const free = tt.filter(t=>!P.NATURES.includes(t.skill)).map(t=>`${t.uk} (${t.level})`);
  const nat = tt.filter(t=>P.NATURES.includes(t.skill)).map(t=>`${SKN[t.skill]} ${t.level}`);
  const tools = [...Object.values(P.TOOLS).filter(x=>x[3].includes(tag)).map(x=>x[0]), ...recipes.filter(r=>r.tags.includes(tag)).map(r=>`${r.uk} (${SKN[r.skill]} ${r.level})`)];
  const anyFree = free.length+tools.length>0;
  out.push(`| ${trait} | ${tag} | ${free.join(", ")||"—"} | ${[...new Set(nat)].join(", ")||"—"} | ${tools.join(", ")||"—"} | ${anyFree?"так":"**ні**"} |`);
  ok(tt.length+tools.length>0, `${trait}: жодної відповіді в зрізі`);
  ok(P.ENEMIES.some(e=>e[4].includes(trait))||P.BOSSES.some(e=>e[4].includes(trait)), `${trait}: жоден ворог не має цієї риси`);
}
out.push("\nБроня — єдина риса без нестихійної відповіді; це прийнято (−30% шкоди, бій проходиться), перевіряється симуляцією в balance.mjs.");

h("4. Трійки природ: що відкрито");
const trios = []; for (let a=0;a<5;a++) for (let b=a+1;b<5;b++) for (let c=b+1;c<5;c++) trios.push([P.NATURES[a],P.NATURES[b],P.NATURES[c]]);
const canStage = (s,nat) => s.t==="skill" || s.t==="combat" || s.t==="items"
  || (s.t==="tech" && s.any.some(([sk])=>!P.NATURES.includes(sk)||nat.includes(sk)))
  || (s.t==="named" && [s.tech,...s.alts].some(n=>{const t=techniques.find(t=>t.uk===n); return t&&(!P.NATURES.includes(t.skill)||nat.includes(t.skill));}));
const keyNat = { brush:["katon","futon"], mist:["futon"], rubble:["doton"] };
out.push("| Трійка | D/C-місій із 12 | Місій села з 9 | Будівель рівня 6 із 6 | Клітинок-ключів із 5 |","| --- | --- | --- | --- | --- |");
for (const nat of trios) {
  const dc = P.MISSIONS.filter(m=>["D","C"].includes(m.rk)&&m.stages.every(s=>canStage(s,nat))).length;
  const vm = P.MISSIONS.filter(m=>m.rk==="V"&&m.stages.every(s=>canStage(s,nat)));
  const res = new Set(vm.map(m=>m.res));
  const b6 = P.BUILDINGS.filter(b=>b[3]&&Object.keys(b[4]).every(r=>res.has(r))).length;
  const cells = P.REGIONS.flatMap(r=>r.cells).filter(c=>keyNat[c[1]]).filter(c=>keyNat[c[1]].some(n=>nat.includes(n))).length;
  out.push(`| ${nat.map(n=>SKN[n]).join(" + ")} | ${dc} | ${vm.length} | ${b6} | ${cells} |`);
  ok(dc===12, `${nat.join("+")}: не всі D/C-місії доступні`);
  ok(b6>=3, `${nat.join("+")}: менше трьох будівель рівня 6`);
}
const none = P.MISSIONS.filter(m=>["D","C"].includes(m.rk)&&m.stages.every(s=>canStage(s,[]))).length;
out.push(`\nБез жодної стихії доступно D/C-місій: ${none} з 12. Сюжетні місії й операція не вимагають природи.`);

h("5. Мапа: ключі й сюжет");
for (const r of P.REGIONS) {
  ok(r.cells.length===12, `${r.name}: ${r.cells.length} клітинок замість 12`);
  for (const c of r.cells) ok(!(keyNat[c[1]] && /Сюжет/.test(c[2]||"")), `${r.name} / ${c[0]}: сюжетна точка за стихійним ключем`);
  out.push(`- **${r.name}** (Розвідка ${r.scout}): ключові клітинки — ${r.cells.filter(c=>c[1]).map(c=>`${c[0]} [${c[1]}]`).join("; ")}`);
}

h("6. Посилання за межі зрізу");
const OUT = ["Інфільтрац","Прикриття","Медичн","Гендзюцу","Букідзюцу","Фуїндзюцу","Призов","Ляльк","Мисливств","Сендзюцу","пасивн","лісових знахідок","Щит"];
const scan = (where,txt) => { const hit = OUT.find(w=>txt.includes(w)); ok(!hit, `${where}: «${txt}» — посилання поза зріз (${hit})`); };
for (const [sk,ps] of Object.entries(pools)) ps.filter(p=>p.pct<95).forEach(p=>scan(`Пул ${SKN[sk]} ${p.pct}%`,p.text));
practices.forEach(p=>[p.pair,...p.insight,...p.enlight].forEach(t=>scan(`Практика «${p.uk}»`,t)));
obstacles.forEach(o=>scan(`Перешкода «${o.uk}»`,o.note));
for (const m of P.MISSIONS) for (const s of m.stages) {
  if (s.t==="named") [s.tech,...s.alts].forEach(n=>ok(techniques.some(t=>t.uk===n), `Місія «${m.name}»: техніки «${n}» немає в зрізі`));
  if (s.t==="tech") s.any.forEach(([sk,min])=>ok(P.SKILLS.includes(sk)&&min<=P.CAP, `Місія «${m.name}»: вимога ${sk} ${min} поза зрізом`));
  if (s.t==="combat") ok([...P.ENEMIES,...P.BOSSES].some(e=>e[0]===s.enemy), `Місія «${m.name}»: ворога ${s.enemy} немає`);
}
for (const e of [...P.ENEMIES,...P.BOSSES]) if (e[6]) ok(techniques.some(t=>t.uk===e[6]), `Ворог «${e[1]}»: носить техніку «${e[6]}», якої немає в зрізі`);
for (const n of P.NATURES) ok([...P.ENEMIES,...P.BOSSES].some(e=>e[5]===n), `Жоден ворог не має природи ${SKN[n]}`);
out.push("Пули 95% у зрізі недосяжні й показуються як мета наступних шарів, тож їх текст не перевіряється. Модифікатори практик із чужою природою замкнені до її відкриття.");

h("Підсумок");
const counts = { "Техніки й вправи стихій":techniques.length, "Вправи Контролю чакри":exercises.length, "Практики Медитації":practices.length, "Перешкоди":obstacles.length, "Трави":herbs.length,
  "Рецепти":recipes.length, "Місії":P.MISSIONS.length, "Клітинки мапи":P.REGIONS.reduce((s,r)=>s+r.cells.length,0), "Типи ворогів":P.ENEMIES.length-1, "Боси":P.BOSSES.length, "Будівлі":P.BUILDINGS.length };
out.push(Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(" · "));
out.push(fails ? `\n**Порушень: ${fails}**` : "\n**Порушень немає.**");
fs.writeFileSync(path.join(here,"audit.md"), "# Аудит замкненості зрізу MVP\n\nЗгенеровано `build_slice.mjs` "+slice.meta.built+". Позначка ❌ — порушення правила.\n"+out.join("\n")+"\n");
console.log(out.filter(l=>l.startsWith("- ❌")).join("\n") || "no violations");
console.log(Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(" · "));
