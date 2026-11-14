# Canon technique check (Narutopedia + official databooks)

Generated from `techniques_in_map.json` (168 entries). The data is in `canon_techniques.json` (same order; each entry's `notes` names its sources).

## How the data was obtained (read first)

- **Narutopedia infoboxes could not be read.** The web-fetch tool returns only the article body text; the infobox with rank, hand seals, classification and range is dropped. Category, Property and Concept pages (e.g. `Category:A-rank_techniques`) failed with client errors, and the MediaWiki API (`naruto.fandom.com/api.php`) is blocked by this session's network policy (HTTP 403). Narutopedia was still used to verify official titles (via search results), descriptions, users and media (manga / anime / game).
- **Ranks, classification and range come from the official databooks**, through English translations on *The Narutoversity*: [Databook 1 (Rin no Sho)](https://narutoversity.wordpress.com/first-databook-jutsu-files/), [Databook 2 (Tō no Sho)](https://narutoversity.wordpress.com/second-databook-jutsu-files/), [Databook 4 (Jin no Sho)](https://narutoversity.wordpress.com/fourth-databook-jutsu-files/), [Databook 4 mini-files](https://narutoversity.wordpress.com/fourth-databook-mini-jutsu-files/), and a [databook-based elemental compilation](https://narutoversity.wordpress.com/2018/12/01/elemental-ninjutsu-compilation/) that also covers Databook 3 (Sha no Sho) items. The compilation gives rank and user only. Narutopedia's own ranks come from these same databooks, but a fan translation summarised by a tool can contain transcription errors. Spot-check high-impact entries against Narutopedia in a normal browser.
- `rank: "none"` means a databook or the wiki explicitly gives no rank (e.g. hiden or kekkei genkai techniques, single gates, mini-file entries). `rank: null` means not verified (no rank source could be read).
- **Hand seals are mostly null.** Only a few sequences could be confirmed, from secondary sources (Sportskeeda, MyAnimeList, Looper/GameRant cross-checks): Clone, Summoning, Great Fireball, Chidori (with a conflict noted), Water Dragon Bullet (44), Water Shark Bullet. Rasengan and Hiding in Ash and Dust are confirmed to need no seals. `seals: []` means no seals needed (Rasengan, Hiding in Ash and Dust, and taijutsu/gate entries); null means unverified.
- In general, a null field means unverified, not 'none'.

## Counts per canon rank

| Rank | Count |
|---|---|
| S | 7 |
| A | 18 |
| B | 32 |
| C | 17 |
| D | 10 |
| E | 3 |
| no rank (explicit) | 22 |
| unverified (null) | 44 |
| **canon total** | **153** |
| non-canon / generic (no lookup) | 15 |

Non-canon / generic entries: #21 Тренувальна лялька, #22 Лялька-метальник, #24 Лялька-приманка, #27 Лялька-скорпіон, #31 Лялька-павук, #43 Техніка запечатування, #118 Кидок куная, #123 Кидок кусаріґами, #124 Отруйні сенбони, #125 Вибухові кунаї, #136 Сортування поранених, #138 Нейтралізація отрути, #140 Регенерація тканин, #143 Збирання природної енергії, #144 Відчуття природи.

## Level band vs canon rank: mismatches

Rule: D 1-30, C 30-50, B 50-70, A 70-90, S 90-99. Canon E counts as D. Boundary levels (30/50/70/90) are accepted for either neighbouring rank. Only entries with a verified letter rank are checked.

**52 of 87 ranked canon techniques fall outside their band.**

| # | Skill | Technique (uk / en) | Level | Level band | Canon rank | Band for canon rank | Direction |
|---|---|---|---|---|---|---|---|
| 6 | tai | Передній лотос / Front Lotus | 30 | D/C | B | 50-70 | too early (rank higher than band) |
| 11 | tai | Ступня небесного болю / Heavenly Foot of Pain | 55 | B | C | 30-50 | too late (rank lower than band) |
| 13 | tai | П'яний кулак / Drunken Fist | 65 | B | C | 30-50 | too late (rank lower than band) |
| 19 | tai | Денний тигр / Daytime Tiger | 95 | S | A | 70-90 | too late (rank lower than band) |
| 39 | nin | Техніка камуфляжного ховання / Hiding with Camouflage Technique | 15 | D | A | 70-90 | too early (rank higher than band) |
| 40 | nin | Техніка призову / Summoning Technique | 20 | D | C | 30-50 | too early (rank higher than band) |
| 42 | nin | Техніка тіньового клонування / Shadow Clone Technique | 30 | D/C | B | 50-70 | too early (rank higher than band) |
| 44 | nin | Техніка тіньового клонування сюрікенів / Shuriken Shadow Clone Technique | 40 | C | A | 70-90 | too early (rank higher than band) |
| 45 | nin | Печатка п'яти елементів / Five Elements Seal | 50 | C/B | A | 70-90 | too early (rank higher than band) |
| 46 | nin | Вибух тіньового клону / Shadow Clone Explosion | 55 | B | A | 70-90 | too early (rank higher than band) |
| 47 | nin | Техніка множинного тіньового клонування / Multiple Shadow Clone Technique | 60 | B | A | 70-90 | too early (rank higher than band) |
| 48 | nin | Техніка телескопа / Telescope Technique | 65 | B | A | 70-90 | too early (rank higher than band) |
| 51 | nin | Приховані тіньові руки-змії / Hidden Shadow Snake Hands | 80 | A | C | 30-50 | too late (rank lower than band) |
| 52 | nin | Голковий Дзідзо / Needle Jizō | 90 | A/S | B | 50-70 | too late (rank lower than band) |
| 54 | katon | Техніка вогню фенікса-мудреця / Phoenix Sage Fire Technique | 1 | D | C | 30-50 | too early (rank higher than band) |
| 55 | katon | Техніка великої вогняної кулі / Great Fireball Technique | 5 | D | C | 30-50 | too early (rank higher than band) |
| 56 | katon | Техніка вогню дракона / Dragon Fire Technique | 10 | D | C | 30-50 | too early (rank higher than band) |
| 59 | katon | Полум'яна куля вогняного дракона / Fire Dragon Flame Bullet | 40 | C | B | 50-70 | too early (rank higher than band) |
| 64 | katon | Величне руйнівне полум'я / Majestic Destroyer Flame | 90 | A/S | B | 50-70 | too late (rank lower than band) |
| 65 | futon | Шквальна долоня / Gale Palm | 1 | D | C | 30-50 | too early (rank higher than band) |
| 66 | futon | Великий прорив / Great Breakthrough | 10 | D | C | 30-50 | too early (rank higher than band) |
| 67 | futon | Лезо вітру / Blade of Wind | 20 | D | A | 70-90 | too early (rank higher than band) |
| 68 | futon | Вакуумна хвиля / Vacuum Wave | 25 | D | B | 50-70 | too early (rank higher than band) |
| 70 | futon | Вакуумна сфера / Vacuum Sphere | 40 | C | B | 50-70 | too early (rank higher than band) |
| 74 | futon | Велика вакуумна сфера / Vacuum Great Sphere | 80 | A | B | 50-70 | too late (rank lower than band) |
| 78 | raiton | Хибна темрява / False Darkness | 20 | D | B | 50-70 | too early (rank higher than band) |
| 79 | raiton | Чорна пантера / Black Panther | 30 | D/C | B | 50-70 | too early (rank higher than band) |
| 80 | raiton | Чідорі / Chidori | 40 | C | A | 70-90 | too early (rank higher than band) |
| 81 | raiton | Райкірі / Lightning Blade | 50 | C/B | S | 90-99 | too early (rank higher than band) |
| 82 | raiton | Ласо блискавки / Lightning Release: Lariat | 55 | B | A | 70-90 | too early (rank higher than band) |
| 83 | raiton | Ікло блискавичного звіра / Lightning Beast Tracking Fang | 60 | B | C | 30-50 | too late (rank lower than band) |
| 85 | raiton | Броня блискавки / Lightning Release Armour | 80 | A | B | 50-70 | too late (rank lower than band) |
| 87 | doton | Техніка ховання як кріт / Hiding like a Mole Technique | 1 | D | C | 30-50 | too early (rank higher than band) |
| 89 | doton | Стіна земляного стилю / Earth Style Wall | 20 | D | B | 50-70 | too early (rank higher than band) |
| 90 | doton | Земляний спис / Earth Spear | 30 | D/C | B | 50-70 | too early (rank higher than band) |
| 95 | doton | Техніка легкої скелі / Light Weight Rock Technique | 80 | A | B | 50-70 | too late (rank lower than band) |
| 96 | doton | Техніка обтяженої скелі / Added Weight Rock Technique | 90 | A/S | B | 50-70 | too late (rank lower than band) |
| 97 | suiton | Техніка водяного клону / Water Clone Technique | 1 | D | C | 30-50 | too early (rank higher than band) |
| 98 | suiton | Постріл / Gunshot | 5 | D | C | 30-50 | too early (rank higher than band) |
| 100 | suiton | Стіна водяного табору / Water Encampment Wall | 20 | D | B | 50-70 | too early (rank higher than band) |
| 102 | suiton | Куля водяного дракона / Water Dragon Bullet | 40 | C | B | 50-70 | too early (rank higher than band) |
| 107 | suiton | Тисяча ненажерливих акул / Thousand Feeding Sharks | 90 | A/S | B | 50-70 | too late (rank lower than band) |
| 112 | gen | Техніка темряви / Bringer-of-Darkness Technique | 30 | D/C | A | 70-90 | too early (rank higher than band) |
| 113 | gen | Техніка храму нірвани / Temple of Nirvana Technique | 40 | C | A | 70-90 | too early (rank higher than band) |
| 121 | buki | Потрійна атака вітряка / Windmill Triple Attack | 20 | D | C | 30-50 | too early (rank higher than band) |
| 126 | buki | Танець півмісяця / Crescent Moon Dance | 55 | B | A | 70-90 | too early (rank higher than band) |
| 130 | mednin | Техніка долоні, що лікує / Mystical Palm Technique | 1 | D | A | 70-90 | too early (rank higher than band) |
| 133 | mednin | Отруйний туман / Poison Mist | 25 | D | B | 50-70 | too early (rank higher than band) |
| 135 | mednin | Техніка розладу шляхів тіла / Body Pathway Derangement | 40 | C | A | 70-90 | too early (rank higher than band) |
| 137 | mednin | Техніка лікувального відновлення й регенерації / Healing Resuscitation Regeneration Technique | 55 | B | A | 70-90 | too early (rank higher than band) |
| 141 | mednin | Відродження творіння / Creation Rebirth | 85 | A | S | 90-99 | too early (rank higher than band) |
| 155 | sage | Мистецтво мудреця: Расенсюрікен / Sage Art: Rasenshuriken | 75 | A | S | 90-99 | too early (rank higher than band) |

**Placed too early** (canon rank above the level band), 40 entries; largest gaps first: Mystical Palm Technique (A at 1); Hiding with Camouflage Technique (A at 15); Blade of Wind (A at 20); Bringer-of-Darkness Technique (A at 30); Lightning Blade (S at 50); False Darkness (B at 20); Earth Style Wall (B at 20); Water Encampment Wall (B at 20); Vacuum Wave (B at 25); Poison Mist (B at 25); Front Lotus (B at 30); Shadow Clone Technique (B at 30).

**Placed too late** (canon rank below the level band), 12 entries: Hidden Shadow Snake Hands (C at 80); Daytime Tiger (A at 95); Needle Jizō (B at 90); Majestic Destroyer Flame (B at 90); Added Weight Rock Technique (B at 90); Thousand Feeding Sharks (B at 90); Vacuum Great Sphere (B at 80); Lightning Release Armour (B at 80); Light Weight Rock Technique (B at 80); Drunken Fist (C at 65); Lightning Beast Tracking Fang (C at 60); Heavenly Foot of Pain (C at 55).

Unranked or unverified canon entries (not in the table): #1 Leaf Rising Wind (unverified), #5 Gate of Opening (no rank), #8 Gate of Healing (no rank), #9 Cherry Blossom Impact (unverified), #10 Gate of Life (no rank), #12 Gate of Pain (no rank), #14 Gate of Limit (no rank), #15 Reverse Lotus (unverified), #16 Gate of View (no rank), #17 Morning Peacock (unverified), #18 Gate of Wonder (no rank), #23 Crow (unverified), #25 Black Ant (unverified), #26 Salamander (unverified), #28 Hiruko (unverified), #29 Mother and Father (unverified), #30 Third Kazekage (unverified), #32 White Secret Technique: Chikamatsu's Collection of Ten Puppets (no rank), #33 Red Secret Technique: Performance of a Hundred Puppets (no rank), #41 Sensor Technique (unverified), #50 Transparent Escape Technique (unverified), #57 Hiding in Ash Technique (no rank), #58 Running Fire (unverified), #62 Great Fire Destruction (no rank), #63 Great Flame Flower (unverified), #72 Vacuum Blade (unverified), #76 Laser Circus (no rank), #77 Four Pillar Bind (no rank), #84 Purple Lightning (unverified), #91 Mud River (unverified), #92 Earth Dragon Bullet (unverified), #104 Water Severing Wave (no rank), #108 Release (unverified), #109 Sly Mind Affect Technique (unverified), #116 Mirror Heaven and Earth Change (no rank), #117 Toad Confrontation Chant (unverified), #119 Manipulated Shuriken Technique (unverified), #120 Demon Wind Shuriken: Windmill of Shadows (no rank), #122 Rising Twin Dragons (unverified), #128 Silent Killing Technique (unverified), #131 Delicate Illness Extraction Technique (unverified), #132 Chakra Scalpel (unverified), #134 Chakra Transfer Technique (unverified), #139 Strength of a Hundred Seal (unverified), #142 One's Own Life Reincarnation (unverified), #145 Sage Mode (unverified), #146 Sage Mode (unverified), #147 Sage Mode (unverified), #148 Frog Kata (unverified), #149 Frog Call (no rank), #150 Sage Art: Goemon (unverified), #152 Sage Art: Massive Rasengan (unverified), #153 Sage Art: Inorganic Animation (no rank), #154 Sage Art: White Rage (unverified), #156 Perfect Sage Mode (unverified), #157 Wood Release: Sage Art: True Several Thousand Hands (no rank), #158 Wood Clone Technique (unverified), #159 Wood Locking Wall (unverified), #160 Four Pillar House Technique (unverified), #161 Four Pillar Prison Technique (unverified), #162 Great Forest Technique (unverified), #163 Wood Dragon Technique (unverified), #164 Wood Human Technique (no rank), #165 Deep Forest Emergence (unverified), #166 Nativity of a World of Trees (no rank), #167 Wood Golem Technique (no rank).

## Naming corrections (game `en` vs canon / Narutopedia title)

Only wrong or misleading names are listed. Missing 'Fire Release:' / 'Wind Release:' / 'Water Release:' / 'Lightning Release:' / 'Earth Release:' / 'Wood Release:' prefixes are a style choice and are not listed individually.

| # | Game `en` | Canon / Narutopedia name | Issue |
|---|---|---|---|
| 4 | Leaf Hurricane | (none) - English-anime name used for both Leaf Whirlwind and Leaf Gale | Duplicate of #0/#3. Replace with e.g. Leaf Great Whirlwind (C) or Leaf Strong Whirlwind (B) |
| 20 | Gate of Death: Evening Elephant, Night Guy | Eight Gates (8th gate) + Evening Elephant (A) + Night Guy (S) | Composite entry, fine as a design choice |
| 23 | Crow | Karasu | Wiki title is the Japanese name; 'Crow' is the literal meaning |
| 25 | Black Ant | Kuroari | As above |
| 26 | Salamander | Sanshōuo (databook: Black Secret Technique: Salamander) | As above |
| 32 | White Secret Technique: Chikamatsu's Collection of Ten Puppets | White Secret Technique: The Chikamatsu Collection of Ten Puppets | Minor wording |
| 41 | Sensor Technique | Sensing Technique | Wrong title |
| 43 | Sealing Technique | Fūinjutsu (a class of techniques) | Generic, not a single canon technique |
| 46 | Shadow Clone Explosion | Clone Great Explosion | Wrong title |
| 57 | Hiding in Ash Technique | Fire Release: Hiding in Ash and Dust Technique | Wrong title |
| 64 | Majestic Destroyer Flame | Fire Release: Great Fire Annihilation | Not the wiki/databook title (probably a dub name) |
| 76 | Laser Circus | Storm Release: Laser Circus | Storm Release (kekkei genkai), not Lightning Release |
| 81 | Lightning Blade | Lightning Cutter (Raikiri) | 'Lightning Blade' is the anime dub name, not the wiki title |
| 84 | Purple Lightning | Lightning Release: Purple Electricity | Wrong title; Boruto-era / novel technique |
| 85 | Lightning Release Armour | Lightning Release Chakra Mode | Wrong title |
| 88 | Headhunter Jutsu | Earth Release: Double Suicide Decapitation Technique | Not the wiki/databook title (probably a dub name) |
| 89 | Earth Style Wall | Earth Release: Earth-Style Wall | Missing hyphen/prefix |
| 91 | Mud River | Earth Release: Earth Flow River | Wrong title |
| 93 | Earth Flow Rampart | Earth Release: Earth-Style Rampart | Wrong title |
| 94 | Earth Dome Prison | Earth Release Barrier: Earth Prison Dome of Magnificent Nothingness | Wrong title |
| 95 | Light Weight Rock Technique | Earth Release: Light-Weight Rock Technique | Hyphen/prefix |
| 96 | Added Weight Rock Technique | Earth Release: Added-Weight Rock Technique | Hyphen/prefix |
| 99 | Hidden Mist Technique | Hiding in Mist Technique | Wiki/databook title differs (anime name) |
| 100 | Water Encampment Wall | Water Release: Water Formation Wall | Wrong title |
| 105 | Bursting Water Collision Waves | Water Release: Exploding Water Colliding Wave | Wrong title |
| 107 | Thousand Feeding Sharks | Water Release: A Thousand Feeding Sharks | Missing 'A'/prefix |
| 108 | Release | Genjutsu Dissipation (Genjutsu Kai) | Wiki name for dispelling genjutsu |
| 110 | Hell Viewing Technique | Demonic Illusion: Hell Viewing Technique | Missing prefix |
| 114 | Tree Binding Death | Demonic Illusion: Tree Binding Death | Missing prefix |
| 116 | Mirror Heaven and Earth Change | Demonic Illusion: Mirror Heaven and Earth Change | Missing prefix; needs Sharingan |
| 117 | Toad Confrontation Chant | Demonic Illusion: Toad Confrontation Chant | Missing prefix; cast by the two sage toads |
| 120 | Demon Wind Shuriken: Windmill of Shadows | Fūma Shuriken (nickname 'Shadow Windmill') | A weapon, not a technique |
| 121 | Windmill Triple Attack | Manipulating Windmill Triple Blades | Wrong title |
| 122 | Rising Twin Dragons | Twin Rising Dragons | Word order |
| 126 | Crescent Moon Dance | Dance of the Crescent Moon | Word order |
| 128 | Silent Killing Technique | Silent Killing | Minor |
| 129 | Kusanagi Sword: Chidori Katana | Sword of Kusanagi: Chidori Katana | Minor |
| 151 | Sage Art: Gamayu Endan | Fire Release: Toad Oil Flame Bullet (Katon: Gamayu Endan) | Not a Sage Art: Jiraiya + Gamabunta combination, B-rank |
| 152 | Sage Art: Massive Rasengan | Sage Art: Ultra-Big Ball Rasengan | 'Massive' is the English TV name |
| 153 | Sage Art: Inorganic Animation | Sage Art: Inorganic Reincarnation | Wrong title |
| 154 | Sage Art: White Rage | Sage Art: White Rage Technique | Minor |
| 157 | Wood Release: Sage Art: True Several Thousand Hands | Sage Art Wood Release: True Several Thousand Hands | Word order |
| 160 | Four Pillar House Technique | Wood Release: Four-Pillar House Technique | Hyphen/prefix |
| 161 | Four Pillar Prison Technique | Wood Release: Four-Pillar Prison Technique | Hyphen/prefix |
| 165 | Deep Forest Emergence | Probably Nativity of a World of Trees / Nativity of a Sea of Trees (unverified) | Not a wiki title; likely duplicate of #166 |
| 166 | Nativity of a World of Trees | Wood Release Secret Technique: Nativity of a World of Trees | Missing prefix |
| 167 | Wood Golem Technique | Probably Wood Release: Wood Human Technique (unverified) | Not a wiki title; likely duplicate of #164 |

## Other canon-fidelity flags

- **Not manga canon:** Great Flame Flower (#63, game-origin, later Boruto anime), Vacuum Blade (#72, anime only), Earth Dragon Bullet (#92, anime technique), Transparent Escape (#50, only mentioned in the manga; shown in the anime), Running Fire (#58, probably movie-only, unverified), Purple Electricity (#84, novel/Boruto era).
- **Canon user is not a human shinobi:** Gunshot (#98, Gamabunta), Frog Call (#149, Fukasaku & Shima), Toad Confrontation Chant (#117, the two sage toads), Toad Oil Flame Bullet (#151, needs Gamabunta), Sage Art: Goemon (#150, needs Jiraiya + both toads).
- **Kekkei genkai / special requirements:** Laser Circus (Storm Release), Mirror Heaven and Earth Change (Sharingan), Third Kazekage puppet (Magnet Release), all Wood Release entries (Wood Release kekkei genkai), Multiple Shadow Clone (forbidden technique), One's Own Life Reincarnation (forbidden; kills the user when reviving the dead), Gate of Death (kills the user).
- **Slug Sage Mode (#147):** no canon user could be verified. Check this before keeping it as a canon option.
- **Cherry Blossom Impact (#9)** is described by Narutopedia as medical ninjutsu / chakra-enhanced strength rather than taijutsu.
- **Raikiri / Lightning Cutter** reads S-rank in the Databook 1 translation (Chidori is A). If your design treats them as the same tier, note this difference.

## How to fill the remaining gaps

If `naruto.fandom.com` is added to this environment's allowed network domains, the MediaWiki API (`api.php?action=query&prop=revisions&rvprop=content`) returns each article's infobox wikitext (rank, hand seals, classification, range, users) for 50 pages per request. That would fill every null in a few minutes. The alternative is checking the remaining infoboxes by hand in a browser.
