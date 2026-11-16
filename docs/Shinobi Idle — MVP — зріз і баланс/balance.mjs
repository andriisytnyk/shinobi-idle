// Модель балансу зрізу MVP: формули → balance.json і balance_tables.md, плюс перевірка темпу й симуляція бою.
// Запуск: node balance.mjs   (після build_slice.mjs)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const SL = JSON.parse(fs.readFileSync(path.join(here,"slice.json"),"utf8"));
const NAT = ["katon","futon","raiton","doton","suiton"];
const NAME = { tai:"Тайдзюцу",nin:"Ніндзюцу",katon:"Катон",futon:"Футон",raiton:"Райтон",doton:"Дотон",suiton:"Суйтон",cc:"Контроль чакри",med:"Медитація",ath:"Атлетика",herb:"Травництво",scout:"Розвідка",prov:"Провіант",alch:"Алхімія",vit:"Живучість" };

// ======================= ПАРАМЕТРИ (усе, що крутиться під час підгонки) =======================
export const K = {
  cap: 50,
  // --- досвід ---
  rateBase: 4800, rateGrowth: 1.08,          // номінальний досвід за годину дії, відкритої на рівні a: rateBase × rateGrowth^a
  nativeXp: 1.25, craftXpMult: 4,            // рідна природа; ремесла (бо їх обмежують трави)
  masteryPerHour: 10500,                     // досвід Майстерності за годину дії (стала)
  poolShare: 0.25, poolCapPerItem: 1500,     // частка в пул; місткість пулу на одну майстерність зрізу
  // --- інтервали дій, с ---
  practiceFocus: { base:0.8, perLevel:0.06 }, practiceCast: 0.7, practiceMin: 2.0, drill: 3.0, meditate: 3.0, obstacle: 2.5, gather: 2.5, craft: 2.5, explore: 5.0,
  // --- техніки ---
  // Каст — число самої техніки й не залежить від печаток (рішення автора 15.11): базовий каст рангу × множник ролі, для окремих технік — вручну (patch.mjs, TECH.cast).
  castByRank: { E:1.118, D:1.341, C:1.121, B:2.588, A:2.07, S:3.105 },
  castByRole: { "Снаряд":1.0, "Серія":1.25, "Площа":1.2, "Контроль":0.9, "Захист":1.0, "Посилення":0.7, "Сигнатурна":1.5, "Тренування":1.0 },
  masteryCast: 0.5, castFloor: 0.4, nonNativeCast: 0.30,
  power: { E:10, D:10, C:17, B:27, A:42, S:65 },
  tierMult: { "-1":0.88, "0":1, "1":1.12 },
  role: { // множник шкоди, перезарядка (с), множник вартості
    "Снаряд":{m:1.0,cd:4.91,c:1.0}, "Серія":{m:1.15,cd:8.79,c:1.1}, "Площа":{m:0.75,cd:22.74,c:1.2}, "Контроль":{m:0.30,cd:10.68,c:0.9},
    "Захист":{m:0,cd:15.26,c:0.9}, "Посилення":{m:0,cd:31.8,c:1.0}, "Сигнатурна":{m:1.7,cd:19.07,c:1.3}, "Тренування":{m:0,cd:0,c:0} },
  rankCd: { E:0.9, D:1.0, C:1.1, B:1.25, A:1.4, S:1.6 },
  chakraCost: { E:5, D:6, C:12, B:22, A:38, S:60 }, staminaCost: { E:5, D:6, C:10, B:16, A:26, S:40 },
  levelScale: 0.035,                         // шкода техніки × (1 + levelScale × рівень навички)
  masteryDmg: 0.10, masteryCost: 0.25,
  // --- стани ---
  burn: { share:0.30, dur:6 }, wet: { slow:0.15, dur:8 }, evaLevel: { k:0.04, min:0.4, max:1.3 }, rhythm: { slow:0.6, dur:5 }, stun: { C:1.0, B:1.5, D:0.7 }, bind: { dur:4 }, poison: { pctPerSec:0.02, dur:8 },
  combo: { base:0.15, perLevel:0.004, perMastery:0.001, cap:0.60, fanBurn:1.5, shockWet:2.0, mudEva:0.5, steam:0.40 },
  wheel: 0.30, habituation: 0.15, habituationCap: 0.60, signatureHabituation: 0.5,
  // --- гравець ---
  hpBase: 90, hpPerVit: 8, chakraBase: 120, chakraPerMed: 0.005, chakraRegen: [0.6,0.02], staminaBase: 100, staminaPerAth: 0.01, staminaRegen: [1.0,0.02],
  accBase: 40, accPerLevel: 5, evaBase: 58.2, hitMin: 0.05, hitMax: 0.95,
  // Ухилення — один автоматичний кидок (правки зрізу, розд. 5, рядки 11–13). Рейтинг ухилення = evaBase + внесок рангу + захисні техніки + спорядження й бонуси + знання з Бінґо-книги; навички «Ухилення» немає.
  // rating: внесок одного рангу гравця (тіру ШІ) в точність і ухилення, і рейтинг за рівень знань про ворога. Числа тимчасові до підгонки (етап 4 завдання C1): evaTier підібрано так, щоб типовий персонаж ухилявся приблизно як раніше.
  rating: { accTier:21.9, evaTier:6.1, knowledge:32.3, enemyAccTier:13.1, enemyEvaTier:0 },
  // passiveFx: захисна техніка пасивна; вивчена, дає частку base свого внеску evasion, а до повного внеску росте з Майстерністю від 1 до стелі. Числа тимчасові до підгонки (етап 4).
  passiveFx: { shield:{ evasion:92.2, base:0.25 }, decoy:{ evasion:92.2, base:0.25 }, evasionBuff:{ evasion:92.2, base:0.25 }, passiveNegate:{ evasion:92.2, base:0.25 } },
  // Звичайний удар — дія зі своїм кастом і малою вартістю витривалості; «переводить подих», коли не вистачає ні на техніку, ні на удар: rest.s секунд і частка rest.share від обох пулів.
  basicCast: 1.437, basicCost: 1.01, rest: { s:1.5, share:0.08 },
  modelWait: 0.6, // лише для спрощеного симулятора нижче: вичікування гравця між діями; має дорівнювати waitMs тіру genin з ai.json
  basicDmg: [11.44,0.644], dodgeStamina: 2, ccCostPerLevel: 0.0015,
  pillAction: 0.5, pouchStack: 4, pillAt: 0.45,   // пілюля — дія 0,5 с; у слоті підсумка до 10 штук; автовживання нижче 45% HP
  food: [[1,30],[5,40],[20,50],[30,80],[35,100],[45,120]], // рівень ремесла → HP за одну страву чи мазь (із рецептів)
  toolTag: [8,0.4],
  zoneHpRegen: 0.8, opRegen: 0.25, respawn: 3,
  wound: { stat:0.05, max:4, healMin:10, healFloorMin:2.5 },
  // --- вороги ---
  eHp: [20,9.8], eDmg: [4,0.45], eInterval: 2.6, eAcc: [118,0.1], eEva: [26.5,5.16],
  boss: { hp:3.2, dmg:1.5 }, pack: { n:3, hp:0.4, dmg:0.4 },
  trait: { armor:0.30, armorOff:6, casterEvery:12, casterCast:3, casterMult:3, evasive:1.6, regenPct:0.01, illusionEvery:10, illusionDur:6, illusionAcc:0.25,
    hidden:8, hiddenAcc:0.4, hiddenFirst:2.0, poisonChance:0.35 },
  // --- бій: досвід за годину бою в зоні рівня Z, частки від rate(Z) ---
  combatXp: { style:0.70, vit:0.35 },
  // --- місії ---
  ryoPerMin: { D:12, C:22, V:0, OP:0 }, repPerMission: { D:2, C:8, V:4 }, missionXpShare: 0.85, missionRateCap: { D:25, C:45, V:40 },
  shinobiResPerMission: 3,
  // --- економіка ---
  scroll: { 1:250, 2:400, 3:900, 4:1600, 5:3500 }, gearTier: [300,1500,5000], obstacleBase: 150,
  goods: { water:1, rice:3, salt:3, oil:4, noodles:4, meat:5, saltpeter:6, spice:8, kunai:2, shuriken:2, senbon:3, wire:6, wiretrap:20, tag:30, medpouch:2500 },
  travel: [15,30,45], bounty: { boss_wolf:400, boss_fighter:900, boss_hunter:1500, boss_twins:2000, boss_mist:2500 }, bountyRepeat: 0.2,
  rep: { stage2:120, exam:300, boss:15, questFinal:30 },
  intel: { perCellLevel:1, mail:2, track:[3,5], caravanSkip:1, bingoLevel:2, writtenTestPerIntel:0.10, writtenTestMaxIntel:5 },
  partsPerScroll: 10, partDrop: { boss:2.0, carrier:0.12, mission:0.15 },
  // --- село ---
  tickMin: 5, prod: 20, costBase: 20, costMult: [1,2.2,4.8,10.5,23,50], treasuryBase: 25, buildTicks: [1,2,3,4,5,8],
  bureauIncome: 20, storeCap: [200,200], shinobiCap: [30,10], shinobiT6: 30, towerStageMax: [3,6],
  // --- розвідка ---
  cellExplores: [24,84,156,240,360], cellLevelStep: 10,
  // --- клони ---
  clone: { pool:1.0, link:0.10 },
};

