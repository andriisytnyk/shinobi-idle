import type { CliResult } from './commands.ts';
import type { Environment } from './env.ts';

/**
 * `pnpm sim telemetry-report <file>`: turns the file a playtester exported from the settings page
 * into a Markdown summary for the author. The file is read as data; a wrong shape is an error, not a crash.
 */

type Json = Record<string, unknown>;
type Translate = (key: string) => string | undefined;

const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const obj = (x: unknown): Json => (isObj(x) ? x : {});
const list = (x: unknown): Json[] => (Array.isArray(x) ? x.filter(isObj) : []);
const numMap = (x: unknown): [string, number][] =>
  Object.entries(obj(x)).map(([k, v]) => [k, num(v)] as [string, number]);

/** `1 год 05 хв`, `12 хв 03 с`, `45 с`. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} год ${String(m).padStart(2, '0')} хв`;
  if (m > 0) return `${m} хв ${String(s).padStart(2, '0')} с`;
  return `${s} с`;
}

const stamp = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

const table = (head: string[], rows: string[][]): string[] => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];

/** The readable name of an id of a kind (`skill`, `rank`, ...), or the id itself. */
function nameOf(t: Translate, kind: string, id: string): string {
  return t(`${kind}.${id}.name`) ?? t(`${kind}.${id}`) ?? id;
}

/** Readable names of the action kinds of the built-in rules; a kind of a pack shows as its id. */
const KIND_LABELS: Record<string, string> = {
  practice: 'Практика',
  drill: 'Муштра',
  meditate: 'Медитація',
  course: 'Курс',
  fight: 'Бій',
  operation: 'Операція',
  mission: 'Місія',
  gather: 'Збір',
  craft: 'Крафт',
  senseiTest: 'Іспит сенсея',
  explore: 'Розвідка',
  walk: 'Подорож',
  stand: 'Очікування',
  autosurvey: 'Автоогляд',
};

/** Readable names of the sources of money. */
const SOURCE_LABELS: Record<string, string> = {
  mission: 'Місії',
  loot: 'Здобич з боїв',
  bounty: 'Нагороди за голови',
  operation: 'Операції',
  point: 'Знахідки на мапі',
  other: 'Інше (не пояснене подіями)',
};

const labelOf = (labels: Record<string, string>, key: string): string => labels[key] ?? key;

/** Renders one milestone key (`skill:core:tai:10`, `rank:genin`, ...). */
function milestoneName(t: Translate, key: string): string {
  const [kind = '', ...rest] = key.split(':');
  const tail = rest.join(':');
  switch (kind) {
    case 'rank':
      return `Ранг: ${nameOf(t, 'rank', tail)}`;
    case 'skill': {
      const at = tail.lastIndexOf(':');
      return `${nameOf(t, 'skill', tail.slice(0, at))} ${tail.slice(at + 1)}`;
    }
    case 'technique':
      return `Техніка: ${nameOf(t, 'technique', tail)}`;
    case 'quest': {
      const at = tail.lastIndexOf(':');
      const step = tail.slice(at + 1);
      const name = nameOf(t, 'quest', tail.slice(0, at));
      return step === 'done' ? `Квест «${name}» завершено` : `Квест «${name}»: крок ${step}`;
    }
    case 'exam':
      return `Іспит: ${nameOf(t, 'exam', tail)}`;
    case 'village':
      return `Село: стадія ${tail}`;
    default:
      return key;
  }
}

