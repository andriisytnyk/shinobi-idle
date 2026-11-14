# Архітектурний контракт

Обов'язковий для всіх задач. Якщо задача вимагає відступити від нього — спершу змінюється цей файл окремим рішенням оркестратора.

## Пакети

| Пакет | Шлях | Що містить | Від кого залежить |
| --- | --- | --- | --- |
| `@shinobi/content` | `packages/content` | Схеми Zod і типи контенту, згенеровані дані, тексти `uk`, валідатор замкненості | — |
| `@shinobi/core` | `packages/core` | Стан гри, `advance`, `dispatch`, усі правила | типи й дані `content` передаються параметром |
| `@shinobi/sim` | `packages/sim` | Боти, звіти балансу, CLI | `core`, `content` |
| `@shinobi/web` | `apps/web` | Svelte 5 + Vite, IndexedDB, UI | `core`, `content` |

Пакети споживаються як вихідний TypeScript (`"exports": {".": "./src/index.ts"}`), без окремої збірки.

## Час і випадковість

- Час — цілі мілісекунди ігрового часу в `state.now`.
- `advance(state, ms, content)` іде подіями: шукає найближчу подію (кінець дії, касту, перезарядки, секундний тік ефектів, тік села, загоєння Рани) і стрибає до неї. Жодних циклів по фіксованих кроках.
- RNG — `sfc32` із сідом; стан потоків лежить у `state.rng` (`action`, `combat`, `loot`, `world`). Аналіз бою працює на клоні стану з власним сідом.
- У `core` заборонені `Date`, `Math.random`, `performance`, `window`, `document`, `setTimeout`.

## Стан

`GameState` — звичайний об'єкт, що серіалізується в JSON: без класів, `Map`, `Set`, функцій. Змінюється лише всередині `advance` і `dispatch`.

```ts
interface GameState {
  v: number;                       // версія формату збереження
  now: number;                     // ігровий час, мс
  rng: Record<string, [number, number, number, number]>;
  player: { name: string; rank: 'student' | 'genin' | 'chunin'; natures: NatureId[] };
  skills: Record<SkillId, { xp: number }>;
  mastery: Record<string, { xp: number }>;      // ключ — id майстерності
  pools: Record<SkillId, { xp: number }>;
  bank: Record<string, number>;
  currencies: { ryo: number; rep: number; intel: number };
  known: Record<string, true>;                  // відкриті техніки, рецепти тощо
  slots: ActionSlot[];                          // слоти дій; у слоті частка швидкості
  flags: Record<string, true | number>;
  // далі додають етапи: combat, loadouts, pouch, wounds, bingo, missions, world, village, quests, goal, stats
}
interface ActionSlot { action: { kind: string; id: string } | null; progress: number; share: number }
```

Кожен етап додає свої гілки стану й підвищує `v` із міграцією.

## Команди й події

- UI та боти змінюють гру лише через `dispatch(state, command, content)`. Команда — об'єкт `{ type: 'action.start', ... }`. Результат — `{ ok: true }` або `{ ok: false, reason: <ключ локалізації> }`.
- Ядро повідомляє про разові події через `state.events` (рівень, Майстерність, предмет, крок доручення, рядок журналу бою). Черга не зберігається; UI її вичитує й очищає.

## Вимоги

Одне дерево умов для відкриття технік, чеклістів, етапів місій, цілей доручень і закріпленої мети:

```ts
type Req =
  | { t: 'skill'; skill: SkillId; level: number }
  | { t: 'technique'; id: string } | { t: 'rank'; rank: Rank } | { t: 'nature'; nature: NatureId }
  | { t: 'item'; id: string; n: number } | { t: 'quest'; id: string; step?: number }
  | { t: 'building'; id: string; level: number } | { t: 'flag'; id: string; n?: number }
  | { t: 'all'; of: Req[] } | { t: 'any'; of: Req[] };
```

`evalReq(state, req, content)` повертає дерево з полями `met`, `current`, `target`, `ref` (на що посилається рядок) і `children`.

## Модифікатори

Будь-який бонус — запис `{ key, op: 'add' | 'mul', value, group: 'character' | 'village' | 'items', source: EntityRef | string }`. Ключі — рядки виду `xp.skill.tai`, `xp.all`, `interval.skill.herb`, `cost.chakra`, `mission.duration`. У межах групи значення додаються, групи перемножуються. `getMod(state, key, content)` повертає підсумок і список складників — UI показує його на кожному відсотку.

## Сутності й посилання

- Ідентифікатори контенту — `core:<slug>`; навички мають короткі id (`tai`, `katon`).
- `EntityRef = { kind, id }`, де `kind` — `skill`, `technique`, `item`, `recipe`, `mission`, `enemy`, `region`, `building`, `quest`, `gear`, `seal`.
- Маршрути UI — хеш: `#/skill/tai`, `#/technique/core:great_fireball`, `#/item/core:mint` тощо.
- **Правило посилань:** де б у UI не стояла назва сутності — у вимогах, рецептах, етапах місій, таблицях луту, підказках, журналі — вона є компонентом `EntityLink` і веде на сторінку цієї сутності. Голий текст із назвою сутності — помилка рев'ю.
- Кожна сутність контенту має назву й опис (`name`, `desc` — ключі локалізації). Валідатор не пропускає сутність без опису.

## Збереження

`{ v, savedAt, state }` у JSON; `savedAt` — настінний час, який дає адаптер платформи. Міграції — масив функцій `v → v+1`. Веб-адаптер пише в IndexedDB раз на 10 с і при згортанні вкладки; експорт і імпорт — рядком base64. Офлайн: при завантаженні `advance` на `min(зараз − savedAt, 12 год)`.

## UI

- Svelte 5 з рунами, без SvelteKit; власний мінімальний хеш-роутер.
- Сховище `game.svelte.ts` тримає стан у `$state.raw` і лічильник оновлень; цикл гри викликає `advance` і збільшує лічильник 10 разів на секунду.
- Кольори, шрифти, відступи — лише CSS-змінні з документа про візуальний стиль.
- Тексти — `t(key, params)`; українська множина через `Intl.PluralRules`.
- Іконки — компонент `Icon` із реєстром SVG; техніки без власної іконки отримують складену: колір природи, знак ролі.

## Тести

- Vitest у кожному пакеті. Для кожного правила ядра — тест; для `advance` — тест детермінізму (однаковий сід і команди дають однаковий стан).
- Валідатор замкненості контенту — тести `packages/content`.
- Наскрізний тест Playwright — з етапу 8.