// ======================= ФОРМУЛИ =======================
export const xpAt = L => { let s=0; for (let i=1;i<L;i++) s+=Math.floor(i+300*2**(i/7)); return Math.floor(s/4); };
export const rate = a => K.rateBase * K.rateGrowth ** Math.max(1,Math.min(K.cap,a));
const round = (x,d=1) => Math.round(x*10**d)/10**d;
// хвилини зосередженої дії від рівня 1 до target, якщо дії відкриваються на рівнях levels
export function minutesTo(target, levels, mult=1) {
  const lv=[...new Set(levels)].sort((a,b)=>a-b); let t=0;
  for (let L=1;L<target;L++) { const a=Math.max(...lv.filter(x=>x<=L),1); t+=(xpAt(L+1)-xpAt(L))/(rate(a)*mult)*60; }
  return t;
}
export function tech(t, skillLevel, mastery=20, native=true) {
  const R=K.role[t.role], rk=K.power[t.rank]?t.rank:(t.level<30?"D":t.level<50?"C":"B");
  const seals=t.seals||0;
  let cast=Math.max(K.castFloor,(t.castOverride??K.castByRank[rk]*K.castByRole[t.role])*(1-K.masteryCast*mastery/99)); if(!native) cast*=1+K.nonNativeCast*Math.max(0,1-skillLevel/50);
  const dmg=(t.noDamage?0:1)*K.power[rk]*R.m*K.tierMult[t.tier]*(1+K.levelScale*skillLevel)*(1+K.masteryDmg*mastery/99);
  const tai=t.skill==="tai"; const cost=(tai?K.staminaCost[rk]:K.chakraCost[rk])*R.c*(1-K.masteryCost*mastery/99);
  return { name:t.uk, skill:t.skill, role:t.role, tags:t.tags, state:t.state, rank:rk, seals, cast:round(cast,2), cd:round(R.cd*K.rankCd[rk],1), cost:round(cost), res:tai?"stamina":"chakra", dmg:round(dmg), aoe:t.role==="Площа", hits:t.role==="Серія"?3:1 };
}
export const player = ({style,tai,nin,vit,tier=1,med,ath=25,cc=25}) => ({
  hp:K.hpBase+K.hpPerVit*vit, chakra:K.chakraBase*(1+K.chakraPerMed*med), chakraRegen:K.chakraRegen[0]+K.chakraRegen[1]*med,
  stamina:K.staminaBase*(1+K.staminaPerAth*ath), staminaRegen:K.staminaRegen[0]+K.staminaRegen[1]*ath,
  acc:K.accBase+K.accPerLevel*style, evaR:K.evaBase+K.rating.evaTier*tier+K.passiveFx.shield.evasion*(0.25+0.75*0.2), basic:K.basicDmg[0]+K.basicDmg[1]*Math.max(tai,nin), costMult:1-K.ccCostPerLevel*cc, med });
export const enemy = (cl,traits=[],nature=null,boss=false) => ({ cl, traits, nature, boss,
  hp:(K.eHp[0]+K.eHp[1]*cl)*(boss?K.boss.hp:1), dmg:(K.eDmg[0]+K.eDmg[1]*cl)*(boss?K.boss.dmg:1), interval:K.eInterval, acc:K.eAcc[0]+K.eAcc[1]*cl, evaR:K.eEva[0]+K.eEva[1]*cl });
const hit = (acc,eva) => Math.min(K.hitMax,Math.max(K.hitMin, acc>=eva ? 1-0.5*eva/acc : 0.5*acc/eva));
const combatLevel = b => (2*b.vit+b.med)/6 + 0.5*b.style;
// типовий білд гравця під бойовий рівень c
export function build(c) { const style=Math.min(50,Math.round(c*1.12)); const d=Math.min(50,Math.max(1,Math.round((c-style/2)*2))); return { style, tai:Math.max(1,style-4), nin:Math.max(1,style-6), vit:d, tier:c<10?0:c<40?1:2, med:d, ath:Math.min(50,d), cc:Math.min(50,d) }; }

