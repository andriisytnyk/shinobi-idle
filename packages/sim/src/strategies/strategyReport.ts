import type { ContentDb } from '@shinobi/content';
import { TARGETS, type RunMetrics } from './matrix.ts';
import type { MatrixResult, MatrixRow } from './runMatrix.ts';
import { STRATEGIES } from './strategies.ts';

const num = (n: number, digits = 1): string => n.toFixed(digits);

/** Min / median / max of a list (the lower middle for an even count); null for an empty list. */
export function spread(
  values: readonly number[],
): { min: number; median: number; max: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] as number,
    median: sorted[Math.floor((sorted.length - 1) / 2)] as number,
    max: sorted[sorted.length - 1] as number,
  };
}

/** «мін / мед / макс» of the values that exist; «—» when none does, and the count when only some do. */
function cell(values: readonly (number | null)[], total: number, digits = 1, scale = 1): string {
  const present = values.flatMap((v) => (v === null ? [] : [v * scale]));
  const s = spread(present);
  if (!s) return '—';
  const text = `${num(s.min, digits)} / ${num(s.median, digits)} / ${num(s.max, digits)}`;
  return present.length === total ? text : `${text} (${present.length}/${total})`;
}

const tripleLabel = (triple: readonly string[], content: ContentDb): string =>
  triple.map((n) => content.locales.uk[`skill.${n}.name`] ?? n).join(' + ');

function perHour(t: { ms: number; xp: number; ryo: number }, key: 'xp' | 'ryo'): number | null {
  return t.ms >= 60_000 ? (t[key] / t.ms) * 3_600_000 : null;
}

