/** The map: structured points of interest, key definitions and their closure. */
import { describe, expect, it } from 'vitest';
import idRegistry from '../src/data/id-registry.json' with { type: 'json' };
import { CELL_KEYS, KEY_NATURES, content, ukLocale, type PoiKind, type Req } from '../src/index.ts';

const pois = content.cells.flatMap((c) => c.pois.map((p) => ({ cell: c, poi: p })));
const registered = (idRegistry as Record<string, Record<string, string>>)['poi'] ?? {};

/** The kinds of point of interest the original free text of a cell mentions. */
function kindsInText(note: string): PoiKind[] {
  const kinds: PoiKind[] = [];
  const has = (re: RegExp, kind: PoiKind) => re.test(note) && kinds.push(kind);
  has(/Зона/, 'zone');
  has(/Місце тренування/, 'training');
  has(/Родовище/, 'deposit');
  has(/Сховок розбійників|Сховок мародерів|Сховок старого|трофеї|Старовинні монети/, 'cache');
  has(/^Сюжет/, 'story');
  has(/^Застава/, 'outpost');
  has(/Цілий сувій/, 'vault');
  has(/Місія/, 'mission');
  return kinds;
}

describe('points of interest', () => {
  it('cover what the original text of every cell mentions', () => {
    expect(content.cells).toHaveLength(36);
    for (const c of content.cells) {
      const note = ukLocale[`cell.${c.id}.note`] ?? '';
      for (const kind of kindsInText(note)) {
        expect(
          c.pois.some((p) => p.kind === kind),
          `${c.id} (${note}) has no ${kind} point of interest`,
        ).toBe(true);
      }
      // A note that names nothing means a plain cell, and a plain cell has no point at all.
      if (note === '') expect(c.pois, c.id).toEqual([]);
    }
  });

  it('are registered, unique and have a name and a description', () => {
    const slugs = new Set(Object.values(registered));
    const seen = new Set<string>();
    for (const { poi } of pois) {
      expect(seen.has(poi.id), `duplicate ${poi.id}`).toBe(false);
      seen.add(poi.id);
      expect(slugs.has(poi.id.replace('core:', '')), poi.id).toBe(true);
      expect(ukLocale[`poi.${poi.id}.name`], poi.id).toBeTruthy();
      const desc = ukLocale[`poi.${poi.id}.desc`] ?? '';
      expect(desc.length, poi.id).toBeGreaterThanOrEqual(20);
      expect(/[0-9]|[A-Za-z]{3,}/.test(desc), `${poi.id}: ${desc}`).toBe(false);
    }
    expect(slugs.size).toBe(pois.length);
  });

  it('keep story points out of cells behind a nature key', () => {
    for (const { cell, poi } of pois) {
      if (poi.kind === 'story' && cell.key !== null) {
        expect(KEY_NATURES[cell.key], `${poi.id} sits behind ${cell.key}`).toEqual([]);
      }
    }
  });

  it('link every zone of the three regions from exactly one cell', () => {
    const regionZones = content.zones.filter((z) =>
      ['forest', 'plains', 'valley'].includes(z.region),
    );
    expect(regionZones).toHaveLength(18);
    for (const z of regionZones) {
      const owners = pois.filter((p) => p.poi.kind === 'zone' && p.poi.zone === z.id);
      expect(owners.length, z.id).toBe(1);
      expect(owners[0]?.cell.region, z.id).toBe(`core:${z.region}`);
    }
    for (const { poi } of pois) {
      if (poi.kind === 'zone')
        expect(
          content.zones.some((z) => z.id === poi.zone),
          poi.id,
        ).toBe(true);
    }
  });

  it('have the four training spots of the slice', () => {
    const spots = pois.flatMap(({ cell, poi }) =>
      poi.kind === 'training' ? [[cell.id, poi.skill, poi.bonus] as const] : [],
    );
    expect(spots).toEqual([
      ['core:polihon_44_lis_smerti', 'herb', 0.1],
      ['core:khram_vohniu', 'katon', 0.1],
      ['core:statui_zasnovnykiv', 'tai', 0.1],
      ['core:sviate_mistse_bilia_vodospadu', 'med', 0.1],
    ]);
  });

  it('point at buildings, missions and items that exist', () => {
    for (const { poi } of pois) {
      if (poi.kind === 'deposit') {
        expect(
          content.buildings.some((b) => b.id === poi.building),
          poi.id,
        ).toBe(true);
      }
      if (poi.kind === 'mission') {
        expect(
          content.missions.some((m) => m.id === poi.mission),
          poi.id,
        ).toBe(true);
      }
      if (poi.kind === 'cache') {
        for (const i of poi.items)
          expect(
            content.items.some((x) => x.id === i.item),
            poi.id,
          ).toBe(true);
        expect(poi.items.length + poi.ryo, poi.id).toBeGreaterThan(0);
      }
      if (poi.kind === 'vault') {
        const item = content.items.find((x) => x.id === poi.item);
        expect(item?.scroll, poi.id).toBeTruthy();
      }
    }
  });

  it('give the fortress vault the whole scroll of the Fire Dragon Flame Bullet, behind rubble', () => {
    const vault = content.cells.find((c) => c.id === 'core:skhovyshche_fortetsi');
    expect(vault?.key).toBe('rubble');
    expect(vault?.pois).toEqual([
      { id: expect.any(String), kind: 'vault', item: 'core:scroll_fire_dragon_flame_bullet' },
    ]);
  });
});

describe('cell keys', () => {
  const techIds = new Set(content.techniques.map((t) => t.id));
  const walk = (req: Req, out: Req[] = []): Req[] => {
    out.push(req);
    if (req.t === 'all' || req.t === 'any') for (const r of req.of) walk(r, out);
    return out;
  };

  it('define every kind of key and only existing techniques', () => {
    for (const key of CELL_KEYS) {
      expect(content.cellKeys[key], key).toBeTruthy();
      for (const r of walk(content.cellKeys[key])) {
        if (r.t === 'technique') expect(techIds.has(r.id), `${key}: ${r.id}`).toBe(true);
      }
    }
  });

  it('follow the slice', () => {
    expect(content.cellKeys.rock).toEqual({ t: 'skill', skill: 'cc', level: 15 });
    expect(content.cellKeys.water).toEqual({ t: 'skill', skill: 'cc', level: 30 });
    expect(content.cellKeys.rubble).toEqual({ t: 'technique', id: 'core:hiding_like_a_mole' });
  });

  it('use every kind of key on some cell', () => {
    for (const key of CELL_KEYS) {
      expect(
        content.cells.some((c) => c.key === key),
        key,
      ).toBe(true);
    }
  });
});