// ======================= СИМУЛЯТОР БОЮ (спрощений: 1 гравець проти ворога чи зграї) =======================
function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const WHEEL=SL.meta.wheel;
const ANSWER={ "Броня":"Пробиття","Кастер":"Переривання","Зграя":"Площа","Ухильний":"Сковування","Регенерація":"Тривала шкода","Ілюзіоніст":"Розсіювання","Прихований":"Виявлення","Отруйник":"Очищення" };
export function fight(b, nature, en, opts={}) {
  const { tools=[], answers=true, seed=1, mastery=20, maxT=240, food=0 } = opts; const R=rng(seed);
  const P=player(b); const lv={ tai:b.tai, nin:b.nin, [nature]:b.style };
  // автонабір: 4 слоти, одна природа; спершу відповіді на риси, далі найсильніші атаки
  const known=SL.techniques.filter(t=>t.role!=="Тренування"&&t.role!=="Посилення"&&t.role!=="Захист"&&(t.skill===nature||t.skill==="tai"||t.skill==="nin")&&t.level<=(lv[t.skill]||0)).map(t=>tech(t,lv[t.skill],mastery));
  const needAll=en.traits.map(x=>ANSWER[x]).filter(Boolean); const need=answers?needAll:[]; const load=[];
  let pool=known; if(!answers) pool=known.filter(k=>!needAll.some(tag=>k.tags.includes(tag))&&!(en.traits.includes("Регенерація")&&k.state==="Горіння"));
  for(const tag of need){ const c=pool.filter(k=>k.tags.includes(tag)&&!load.includes(k)).sort((x,y)=>y.dmg-x.dmg)[0]; if(c&&load.length<4) load.push(c); }
  for(const k of pool.filter(k=>k.dmg>0).sort((x,y)=>y.dmg/(y.cd+y.cast)-x.dmg/(x.cd+x.cast))) if(load.length<4&&!load.includes(k)) load.push(k);
  const toolTags=answers?tools:[]; const reserve=answers&&en.traits.includes("Кастер")?load.find(k=>k.tags.includes("Переривання")):null;
  const heal=food?[...K.food].reverse().find(f=>f[0]<=food)[1]:0; let pills=food?K.pouchStack:0;
  const n=en.traits.includes("Зграя")?K.pack.n:1; const foes=[]; for(let i=0;i<n;i++) foes.push({hp:en.hp*(n>1?K.pack.hp:1), next:en.interval*(0.5+R()), burn:0, burnDps:0, wet:0, bind:0, armorOff:0, stun:0});
  let hp=P.hp, ch=P.chakra, st=P.stamina, t=0, busy=0, pending=null, cds=new Map(), uses=new Map(), basicAt=0;
  let hidden=en.traits.includes("Прихований")?K.trait.hidden:0, illusion=0, nextIllusion=K.trait.illusionEvery, poison=0, casterAt=K.trait.casterEvery, casting=0, lost=0, first=true;
  const alive=()=>foes.filter(f=>f.hp>0);
  const dealTo=(f,d,piercing)=>{ let m=1; if(en.traits.includes("Броня")&&f.armorOff<=0&&!piercing) m*=1-K.trait.armor; f.hp-=d*m; };
  const DT=0.1;
  while(t<maxT){
    t+=DT; const A=alive(); if(!A.length) return {win:true,t,hpLost:lost/P.hp,load:load.map(x=>x.name)}; if(hp<=0) return {win:false,t,hpLost:1,load:load.map(x=>x.name)};
    ch=Math.min(P.chakra,ch+P.chakraRegen*DT); st=Math.min(P.stamina,st+P.staminaRegen*DT);
    if(hidden>0) hidden-=DT; if(illusion>0) illusion-=DT; if(poison>0){ const d=P.hp*K.poison.pctPerSec*DT; hp-=d; lost+=d; poison-=DT; }
    for(const f of A){ if(f.burn>0){ f.hp-=f.burnDps*DT; f.burn-=DT; } else if(en.traits.includes("Регенерація")) f.hp=Math.min(en.hp,f.hp+en.hp*K.trait.regenPct*DT);
      if(f.wet>0)f.wet-=DT; if(f.bind>0)f.bind-=DT; if(f.armorOff>0)f.armorOff-=DT; if(f.stun>0){f.stun-=DT; continue;}
      f.next-=DT*(f.wet>0?1-K.wet.slow:1);
      if(f.next<=0){ f.next=en.interval; let eEva=P.evaR; let pHit=hit(en.acc,eEva); let d=en.dmg*(n>1?K.pack.dmg:1); if(first&&en.traits.includes("Прихований")&&hidden>0){ d*=K.trait.hiddenFirst; pHit=0.95; } first=false;
        if(R()<pHit){ hp-=d; lost+=d; if(en.traits.includes("Отруйник")&&R()<K.trait.poisonChance) poison=K.poison.dur; } else st=Math.max(0,st-K.dodgeStamina); } }
    // важка атака Кастера
    if(en.traits.includes("Кастер")){ if(casting>0){ casting-=DT; if(casting<=0){ const d=en.dmg*K.trait.casterMult; hp-=d; lost+=d; casterAt=K.trait.casterEvery; } } else { casterAt-=DT; if(casterAt<=0) casting=K.trait.casterCast; } }
    if(en.traits.includes("Ілюзіоніст")){ nextIllusion-=DT; if(nextIllusion<=0){ nextIllusion=K.trait.illusionEvery; if(R()>P.med/200) illusion=K.trait.illusionDur; } }
    for(const [k,v] of cds) cds.set(k,v-DT);
    if(!alive().length) continue;
    if(busy>0){ busy-=DT; if(busy>0) continue; }
    // завершення касту
    if(pending){ const k=pending; pending=null; const u=uses.get(k.name)||0; uses.set(k.name,u+1); const hab=1-Math.min(K.habituationCap,K.habituation*u);
      let accM=1; if(hidden>0) accM*=K.trait.hiddenAcc; if(illusion>0) accM*=K.trait.illusionAcc;
      const targets=k.aoe?alive():[alive().sort((a,b)=>a.hp-b.hp)[0]];
      for(const f of targets){ if(!f) continue; let eva=en.evaR*(en.traits.includes("Ухильний")&&f.bind<=0?K.trait.evasive:1)*(f.bind>0?0.3:1);
        const pierce=k.tags.includes("Пробиття"); if(pierce) f.armorOff=K.trait.armorOff;
        if(k.tags.includes("Сковування")) f.bind=K.bind.dur; if(k.tags.includes("Виявлення")) hidden=0;
        if(k.tags.includes("Переривання")&&casting>0){ casting=0; casterAt=K.trait.casterEvery; }
        let w=1; if(en.nature&&NAT.includes(k.skill)){ if(WHEEL[k.skill]===en.nature) w=1+K.wheel; else if(WHEEL[en.nature]===k.skill) w=1-K.wheel; }
        for(let h=0;h<k.hits;h++) if(R()<hit(P.acc*accM,eva)){ const d=k.dmg/k.hits*hab*w; dealTo(f,d,pierce);
          if(k.state==="Горіння"){ f.burn=K.burn.dur; f.burnDps=d*k.hits*K.burn.share/K.burn.dur; } if(k.state==="Мокрий") f.wet=K.wet.dur; if(k.state==="Оглушення") f.stun=K.stun[k.rank]||1; } }
      continue; }
    // вибір дії
    const ready=load.filter(k=>(cds.get(k.name)||0)<=0&&(k.res==="chakra"?ch:st)>=k.cost*P.costMult);
    const use=k=>{ pending=k; busy=k.cast+K.modelWait; cds.set(k.name,k.cd+k.cast); if(k.res==="chakra") ch-=k.cost*P.costMult; else st-=k.cost; };
    const tool=(tag)=>{ if(!toolTags.includes(tag)) return false; busy=0.5; const f=alive()[0];
      if(tag==="Переривання"){ casting=0; casterAt=K.trait.casterEvery; } if(tag==="Сковування") alive().forEach(x=>x.bind=K.bind.dur); if(tag==="Виявлення") hidden=0;
      if(tag==="Розсіювання") illusion=0; if(tag==="Очищення") poison=0; if(tag==="Тривала шкода"){ f.burn=10; f.burnDps=en.hp*0.012; }
      if(tag==="Площа") alive().forEach(x=>x.hp-=K.toolTag[0]+K.toolTag[1]*b.style); return true; };
    let done=false;
    if(pills>0&&hp<P.hp*K.pillAt){ hp=Math.min(P.hp,hp+heal); pills--; busy=K.pillAction; continue; }
    if(answers){
      if(casting>0){ const k=ready.find(k=>k.tags.includes("Переривання")&&k.cast<casting); if(k){use(k);done=true;} else done=tool("Переривання"); }
      if(!done&&illusion>0) done=tool("Розсіювання"); if(!done&&poison>0) done=tool("Очищення");
      if(!done&&hidden>0){ const k=ready.find(k=>k.tags.includes("Виявлення")); if(k){use(k);done=true;} else done=tool("Виявлення"); }
      if(!done&&en.traits.includes("Ухильний")&&alive().every(f=>f.bind<=0)){ const k=ready.find(k=>k.tags.includes("Сковування")); if(k){use(k);done=true;} else if((cds.get("tool:bind")||0)<=0&&tool("Сковування")){ cds.set("tool:bind",8); done=true; } }
      if(!done&&en.traits.includes("Регенерація")&&alive().every(f=>f.burn<=0)){ const k=ready.find(k=>k.state==="Горіння"); if(k){use(k);done=true;} else done=tool("Тривала шкода"); }
      if(!done&&en.traits.includes("Броня")&&alive().every(f=>f.armorOff<=0)){ const k=ready.find(k=>k.tags.includes("Пробиття")); if(k){use(k);done=true;} }
      if(!done&&n>1&&alive().length>1&&(cds.get("tool:aoe")||0)<=0&&!ready.some(k=>k.aoe)&&tool("Площа")){ cds.set("tool:aoe",6); done=true; }
    }
    if(done) continue;
    const best=ready.filter(k=>k.dmg>0&&!(k===reserve&&casterAt<k.cd+k.cast+0.5)).sort((x,y)=>{ const s=k=>k.dmg*(k.aoe?alive().length:1)*(1-Math.min(K.habituationCap,K.habituation*(uses.get(k.name)||0))); return s(y)-s(x); })[0];
    if(best){ use(best); continue; }
    if(t>=basicAt){ basicAt=t+K.basicCast+K.modelWait; busy=K.basicCast+K.modelWait; const f=alive().sort((a,b)=>a.hp-b.hp)[0]; let accM=1; if(hidden>0)accM*=K.trait.hiddenAcc; if(illusion>0)accM*=K.trait.illusionAcc;
      const eva=en.evaR*(en.traits.includes("Ухильний")&&f.bind<=0?K.trait.evasive:1)*(f.bind>0?0.3:1); if(R()<hit(P.acc*accM,eva)) dealTo(f,P.basic,false); }
  }
  return {win:false,t,hpLost:lost/P.hp,load:load.map(x=>x.name),timeout:true};
}
export function series(b,nature,en,opts={},N=400){ let w=0,tt=0,hl=0,load=[]; for(let i=0;i<N;i++){ const r=fight(b,nature,en,{...opts,seed:i*7919+13}); if(r.win){w++;tt+=r.t;hl+=r.hpLost;} load=r.load; } return { win:round(w/N*100,0), ttk:w?round(tt/w,0):null, hpLost:w?round(hl/w*100,0):null, load }; }