function table(
  rows: MatrixRow[],
  content: ContentDb,
  headers: string[],
  line: (run: RunMetrics[], total: number) => string[],
): string[] {
  const out = [
    `| Трійка природ | ${headers.join(' | ')} |`,
    `| --- | ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    out.push(
      `| ${tripleLabel(row.triple, content)} | ${line(row.runs, row.runs.length).join(' | ')} |`,
    );
  }
  return out;
}

/** What a run misses against the targets of the documents, with the measured numbers. */
export interface Miss {
  target: string;
  /** Seeds (of all) that miss it. */
  seeds: number;
  of: number;
  measured: string;
}

const h = (n: number): string => `${num(n)} год`;

function missesOf(runs: RunMetrics[]): Miss[] {
  const total = runs.length;
  const out: Miss[] = [];
  const add = (target: string, bad: RunMetrics[], measured: string) => {
    if (bad.length > 0) out.push({ target, seeds: bad.length, of: total, measured });
  };
  const range = (values: (number | null)[]): string => {
    const s = spread(values.flatMap((v) => (v === null ? [] : [v])));
    return s ? `${h(s.min)} / ${h(s.median)} / ${h(s.max)}` : 'жодного разу';
  };
  const outside = (v: number | null, min: number, max: number) => v === null || v < min || v > max;

  const genin = TARGETS.geninHours;
  add(
    `Генін ≈ 1 год (${genin.min}–${genin.max})`,
    runs.filter((r) => outside(r.genin, genin.min, genin.max)),
    range(runs.map((r) => r.genin)),
  );
  const chunin = TARGETS.chuninHours;
  const neverChunin = runs.filter((r) => r.chunin === null);
  add(
    `Чунін ${chunin.min}–${chunin.max} год`,
    runs.filter((r) => outside(r.chunin, chunin.min, chunin.max)),
    neverChunin.length === total
      ? `не досягнуто за ${h(Math.max(...runs.map((r) => r.hours)))}`
      : range(runs.map((r) => r.chunin)),
  );
  const gapRuns = runs.filter((r) => r.cadence.hours > r.cadence.allowed);
  const gaps = spread(runs.map((r) => r.longestGap.hours));
  add(
    `Проміжок без нового: не більше ${TARGETS.maxGapShare * 100}% ігрового часу й ${TARGETS.maxGapHours} год`,
    gapRuns,
    gaps
      ? `найдовший проміжок ${h(gaps.min)} / ${h(gaps.median)} / ${h(gaps.max)}; найгірший проти правила: ${[...runs].sort((a, b) => b.cadence.hours / b.cadence.allowed - a.cadence.hours / a.cadence.allowed).map((x) => `${h(x.cadence.hours)} при допустимих ${h(x.cadence.allowed)}`)[0]}`
      : '',
  );
  const atChunin = runs.filter((r) => r.minLevelAtChunin !== null);
  const lowAtChunin = spread(atChunin.map((r) => r.minLevelAtChunin as number));
  add(
    `Жодна навичка нижче ${TARGETS.minSkillAtEnd} на Чуніні`,
    atChunin.filter((r) => (r.minLevelAtChunin as number) < TARGETS.minSkillAtEnd),
    lowAtChunin
      ? `найнижча навичка на Чуніні ${num(lowAtChunin.min, 0)} / ${num(lowAtChunin.median, 0)} / ${num(lowAtChunin.max, 0)}`
      : 'Чуніна не досягнуто',
  );
  const low = runs.filter((r) => r.minLevel < TARGETS.minSkillAtEnd);
  const lows = spread(runs.map((r) => r.minLevel));
  add(
    `Жодна навичка нижче ${TARGETS.minSkillAtEnd} наприкінці`,
    low,
    lows
      ? `найнижча навичка ${num(lows.min, 0)} / ${num(lows.median, 0)} / ${num(lows.max, 0)}`
      : '',
  );
  return out;
}

/** When the quest chains were finished: the median hour over the runs that finished them. */
function chainsLine(runs: RunMetrics[], content: ContentDb): string {
  const t = (k: string) => content.locales.uk[k] ?? k;
  const done = new Map<string, number[]>();
  for (const r of runs) {
    for (const [id, at] of Object.entries(r.questsDoneAt))
      done.set(id, [...(done.get(id) ?? []), at]);
  }
  if (done.size === 0) return '';
  const parts = [...done.entries()]
    .map(([id, at]) => ({ id, at, median: spread(at)?.median ?? 0 }))
    .sort((a, b) => a.median - b.median || (a.id < b.id ? -1 : 1))
    .map(
      (q) => `«${t(`quest.${q.id}.name`)}» ${num(q.median)} год (${q.at.length}/${runs.length})`,
    );
  return `Завершені ланцюжки, медіана за прогонами, що їх завершили: ${parts.join('; ')}.`;
}

/** The defeats the player took, by enemy: the mean per run, the biggest few. */
function defeatsLine(runs: RunMetrics[]): string {
  const sums = new Map<string, number>();
  for (const r of runs)
    for (const [enemy, n] of Object.entries(r.defeats)) sums.set(enemy, (sums.get(enemy) ?? 0) + n);
  if (sums.size === 0) return '';
  const top = [...sums.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([enemy, n]) => `\`${enemy}\` ${num(n / runs.length)}`);
  return `Поразки гравця за прогін у середньому (найбільші): ${top.join(', ')}.`;
}