/** The Markdown summary of an exported file. Throws an Error with a readable message for a file that is not one. */
export function telemetryReport(file: unknown, t: Translate): string[] {
  if (!isObj(file) || file.format !== 'shinobi-telemetry' || !isObj(file.record)) {
    throw new Error('Це не файл телеметрії Shinobi Idle (немає поля format: shinobi-telemetry).');
  }
  const rec = file.record;
  if (rec.v !== 1) throw new Error(`Невідома версія запису: ${String(rec.v)}.`);
  const game = obj(file.game);
  const sessions = obj(rec.sessions);
  const offline = obj(rec.offline);
  const dry = obj(rec.dry);
  const out: string[] = [];

  out.push('# Звіт телеметрії', '');
  out.push(
    `- Експортовано: ${stamp(num(file.exportedAt))} UTC`,
    `- Ігровий час: ${duration(num(game.now))}, ранг: ${nameOf(t, 'rank', String(game.rank ?? '?'))}`,
    `- Пакети: ${
      list(game.packs)
        .map((p) => `${String(p.id)} ${String(p.version)}`)
        .join(', ') || '—'
    }`,
    '',
  );

  out.push('## Темп і сесії', '');
  const realMs = num(sessions.realMs);
  out.push(
    `- Сесій: ${num(sessions.count)}, загалом із відкритою грою: ${duration(realMs)}`,
    `- Ігрових годин на годину реального: ${realMs > 0 ? (num(rec.game) / realMs).toFixed(2) : '—'}`,
    `- Відсутність (офлайн): ${num(offline.count)} разів, ${duration(num(offline.requestedMs))} реальних, ${duration(num(offline.simulatedMs))} пораховано`,
    '',
  );
  const last = list(sessions.last);
  if (last.length > 0) {
    out.push(
      ...table(
        ['Початок (UTC)', 'Тривала', 'Ігрового часу'],
        last.map((s) => [
          stamp(num(s.start)),
          duration(num(s.end) - num(s.start)),
          duration(num(s.gameEnd) - num(s.gameStart)),
        ]),
      ),
      '',
    );
  }

  out.push('## Віхи', '');
  const milestones = list(rec.milestones).sort((a, b) => num(a.game) - num(b.game));
  if (milestones.length === 0) out.push('Віх ще немає.', '');
  else {
    const start = num(milestones[0]?.real);
    out.push(
      ...table(
        ['Ігровий час', 'Реальний від першої віхи', 'Віха'],
        milestones.map((m) => [
          duration(num(m.game)),
          duration(num(m.real) - start),
          milestoneName(t, String(m.key)),
        ]),
      ),
      '',
    );
  }
  out.push(
    `Найдовший відтинок ігрового часу без віхи: ${duration(num(dry.ms))} (з ${duration(num(dry.from))}).`,
    '',
  );

  const total = (rows: [string, number][]) => rows.reduce((a, [, n]) => a + n, 0);
  const byKind = numMap(rec.timeByKind).sort((a, b) => b[1] - a[1]);
  out.push('## Куди пішов час (ігровий)', '');
  out.push(
    ...table(
      ['Вид дії (приблизно для офлайну)', 'Час', 'Частка'],
      byKind.map(([k, ms]) => [
        labelOf(KIND_LABELS, k),
        duration(ms),
        `${((100 * ms) / Math.max(1, num(rec.game))).toFixed(0)}%`,
      ]),
    ),
    '',
  );
  const bySkill = numMap(rec.timeBySkill).sort((a, b) => b[1] - a[1]);
  out.push(
    ...table(
      ['Навичка (час, коли росла її XP)', 'Час'],
      bySkill.map(([k, ms]) => [nameOf(t, 'skill', k), duration(ms)]),
    ),
    '',
  );

  out.push('## Бої', '');
  const fights = Object.entries(obj(rec.fights)).sort(
    (a, b) => num(obj(b[1]).lost) - num(obj(a[1]).lost),
  );
  out.push(
    ...table(
      ['Ворог', 'Перемог', 'Поразок'],
      fights.map(([id, f]) => [
        nameOf(t, id.includes('boss') ? 'boss' : 'enemy', id),
        String(num(obj(f).won)),
        String(num(obj(f).lost)),
      ]),
    ),
    '',
  );

  const missions = numMap(rec.missions).sort((a, b) => b[1] - a[1]);
  out.push('## Місії', '', `Виконано: ${total(missions)}`, '');
  if (missions.length > 0) {
    out.push(
      ...table(
        ['Місія', 'Разів'],
        missions.map(([id, n]) => [nameOf(t, 'mission', id), String(n)]),
      ),
      '',
    );
  }

  const ryo = obj(rec.ryo);
  const earned = numMap(ryo.earned).sort((a, b) => b[1] - a[1]);
  out.push('## Рьо', '');
  out.push(
    ...table(
      ['Джерело', 'Рьо'],
      earned.map(([k, n]) => [labelOf(SOURCE_LABELS, k), String(n)]),
    ),
    '',
    `Зароблено разом: ${total(earned)}, витрачено: ${num(ryo.spent)}.`,
    '',
  );
  return out;
}

/** The CLI entry: reads the file named in `args` and prints the report. */
export function runTelemetryReportCli(
  args: string[],
  env: Environment,
  read: (path: string) => string,
): CliResult {
  const [path] = args;
  if (!path) {
    return {
      code: 1,
      out: [],
      err: ['Використання: pnpm sim telemetry-report <файл.json>'],
    };
  }
  try {
    const t: Translate = (key) => env.content.locales.uk[key];
    return { code: 0, err: [], out: telemetryReport(JSON.parse(read(path)), t) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { code: 1, out: [], err: [`Не вдалося прочитати «${path}»: ${reason}`] };
  }
}