// ======================= ТАБЛИЦІ =======================
const md=[]; const H=t=>md.push("\n## "+t+"\n"); const row=(...c)=>md.push("| "+c.join(" | ")+" |"); const head=(...c)=>{row(...c);row(...c.map(()=>"---"));};
const J={ params:K };

H("1. Крива досвіду й темп");
md.push("Досвід рівня — формула Melvor. Номінальний досвід за годину для дії, відкритої на рівні *a*: `"+K.rateBase+" × "+K.rateGrowth+"^a`. Досвід за одну дію = темп × інтервал ÷ 3600.\n");
head("Рівень","Досвіду всього","Темп дії цього рівня, XP/год"); for(const L of [1,5,10,15,20,25,30,35,40,45,50]) row(L,xpAt(L).toLocaleString("uk"),Math.round(rate(L)).toLocaleString("uk"));
const levelsOf={ tai:SL.techniques.filter(t=>t.skill==="tai"&&t.src!=="O").map(t=>t.level), nin:SL.techniques.filter(t=>t.skill==="nin"&&t.src!=="O").map(t=>t.level),
  cc:SL.exercises.map(x=>x.level), med:SL.practices.map(x=>x.level), ath:[...new Set(SL.obstacles.map(x=>x.level))], herb:SL.herbs.map(x=>x.level),
  scout:[1,10,11,20,21,30,31,40,41,50], prov:SL.recipes.filter(r=>r.skill==="prov").map(r=>r.level), alch:SL.recipes.filter(r=>r.skill==="alch").map(r=>r.level) };
