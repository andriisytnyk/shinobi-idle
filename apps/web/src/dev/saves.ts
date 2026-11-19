/*
 * Ready-made saves for the developer panel: the fixtures the repository keeps for its tests. They
 * are read on demand, so the panel's chunk stays small until one is picked.
 */

export interface Fixture {
  id: string;
  label: string;
  /** The save text (the envelope `deserialize` reads). */
  save: string;
}

type Table = Record<string, { save: string }>;

async function table(raw: Promise<{ default: string }>): Promise<Table> {
  return JSON.parse((await raw).default) as Table;
}

/** Every fixture save of the repository, labelled by its file and name. */
export async function loadFixtures(): Promise<Fixture[]> {
  const files: [string, Promise<{ default: string }>][] = [
    ['story', import('../../../../packages/core/test/fixtures/save-v18-real.json?raw')],
    ['boss', import('../../../../packages/core/test/fixtures/dev-saves.json?raw')],
  ];
  const out: Fixture[] = [];
  for (const [group, raw] of files) {
    const rows = await table(raw);
    for (const [name, row] of Object.entries(rows))
      if (typeof row.save === 'string')
        out.push({ id: `${group}:${name}`, label: `${group} — ${name}`, save: row.save });
  }
  return out;
}