/** The most common reason runs ended short of the vest, by the quests they stood in. */
function stallOf(runs: RunMetrics[], content: ContentDb): string {
  const stuck = runs.filter((r) => r.chunin === null);
  if (stuck.length === 0) return '';
  const t = (k: string) => content.locales.uk[k] ?? k;
  const counts = new Map<string, number>();
  for (const r of stuck) {
    const open = Object.entries(r.quests)
      .filter(([, v]) => v !== 'done')
      .map(([id, v]) => `«${t(`quest.${id}.name`)}» крок ${Number(v) + 1}`);
    const key = [r.blocked ? `${r.blocked}` : null, open.join(', ')].filter(Boolean).join('; ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 2)
    .map(([k, n]) => `${k || 'без відкритих доручень'} (${n}/${stuck.length})`)
    .join(' | ');
}

/** The report as Markdown. Nothing in it depends on the clock or on how many workers played the matrix. */
export function strategyReportMarkdown(result: MatrixResult, content: ContentDb): string {
  const byStrategy = new Map<string, MatrixRow[]>();
  for (const row of result.rows) {
    const list = byStrategy.get(row.strategy) ?? [];
    list.push(row);
    byStrategy.set(row.strategy, list);
  }
  const nRuns = result.rows.reduce((a, r) => a + r.runs.length, 0);
  const lines: string[] = [
    '# Боти за стратегіями: звіт балансу (етап 9)',
    '',
    `Згенеровано командою \`pnpm sim strategies --seeds ${result.seeds.length} --hours ${result.hours}\`. ` +
      `${byStrategy.size} стратегій × ${(byStrategy.get([...byStrategy.keys()][0] ?? '') ?? []).length} трійок природ × ${result.seeds.length} сідів = ${nRuns} прогонів по ${result.hours} ігрових годин. ` +
      'Прогони детерміновані; та сама команда дає той самий файл. Нічого тут не підігнано: це вимір поточного балансу.',
    '',
    'У кожній клітинці — **мін / медіана / макс** за сідами. Якщо вимірювання є не в усіх прогонах, поруч у дужках — скільки прогонів його мають; «—» означає, що не мав жоден.',
    '',
    '## Боти',
    '',
    ...[...byStrategy.keys()].map((id) => {
      const s = STRATEGIES[id as keyof typeof STRATEGIES];
      return `- **${s.label}** (\`${id}\`): ${s.description}`;
    }),
    '',
    'Усі боти грають лише тим, що доступно гравцеві, і лише командами інтерфейсу: старт і зупинка дій, купівля, читання сувоїв, будівництво села, подорожі картою, клон там, де він допомагає. Академію всі проходять однаково (бот `academy`); далі стратегії розходяться. Трійка природ — рідна й дві додаткові, їх бот бере, коли Контроль чакри дозволяє (20 і 40).',
    '',
    '**Віхи:** ранг Генін, техніка клонування, жилет Чуніна, стеля (усі навички, які може тренувати персонаж, на 50). Для проміжку без віхи віхою вважаються ще кроки доручень, завершені ланцюжки й кожна десята позначка рівня навички (10, 20, 30, 40, 50) уперше; проміжок після останньої віхи рахується до кінця прогону.',
    '',
  ];

  const section = (
    title: string,
    intro: string,
    headers: string[],
    line: (runs: RunMetrics[], total: number) => string[],
  ) => {
    lines.push(`## ${title}`, '', intro, '');
    for (const [id, rows] of byStrategy) {
      lines.push(
        `### ${STRATEGIES[id as keyof typeof STRATEGIES].label}`,
        '',
        ...table(rows, content, headers, line),
        '',
      );
    }
  };

  section(
    '1. Навички за перші 3 години',
    'Гіпотеза: за три години гравець має розвинути кілька навичок у різних напрямках, а не одну. Рівні навичок, доступних персонажеві, на 3-й годині.',
    ['Середній рівень', 'Найнижча навичка', 'Навичок від 10'],
    (runs, n) => {
      const mean = runs.map((r) => {
        const v = Object.values(r.levelsAt3h);
        return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
      });
      return [
        cell(mean, n),
        cell(
          runs.map((r) => Math.min(...Object.values(r.levelsAt3h))),
          n,
          0,
        ),
        cell(
          runs.map((r) => Object.values(r.levelsAt3h).filter((l) => l >= 10).length),
          n,
          0,
        ),
      ];
    },
  );

  section(
    '2. Час до віх',
    'Гіпотеза: Генін ≈ 1 год, Чунін за 20–50 год (рішення автора: для гри з офлайн-прогресом це норма). Стеля навичок цілю не є (рішення автора 18.11) і тут не вимірюється: прогін кінчається жилетом. Години ігрового часу.',
    ['Генін', 'Техніка клонування', 'Жилет Чуніна'],
    (runs, n) => [
      cell(
        runs.map((r) => r.genin),
        n,
      ),
      cell(
        runs.map((r) => r.clone),
        n,
      ),
      cell(
        runs.map((r) => r.chunin),
        n,
      ),
    ],
  );

  section(
    '3. Найдовший проміжок без віхи',
    'Правило ритму (рішення автора 18.11): найдовший проміжок без нового — не більше 20% часу від початку гри й не більше 8 год. Тут — найдовший проміжок у годинах; у колонці «після» — віха, після якої він стався в медіанному прогоні.',
    ['Проміжок', 'Після віхи (медіанний прогін)'],
    (runs, n) => {
      const sorted = [...runs].sort((a, b) => a.longestGap.hours - b.longestGap.hours);
      const mid = sorted[Math.floor((sorted.length - 1) / 2)];
      return [
        cell(
          runs.map((r) => r.longestGap.hours),
          n,
        ),
        mid ? mid.longestGap.after : '—',
      ];
    },
  );

  section(
    '4. Частка часу з клоном',
    'Клон має бути корисним знаряддям, а не головною стратегією. Частка часу, коли клон існував (від усього прогону й від часу з відкритим слотом), частка досвіду навичок, яку принесли розсіяні клони (від усього досвіду, що має персонаж наприкінці), і частка дій: час роботи клона за ділянкою дії (не стояння) проти часу дії персонажа й клона разом.',
    ['Від усього прогону, %', 'Від часу після відкриття, %', 'Частка досвіду, %', 'Частка дій, %'],
    (runs, n) => [
      cell(
        runs.map((r) => r.cloneShareRun),
        n,
        1,
        100,
      ),
      cell(
        runs.map((r) => r.cloneShareOpen),
        n,
        1,
        100,
      ),
      cell(
        runs.map((r) => (r.totalXp > 0 ? r.cloneXp / r.totalXp : null)),
        n,
        1,
        100,
      ),
      cell(
        runs.map((r) => {
          const all = r.actionMs.main + r.actionMs.clone;
          return all > 0 ? r.actionMs.clone / all : null;
        }),
        n,
        1,
        100,
      ),
    ],
  );

  section(
    '4а. Бойові клони',
    'Скільки боїв персонаж провів із тілами на своєму боці (бойові тіньові клони) і скільки досвіду за годину це дає. Множник — досвід за годину в боях із тілами, поділений на досвід за годину в боях без них (це XP усіх навичок, що надходить, поки слот 0 б’ється; кілька тіл можуть множити бойовий досвід, їх обмежує чакра). «—» — таких боїв не було.',
    ['Боїв із тілами, %', 'Час боїв із тілами, %', 'XP/год з тілами', 'XP/год без тіл', 'Множник'],
    (runs, n) => {
      const plain = (r: RunMetrics) => ({
        ms: r.fight.ms - r.fightAlly.ms,
        xp: r.fight.xp - r.fightAlly.xp,
        ryo: 0,
      });
      return [
        cell(
          runs.map((r) => (r.fights > 0 ? r.fightsWithAllies / r.fights : null)),
          n,
          1,
          100,
        ),
        cell(
          runs.map((r) => (r.fight.ms > 0 ? r.fightAlly.ms / r.fight.ms : null)),
          n,
          1,
          100,
        ),
        cell(
          runs.map((r) => perHour(r.fightAlly, 'xp')),
          n,
          0,
        ),
        cell(
          runs.map((r) => perHour(plain(r), 'xp')),
          n,
          0,
        ),
        cell(
          runs.map((r) => {
            const a = perHour(r.fightAlly, 'xp');
            const p = perHour(plain(r), 'xp');
            return a !== null && p !== null && p > 0 ? a / p : null;
          }),
          n,
          2,
        ),
      ];
    },
  );

  section(
    '5. Місії проти практики',
    'Гіпотеза: місії платять не менше за практику. XP навичок і рьо за годину роботи кожного виду (лише час, коли слот 0 робив саме це; рьо — лише надходження); «Практика» — усе, що тренує навичку без місії й бою.',
    ['XP/год місії', 'XP/год практика', 'Рьо/год місії', 'Рьо/год практика'],
    (runs, n) => [
      cell(
        runs.map((r) => perHour(r.mission, 'xp')),
        n,
        0,
      ),
      cell(
        runs.map((r) => perHour(r.practice, 'xp')),
        n,
        0,
      ),
      cell(
        runs.map((r) => perHour(r.mission, 'ryo')),
        n,
        0,
      ),
      cell(
        runs.map((r) => perHour(r.practice, 'ryo')),
        n,
        0,
      ),
    ],
  );

  // How clean the bots play: commands the game refused (a bot that is wrong about the rules shows up here).
  lines.push(
    '## Відхилені команди',
    '',
    'Команди, які гра відмовилась виконати: чим їх менше, тим точніше бот знає правила. Це перевірка самих ботів, а не балансу.',
    '',
    '| Стратегія | Відхилено за прогін (мін / мед / макс) | Найчастіша перша причина |',
    '| --- | --- | --- |',
  );
  for (const [id, rows] of byStrategy) {
    const all = rows.flatMap((r) => r.runs);
    const reasons = new Map<string, number>();
    for (const r of all) {
      if (r.firstRejection) reasons.set(r.firstRejection, (reasons.get(r.firstRejection) ?? 0) + 1);
    }
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    lines.push(
      `| ${STRATEGIES[id as keyof typeof STRATEGIES].label} | ${cell(
        all.map((r) => r.rejected),
        all.length,
        0,
      )} | ${top ? `\`${top[0]}\` (${top[1]}/${all.length})` : '—'} |`,
    );
  }
  lines.push('');

  // What does not add up.
  lines.push(
    '## Що не сходиться',
    '',
    'Цілі взято з `docs/Shinobi Idle — модель балансу.md` і плану етапу 9: Генін ≈ 1 год (смуга 0,5–1,5), Чунін за 20–50 год (рішення автора від 18.11: гра з офлайн-прогресом не стискається до 12–15 год); стеля навичок не ціль, її лише вимірюють; цілі часу й ритму судять ботів, що йдуть за сюжетом до жилета (сюжетник), решту — мирного, колекціонера, бійця й офлайн-гравця — подано довідково; проміжок без нового — не більше 20% ігрового часу на той момент і не більше 8 год (мінімум 1 год допустимо завжди); на Чуніні жодна навичка сюжетного гравця не нижче 20, жодної навички нижче 20 наприкінці прогону. Кожна клітинка — мін / медіана / макс за сідами; «k/n» — скільки сідів схибили.',
    '',
  );
  const totals: string[] = [];
  const details: string[] = [];
  for (const [id, rows] of byStrategy) {
    const label = STRATEGIES[id as keyof typeof STRATEGIES].label;
    const all = rows.flatMap((r) => r.runs);
    const never = all.filter((r) => r.chunin === null).length;
    totals.push(
      `| ${label}${STRATEGIES[id as keyof typeof STRATEGIES].judged ? '' : ' (довідково)'} | ${never}/${all.length} | ${all.filter((r) => r.chunin !== null && (r.chunin < TARGETS.chuninHours.min || r.chunin > TARGETS.chuninHours.max)).length} | ` +
        `${all.filter((r) => r.cadence.hours > r.cadence.allowed).length}/${all.length} | ` +
        `${all.filter((r) => r.minLevelAtChunin !== null && r.minLevelAtChunin < TARGETS.minSkillAtEnd).length}/${all.filter((r) => r.minLevelAtChunin !== null).length} | ` +
        `${all.filter((r) => r.minLevel < TARGETS.minSkillAtEnd).length}/${all.length} |`,
    );
    details.push(`### ${label}`, '');
    if (!STRATEGIES[id as keyof typeof STRATEGIES].judged) {
      details.push(
        'Цей бот не йде до жилета Чуніна за сюжетом, тож цілі часу й ритму його не судять; промахи подано для довідки.',
        '',
      );
    }
    const stall = stallOf(all, content);
    if (stall) details.push(`Відкриті доручення на кінець прогону (без жилета): ${stall}.`, '');
    const chains = chainsLine(all, content);
    if (chains) details.push(chains, '');
    const lost = defeatsLine(all);
    if (lost) details.push(lost, '');
    details.push(
      '| Трійка природ | Ціль | Схибили | Виміряно (мін / мед / макс) |',
      '| --- | --- | --- | --- |',
    );
    for (const row of rows) {
      for (const m of missesOf(row.runs)) {
        details.push(
          `| ${tripleLabel(row.triple, content)} | ${m.target} | ${m.seeds}/${m.of} | ${m.measured} |`,
        );
      }
    }
    details.push('');
  }
  lines.push(
    '### Підсумок за стратегіями',
    '',
    'Скільки прогонів із загальної кількості схибили ціль (колонка «Чунін поза смугою» — лише ті, що жилет отримали, але не за 20–50 год).',
    '',
    '| Стратегія | Жилета немає | Чунін поза смугою | Проміжок понад правило | Навичка нижче 20 на Чуніні | Навичка нижче 20 наприкінці |',
    '| --- | --- | --- | --- | --- | --- |',
    ...totals,
    '',
    '### Усі промахи з числами',
    '',
    ...details,
  );
  return lines.join('\n');
}

/** The machine-readable report: every run, nothing derived. */
export function strategyReportJson(result: MatrixResult): string {
  return JSON.stringify(
    {
      hours: result.hours,
      seeds: result.seeds,
      targets: TARGETS,
      rows: result.rows,
    },
    null,
    1,
  );
}