for(const n of NAT) levelsOf[n]=SL.techniques.filter(t=>t.skill===n&&t.src!=="O").map(t=>t.level);
md.push("\nХвилини зосередженої дії від рівня 1 (без бонусів села, спорядження, тоніків і сенсеїв; ремесла — чистий час варіння з готовими травами):\n");
head("Навичка","до 10","до 20","до 30","до 40","до 50","Примітка"); J.pace={};
for(const sk of Object.keys(levelsOf)){ const mult=sk==="prov"||sk==="alch"?K.craftXpMult:1; const v=[10,20,30,40,50].map(L=>Math.round(minutesTo(L,levelsOf[sk],mult))); J.pace[sk]=v;
  row(NAME[sk],...v, NAT.includes(sk)?`рідна природа: ${Math.round(minutesTo(50,levelsOf[sk],K.nativeXp))} хв`:(mult>1?"×"+mult+" досвіду; потребує трав":"")); }
const combatH=L=>{ let t=0; for(let l=1;l<L;l++) t+=(xpAt(l+1)-xpAt(l))/(rate(l)*K.combatXp.vit); return t; };
row("Живучість (лише бій)",...[10,20,30,40,50].map(L=>Math.round(combatH(L)*60)),"години бою в зоні свого рівня");
const total=Object.keys(levelsOf).reduce((s,k)=>s+J.pace[k][4],0); const natAvg=NAT.reduce((s,k)=>s+J.pace[k][4],0)/5;
J.capHours=round((total-natAvg*2+ combatH(50)*60)/60,1);
md.push(`\nСтеля 50 в усіх 15 навичках (три природи з п'ятьох, Живучість набирається в бою): **≈ ${J.capHours} год** чистої дії. Ціль MVP — 20–25 год.`);

H("2. Майстерність і пул");
md.push(`Майстерність росте зі сталою швидкістю ${K.masteryPerHour.toLocaleString("uk")} досвіду за годину дії; ${K.poolShare*100}% іде в пул навички. Місткість пулу в зрізі — ${K.poolCapPerItem} на кожну майстерність навички.\n`);
head("Майстерність","Годин дії","Що дає техніці"); for(const m of [10,25,40,50]) row(m,round(xpAt(m)/K.masteryPerHour,1),m===25?"Коронна техніка; печаток −13%":`Печаток −${Math.round(K.masteryCast*m/99*100)}%, вартість −${Math.round(K.masteryCost*m/99*100)}%, шкода +${Math.round(K.masteryDmg*m/99*100)}%`);
md.push(""); head("Навичка","Майстерностей","Місткість пулу","10%, год дії","25%, год дії","50%, год дії");
const mcount={tai:10,nin:12,katon:7,futon:7,raiton:7,doton:8,suiton:9,cc:8,med:6,ath:12,herb:11,prov:11,alch:11};
for(const [sk,nn] of Object.entries(mcount)){ const cap=nn*K.poolCapPerItem; const hrs=p=>round(cap*p/(K.masteryPerHour*K.poolShare),1); row(NAME[sk],nn,cap.toLocaleString("uk"),hrs(.1),hrs(.25),hrs(.5)); }

H("3. Техніки зрізу");
md.push("Шкода = сила рангу × множник ролі × сила в межах рангу × (1 + "+K.levelScale+" × рівень навички) × (1 + "+K.masteryDmg+" × Майстерність ÷ 99). Каст = базовий каст рангу × множник ролі (або число самої техніки); Майстерність скорочує його до −"+K.masteryCast*100+"%, не нижче "+K.castFloor+" с; печатки на каст не впливають. Значення в таблиці — на рівні відкриття техніки, Майстерність 1.\n");
head("Навичка","Рів.","Техніка","Ранг","Роль","Печ.","Каст, с","Перез., с","Вартість","Шкода","Шкода на 50","Відповідь","Стан");
J.techniques=[];
for(const t of SL.techniques){ if(t.role==="Тренування") continue; const a=tech(t,t.level,1), z=tech(t,50,1); J.techniques.push({id:t.id,...a,level:t.level,dmg50:z.dmg});
  row(NAME[t.skill],t.level,t.uk,a.rank+(t.rankCanon?"":"*"),t.role,t.seals+(t.sealsCanon?"":"*"),a.cast,a.cd,a.cost+(a.res==="stamina"?" вит.":" чак."),a.dmg||"—",z.dmg||"—",t.tags.join(", ")||"—",t.state||"—"); }
md.push("\n* — ранг або кількість печаток не з канону, а за рівнем і складністю.");
md.push("\nОсобливі ефекти: Захист — щит на "+Math.round(K.power.C*1.3)+"–"+Math.round(K.power.B*1.3*2.75)+" шкоди (сила рангу × 1,3 × множник рівня) на 6 с; Підміна — поза слотами, раз на 20 с скасовує одне влучання; Брама відкриття +3% і Брама зцілення +5% шкоди тайдзюцу, 2 і 3 витривалості за секунду, Рани після бою 1; Сенсорна техніка знімає «Прихований» і діє 20 с; Тіньове клонування в бою — Серія по площі.");

H("4. Стани, комбо, звикання");
head("Стан","Ефект");
row("Горіння",`${K.burn.share*100}% шкоди техніки додатково за ${K.burn.dur} с; на цей час зупиняє Регенерацію`);
row("Мокрий",`Ворог діє на ${K.wet.slow*100}% повільніше, ${K.wet.dur} с`);
row("Оглушення",`Ворог пропускає ${K.stun.D}/${K.stun.C}/${K.stun.B} с (ранг D/C/B) і втрачає каст`);
row("Сковування",`${K.bind.dur} с: ухилення ворога ×0,3; риса «Ухильний» не діє`);
row("Отруєння",`${K.poison.pctPerSec*100}% максимального HP за секунду, ${K.poison.dur} с`);
md.push(`\nШанс комбо = ${K.combo.base*100}% + ${K.combo.perLevel*100}% × рівень стихії + ${K.combo.perMastery*100}% × Майстерність, не більше ${K.combo.cap*100}%.\n`);
head("Комбо","Ефект"); row("Футон по Горінню",`Горіння ×${K.combo.fanBurn} і тривалість заново`); row("Райтон по Мокрому",`Оглушення ×${K.combo.shockWet}`); row("Дотон по Мокрому",`Сковування ${K.bind.dur} с, ухилення ×${K.combo.mudEva}`); row("Катон по Мокрому",`Знімає Мокрий, разова шкода ${K.combo.steam*100}% від шкоди техніки`);
md.push(`\nЗвикання: −${K.habituation*100}% за кожен повтор техніки проти того самого ворога, до −${K.habituationCap*100}%; для коронної — удвічі повільніше. Колесо природ: ±${K.wheel*100}% шкоди.`);

H("5. Характеристики гравця й ворогів");
head("Характеристика","Формула");
row("HP",`${K.hpBase} + ${K.hpPerVit} × Живучість`); row("Чакра",`${K.chakraBase} × (1 + ${K.chakraPerMed} × Медитація); відновлення ${K.chakraRegen[0]} + ${K.chakraRegen[1]} × Медитація за с`);
row("Витривалість",`${K.staminaBase} × (1 + ${K.staminaPerAth} × Атлетика); відновлення ${K.staminaRegen[0]} + ${K.staminaRegen[1]} × Атлетика за с`);
row("Точність",`${K.accBase} + ${K.accPerLevel} × рівень навички техніки`); row("Ухилення",`рейтинг = ${K.evaBase} + ${K.rating.evaTier} × ранг гравця + внески вивчених захисних технік (до ${K.passiveFx.shield.evasion}–${K.passiveFx.passiveNegate.evasion} за техніку, від ${K.passiveFx.shield.base*100}% внеску за саме знання до повного на стелі Майстерності) + спорядження й бонуси + ${K.rating.knowledge} за рівень знань про ворога; вдале ухилення нічого не коштує`);
row("Шанс влучити","як у Melvor: якщо точність ≥ ухилення, то 1 − ухилення ÷ (2 × точність), інакше точність ÷ (2 × ухилення); у межах 5–95%");
row("Базова атака",`дія: вичікування рангу й каст ${K.basicCast} с, ${K.basicCost} витривалості, ${K.basicDmg[0]} + ${K.basicDmg[1]} × більший із рівнів Тайдзюцу й Ніндзюцу`);
row("Вартість технік",`−${K.ccCostPerLevel*100}% за рівень Контролю чакри`);
row("Між боями",`зона: HP +${K.zoneHpRegen*100}% максимуму, чакра й витривалість повністю; операція: усе +${K.opRegen*100}%`);
row("Рани",`−${K.wound.stat*100}% бойових характеристик за стак, до ${K.wound.max}; стак гоїться ${K.wound.healMin} хв, не швидше ${K.wound.healFloorMin} хв`);
md.push(""); head("Ворог бойового рівня L","Формула"); row("HP",`${K.eHp[0]} + ${K.eHp[1]} × L`); row("Шкода за удар",`${K.eDmg[0]} + ${K.eDmg[1]} × L, удар кожні ${K.eInterval} с`); row("Точність / ухилення",`${K.eAcc[0]} + ${K.eAcc[1]} × L / ${K.eEva[0]} + ${K.eEva[1]} × L`);
row("Бос",`HP ×${K.boss.hp}, шкода ×${K.boss.dmg}, плюс особливість`); row("Зграя",`${K.pack.n} вороги, у кожного HP ×${K.pack.hp} і шкода ×${K.pack.dmg}`);
md.push(""); head("Риса","Числа");
row("Броня",`−${K.trait.armor*100}% вхідної шкоди; Пробиття знімає на ${K.trait.armorOff} с`); row("Кастер",`кожні ${K.trait.casterEvery} с каст ${K.trait.casterCast} с, удар ×${K.trait.casterMult}; Переривання скасовує`);
row("Ухильний",`ухилення ×${K.trait.evasive}; Сковування знімає`); row("Регенерація",`+${K.trait.regenPct*100}% HP за секунду; Горіння чи отрута зупиняють`);
row("Ілюзіоніст",`кожні ${K.trait.illusionEvery} с ілюзія на ${K.trait.illusionDur} с: точність гравця ×${K.trait.illusionAcc}; опір = Медитація ÷ 200; нюхальна сіль знімає`);
row("Прихований",`перші ${K.trait.hidden} с точність гравця ×${K.trait.hiddenAcc}, перший удар ворога ×${K.trait.hiddenFirst}; Виявлення знімає`); row("Отруйник",`${K.trait.poisonChance*100}% шансу отруїти при влучанні; протиотрута знімає`);
md.push(""); head("Ворог","Де","Бойовий рівень","HP","Шкода за удар","Риси","Природа","Носить"); J.enemies=[];
for(const e of SL.enemies){ const x=enemy(e[3],e[4],e[5]); J.enemies.push({id:e[0],cl:e[3],hp:Math.round(x.hp),dmg:round(x.dmg)}); row(e[1],e[2],e[3],Math.round(x.hp)+(e[4].includes("Зграя")?` (${K.pack.n} × ${Math.round(x.hp*K.pack.hp)})`:""),round(x.dmg),e[4].join(", ")||"—",e[5]?(NAME[e[5]]||"за колесом"):"—",e[6]||"—"); }
md.push(""); head("Бос","Бойовий рівень","HP","Шкода за удар","Риси","Природа","Особливість");
for(const e of SL.bosses){ const x=enemy(e[3],e[4],e[5],true); J.enemies.push({id:e[0],cl:e[3],hp:Math.round(x.hp),dmg:round(x.dmg),boss:true}); row(e[1],e[3],Math.round(x.hp),round(x.dmg),e[4].join(", ")||"—",e[5]?(NAME[e[5]]||"б'є першу природу гравця"):"—",e[7]); }

H("6. Перевірка бою симуляцією");
md.push("Спрощений симулятор із цього файлу: автонабір із 4 технік однієї природи, 400 боїв на рядок, Майстерність 20. Гравець — типовий білд під бойовий рівень (стиль ≈ 1,12 × рівень, захисні навички порівну).\n");
head("Сценарій","Природа","Перемог, %","Час бою, с","Втрачено HP, %"); J.sim=[];
const S=(label,cl,nature,en,opts)=>{ const r=series(build(cl),nature,en,opts); J.sim.push({label,nature,...r}); row(label,NAME[nature],r.win,r.ttk??"—",r.hpLost??"—"); return r; };
for(const cl of [10,20,30,40]) for(const n of ["katon","doton","suiton"]) S(`Звичайний ворог свого рівня (${cl})`,cl,n,enemy(cl));
for(const cl of [20,35]) S(`Ворог на 5 рівнів сильніший (${cl} проти ${cl+5})`,cl,"katon",enemy(cl+5));
md.push(""); head("Риса (ворог свого рівня 34)","Природа","З відповіддю: перемог, % / час, с / HP, %","Без відповіді: перемог, % / час, с / HP, %");
const T=(trait,nature,tools)=>{ const en=enemy(34,[trait]); const a=series(build(34),nature,en,{tools,answers:true}), b=series(build(34),nature,en,{answers:false}); J.sim.push({trait,nature,with:a,without:b}); row(trait,NAME[nature]+(tools.length?" + інструмент":""),`${a.win} / ${a.ttk??"—"} / ${a.hpLost??"—"}`,`${b.win} / ${b.ttk??"—"} / ${b.hpLost??"—"}`); };
T("Броня","futon",[]); T("Броня","katon",[]); T("Кастер","raiton",[]); T("Кастер","doton",["Переривання"]); T("Зграя","katon",[]); T("Зграя","suiton",["Площа"]);
T("Ухильний","doton",[]); T("Ухильний","katon",["Сковування"]); T("Регенерація","katon",[]); T("Регенерація","futon",["Тривала шкода"]);
T("Ілюзіоніст","katon",["Розсіювання"]); T("Прихований","futon",[]); T("Отруйник","katon",["Очищення"]);
md.push(""); head("Бос","Рівень гравця","Природа",`Відповіді й ${K.pouchStack} страви: перемог, % / час, с`,"Відповіді без страв, %","Без підготовки, %");
const allTools=["Переривання","Сковування","Розсіювання","Очищення","Тривала шкода","Площа"];
const B=(id,pcl,nature)=>{ const e=SL.bosses.find(b=>b[0]===id); const nat=e[5]==="wheel"?SL.meta.wheel[Object.keys(SL.meta.wheel).find(k=>SL.meta.wheel[k]===nature)]||"katon":e[5]; const en=enemy(e[3],e[4],nat,true);
  const a=series(build(pcl),nature,en,{tools:allTools,answers:true,food:pcl}), c=series(build(pcl),nature,en,{tools:allTools,answers:true}), b=series(build(pcl),nature,en,{answers:false}); J.sim.push({boss:id,pcl,nature,prepared:a,noFood:c,unprepared:b}); row(e[1],pcl,NAME[nature],`${a.win} / ${a.ttk??"—"}`,c.win,b.win); };
B("boss_wolf",22,"katon"); B("boss_wolf",22,"raiton"); B("boss_wolf",22,"suiton"); B("boss_fighter",32,"doton"); B("boss_fighter",32,"katon"); B("boss_hunter",36,"futon"); B("boss_hunter",36,"doton");
B("boss_twins",38,"futon"); B("boss_twins",38,"katon"); B("boss_mist",40,"doton"); B("boss_mist",40,"katon"); B("boss_nameless",44,"suiton"); B("boss_nameless",44,"futon"); B("boss_nameless",40,"suiton");

H("7. Місії, репутація, Intel");
md.push(`Платня: D — ${K.ryoPerMin.D} рьо за хвилину місії, C — ${K.ryoPerMin.C}. Репутація (лише командні): D — ${K.repPerMission.D}, C — ${K.repPerMission.C}, місія села — ${K.repPerMission.V}. Досвід етапу = ${K.missionXpShare*100}% темпу практики за той самий час, рівень темпу не вищий за ${K.missionRateCap.D} (D), ${K.missionRateCap.C} (C), ${K.missionRateCap.V} (село). Місія села дає ${K.shinobiResPerMission} одиниці ресурсу шинобі.\n`);
head("Ранг","Місія","Тип","Хвилин","Рьо","Репутація","Плата натурою / ресурс"); J.missions=[];
const ITEM={rice:"рис ×6",spice:"спеції ×2",salt:"сіль ×6",note:"Відомості ×1",crate:"ящик торговця ×1",intel:"Intel ×2"};
for(const m of SL.missions){ const ryo=Math.round((K.ryoPerMin[m.rk]||0)*m.min/10)*10; const rep=m.team?(K.repPerMission[m.rk]||0):0; J.missions.push({id:m.id,min:m.min,ryo,rep});
  row(m.rk==="V"?"Село":m.rk==="OP"?"Сюжет":m.rk,m.name,m.team?"командна":"соло",m.min||"серія боїв",ryo||(m.rk==="OP"?"1500 за перший прохід":"—"),rep||(m.rk==="OP"?40:"—"),m.res?`${m.res} ×${K.shinobiResPerMission}`:(m.pay||[]).map(p=>ITEM[p]||"частина сувою (15%)").join(", ")||"—"); }
md.push(`\nПороги Репутації: другий етап села — ${K.rep.stage2}, іспит на Чуніна — ${K.rep.exam}. Перша перемога над босом — ${K.rep.boss}, фінал ланцюжка — ${K.rep.questFinal}.`);
md.push(`\nIntel: +${K.intel.perCellLevel} за кожен рівень дослідженої клітинки, +${K.intel.mail} за «Таємну пошту». Витрати: цілі «Вислідити» — ${K.intel.track.join(" і ")}; пропуск етапу засідок — ${K.intel.caravanSkip}; рівень знань у Бінґо-книзі — ${K.intel.bingoLevel}; письмовий тест −${K.intel.writtenTestPerIntel*100}% часу за одиницю, до ${K.intel.writtenTestMaxIntel}.`);
md.push(`\nЧастини сувоїв: ${K.partsPerScroll} на сувій; бос-носій дає ${K.partDrop.boss} за перемогу, звичайний носій — ${K.partDrop.carrier*100}% шансу, місія — ${K.partDrop.mission*100}%.`);

H("8. Ціни");
head("Що","Ціна, рьо");
row("Сувій Бібліотеки рівнів 1–5",Object.values(K.scroll).join(" / ")); row("Спорядження, тири I / II / III",K.gearTier.join(" / "));
row("Перешкода в слоті 1–6",[1,2,3,4,5,6].map(k=>K.obstacleBase*k*k).join(" / ")); row("Миттєва подорож: Ліси / Рівнини / Долина",K.travel.join(" / "));
row("Товари: вода, рис, сіль, олія, локшина, м'ясо, селітра, спеції",["water","rice","salt","oil","noodles","meat","saltpeter","spice"].map(k=>K.goods[k]).join(" / "));
row("Інструменти: кунай, сюрікен, сенбон, дріт, дротяна пастка, вибухова мітка",["kunai","shuriken","senbon","wire","wiretrap","tag"].map(k=>K.goods[k]).join(" / ")); row("Підсумок медика I",K.goods.medpouch);
row("Нагороди Бінґо-книги: Сірий Вовк, Мандрівний боєць, Мисливець, Близнюки, Втікач із Туману",Object.values(K.bounty).join(" / ")+`; повтор — ${K.bountyRepeat*100}%`);
const sinks={ "Сувої Бібліотеки (усі 8)":K.scroll[1]+K.scroll[2]+K.scroll[3]*3+K.scroll[4]*2+K.scroll[5], "Спорядження (11 тирів)":K.gearTier[0]*5+K.gearTier[1]*5+K.gearTier[2], "Перешкоди (6 слотів)":[1,2,3,4,5,6].reduce((s,k)=>s+K.obstacleBase*k*k,0), "Підсумок медика":K.goods.medpouch };
md.push(""); head("Велика витрата","Рьо"); let sum=0; for(const [k,v] of Object.entries(sinks)){ row(k,v.toLocaleString("uk")); sum+=v; } row("**Разом**","**"+sum.toLocaleString("uk")+"**"); J.sinks=sum;
const inc=K.ryoPerMin.D*60, incC=K.ryoPerMin.C*60;
md.push(`\nДохід: година D-місій ≈ ${inc} рьо, година C-місій ≈ ${incC} рьо плюс ящики; нагороди за п'ятьох босів уперше — ${Object.values(K.bounty).reduce((a,b)=>a+b,0)}. До звання Чуніна гравець заробляє орієнтовно 15–20 тис. рьо, тож купити все не може й мусить обирати — це свідомий компроміс «на що витратити рьо».`);

H("9. Село");
md.push(`Тік — ${K.tickMin} хв. Чотири цивільні ресурси: деревина (Лісопилка), камінь і залізо (Шахта), їжа (Ферми, Угіддя). Виробник рівня n дає ${K.prod} × n за тік. Склад: ${K.storeCap[0]} + ${K.storeCap[1]} × рівень Складу на кожен ресурс; ресурси шинобі: ${K.shinobiCap[0]} + ${K.shinobiCap[1]} × рівень Складу.\n`);
head("Рівень будівлі","Деревина й камінь, кожного","Рьо з казни","Тіків будівництва","Додатково");
for(let n=1;n<=6;n++) row(n,Math.round(K.costBase*K.costMult[n-1]),Math.round(K.treasuryBase*K.costMult[n-1]),K.buildTicks[n-1],n===6?`ресурси шинобі: ${K.shinobiT6} кожного потрібного; другий етап села`:n>=4?"другий етап села; залізо ×0,5":"—");
md.push(`\nКазна: Бюро місій дає ${K.bureauIncome} рьо × рівень за тік, плюс 1 рьо за одиницю Сили шинобі. Етап 1 обмежує будівлі рівнем ${K.towerStageMax[0]}, етап 2 (Репутація ${K.rep.stage2}) — рівнем ${K.towerStageMax[1]}. Одиниця Робочої сили знімає один тік із черги.`);
const toL5=K.costBase*K.costMult.slice(0,5).reduce((a,b)=>a+b,0); md.push(`\nОдна будівля з 1 до 5 рівня коштує ${Math.round(toL5)} деревини й каменю; рівень 6 — ще ${K.costBase*K.costMult[5]} і ${K.shinobiT6} одиниць ресурсу шинобі, тобто ${K.shinobiT6/K.shinobiResPerMission} місій села на кожен ресурс.`);
md.push(""); head("Будівля","Що дає в зрізі","Рівень 6: ресурси шинобі"); for(const b of SL.buildings) row(b[1],b[2],b[3]?Object.entries(b[4]).map(([k,v])=>`${k} ${v}`).join(", "):"—");

H("10. Розвідка");
md.push(`Дослідження — ${K.explore} с. Клітинка має рівні 1–5: ${K.cellExplores.join(" / ")} досліджень (наростаюче). Рівень k клітинки вимагає Розвідки «рівень регіону + ${K.cellLevelStep} × (k − 1)» і дає досвід за темпом цього рівня. Клітинки без точок інтересу в зрізі досліджуються до рівня 3.\n`);
head("Регіон","Розвідка для рівнів клітинки 1–5","Ключові клітинки","Точки інтересу");
for(const r of SL.regions) row(r.name,[0,1,2,3,4].map(k=>Math.min(50,r.scout+K.cellLevelStep*k)).join(" / "),r.cells.filter(c=>c[1]).length,r.cells.filter(c=>c[2]).length);

H("11. Орієнтовний час до віх");
const g=(sk,L)=>minutesTo(L,levelsOf[sk],sk==="prov"||sk==="alch"?K.craftXpMult:1);
const genin=g("tai",10)+g("nin",10)+g("cc",10)+g("ath",5)+g("med",5)+8+5;
const clones=g("nin",50)+g("med",40)+g("scout",20)+g("ath",15);
const fightH=combatH(36)*60; // Живучість 36 у боях; стиль росте разом
const chunin=genin+fightH+g("med",34)+g("scout",25)+g("ath",25)+g("cc",30)+g("herb",45)+g("alch",45)+g("prov",25)+g("nin",30)+ 240 /*місії: Репутація 300 і рьо*/ + 60 /*іспит*/;
head("Віха","Що враховано","Годин"); J.milestones={ genin:round(genin/60,1), clones:round((genin+clones)/60,1), chunin:round(chunin/60,1), cap:J.capHours };
row("Генін","Тайдзюцу, Ніндзюцу, Контроль 10; Атлетика й Медитація 5; 10 манекенів; тест сенсея",J.milestones.genin);
row("Тіньове клонування (якщо йти прямо до нього)","Генін + Ніндзюцу 50 + Медитація 40 + Розвідка 20 + Атлетика 15",J.milestones.clones);
row("Чунін","бої до бойового рівня 40; Медитація 34; Розвідка 25; Атлетика 25; Контроль 30; Травництво й Алхімія 45; Провіант 25; Ніндзюцу 30; 4 год місій; 1 год іспиту",J.milestones.chunin);
row("Стеля 50 в усіх навичках","розділ 1",J.milestones.cap);
md.push("\nЦе нижня оцінка без простоїв, поразок і роздумів гравця; живий темп буде на 15–30% повільнішим. Клони в загальній грі з'являються на 5–8 годині, бо гравець не йде до них прямо. Остаточну підгонку роблять боти на етапі 9.");

fs.writeFileSync(path.join(here,"balance.json"),JSON.stringify(J,null,1));
fs.writeFileSync(path.join(here,"balance_tables.md"),"# Таблиці балансу зрізу MVP\n\nЗгенеровано `balance.mjs` з `slice.json`. Формули й параметри — у самому скрипті (об'єкт `K`) і в документі «Shinobi Idle — модель балансу».\n"+md.join("\n")+"\n");
console.log("milestones",JSON.stringify(J.milestones));
console.log(md.slice(md.findIndex(l=>l.startsWith("\n## 6")),md.findIndex(l=>l.startsWith("\n## 7"))).join("\n"));
