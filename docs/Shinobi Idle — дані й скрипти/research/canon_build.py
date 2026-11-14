#!/usr/bin/env python3
"""Build canon_techniques.json and canon_techniques_summary.md from verified research data."""
import json
from collections import Counter, OrderedDict

SRC_IN = "/home/claude/research/techniques_in_map.json"
OUT_JSON = "/home/claude/research/canon_techniques.json"
OUT_MD = "/home/claude/research/canon_techniques_summary.md"

NP = "https://naruto.fandom.com/wiki/"
DB1 = "https://narutoversity.wordpress.com/first-databook-jutsu-files/"
DB2 = "https://narutoversity.wordpress.com/second-databook-jutsu-files/"
DB4 = "https://narutoversity.wordpress.com/fourth-databook-jutsu-files/"
DB4M = "https://narutoversity.wordpress.com/fourth-databook-mini-jutsu-files/"
COMP = "https://narutoversity.wordpress.com/2018/12/01/elemental-ninjutsu-compilation/"
SK = "https://www.sportskeeda.com/anime/10-naruto-hand-signs-difficult-learn"
MAL = "https://myanimelist.net/featured/773/Naruto_Hand_Signs_Guide"
LOOPER = "https://www.looper.com/1219098/every-hand-sign-in-naruto-and-what-they-represent-explained/"

R_DB1 = "Rank/class/range: Databook 1 (Hiden: Rin no Sho), English translation at " + DB1
R_DB2 = "Rank/class/range: Databook 2 (Tō no Sho), English translation at " + DB2
R_DB4 = "Rank/class/range: Databook 4 (Jin no Sho), English translation at " + DB4
R_COMP = ("Rank: databook-based compilation at " + COMP +
          " (gives rank + user only; classification/range not given there)")
NO_IB = "Narutopedia infobox (rank/seals/class) could not be read by the fetch tool"
TAI_SEALS = "Taijutsu: no hand seals required"

# Each entry: index -> dict of fields (missing fields default to None).
D = {}

def e(i, **kw):
    D[i] = kw

# ---------------- Taijutsu ----------------
e(0, canon=True, rank="D", seals=[], users=["Rock Lee"], classification="Taijutsu, Offensive",
  range="Close range", summary="A spinning chain of kicks that rises from a low sweep to a high kick and ends with a heel drop.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Leaf_Whirlwind (manga). The English anime has used 'Leaf Hurricane' for this technique and for Leaf Gale. {TAI_SEALS}.")
e(1, canon=True, users=None, classification=None, source_url=NP + "Leaf_Rising_Wind",
  notes="Narutopedia page exists (title verified via search), but the page could not be read (client_error), so rank, users and description are unverified. Not among the databook 1/2/4 entries that were checked.")
e(2, canon=True, rank="D", seals=[], users=["Might Guy"], classification="Taijutsu, Offensive", range="Close range",
  summary="Guy's showy, exaggerated flying front kick, used to surprise and intimidate the enemy.",
  source_url=DB2, notes=f"{R_DB2}. Narutopedia: {NP}Dynamic_Entry. {TAI_SEALS}.")
e(3, canon=True, rank="D", seals=[], users=["Rock Lee"], classification="Taijutsu, Offensive", range="Close range",
  summary="A fast rear-spinning low kick that can knock even a large opponent off their feet.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Leaf_Gale. {TAI_SEALS}.")
e(4, canon=True, rank="D", seals=[], users=["Rock Lee"], classification="Taijutsu, Offensive", range="Close range",
  summary="Not a separate technique. 'Leaf Hurricane' is the English-anime name that was used for both Leaf Whirlwind and Leaf Gale.",
  source_url=NP + "Leaf_Whirlwind",
  notes="NAMING: duplicate. Narutopedia (Leaf Whirlwind article) says the English anime has used 'Leaf Hurricane' for both Leaf Whirlwind and Leaf Gale. Both are D-rank (Databook 1), so the rank is D either way. Suggested distinct canon replacement: Leaf Great Whirlwind (Konoha Daisenpū; C-rank, Rock Lee; Databook 2) or Leaf Strong Whirlwind (B-rank, Might Guy; Databook 2).")
GATE_NOTE = ("Individual gates are not ranked. Databook 4 ranks 'Eight Gates Released Formation' (opening all eight) A-rank, "
             "Taijutsu, Supplementary (users Might Guy, Might Duy) - " + DB4 + ". Gate order/effects from Narutopedia " + NP + "Eight_Gates.")
e(5, canon=True, rank="none", seals=[], users=["Might Guy", "Rock Lee"], classification="Taijutsu (Eight Gates), Supplementary",
  summary="1st gate: removes the brain's limiters (mental inhibitions); opening it enables the Front Lotus.",
  source_url=NP + "Eight_Gates", notes=GATE_NOTE)
e(6, canon=True, rank="B", seals=[], users=["Rock Lee"], classification="Taijutsu, Offensive", range="Close range",
  summary="Lee kicks the enemy skyward, binds them in mid-air, then spins and drives them headfirst into the ground. Requires the 1st gate.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Front_Lotus; gate link from {NP}Eight_Gates. {TAI_SEALS}.")
e(7, canon=True, rank="C", seals=[], users=["Sasuke Uchiha"], classification="Taijutsu, Offensive", range="Close range",
  summary="A rapid combo that keeps the opponent airborne and builds force until a final blow sends them crashing down.",
  source_url=DB1, notes=f"{R_DB1}. {TAI_SEALS}.")
e(8, canon=True, rank="none", seals=[], users=["Might Guy", "Rock Lee"], classification="Taijutsu (Eight Gates), Supplementary",
  summary="2nd gate: raises strength and speed and rapidly restores the body from exhaustion.",
  source_url=NP + "Eight_Gates", notes=GATE_NOTE)
e(9, canon=True, users=["Tsunade", "Sakura Haruno"], classification="Narutopedia describes it as medical ninjutsu / chakra-enhanced strength",
  summary="The user concentrates dense chakra in the fist and releases it on impact, damaging the target and shattering the ground.",
  seals=None, source_url=NP + "Cherry_Blossom_Impact",
  notes=f"Rank unverified ({NO_IB}). Article cites manga ch. 159 (Tsunade's finger-strike variant); Sarada also uses it. Narutopedia does not treat it as pure taijutsu.")
e(10, canon=True, rank="none", seals=[], users=["Might Guy", "Rock Lee"], classification="Taijutsu (Eight Gates), Supplementary",
  summary="3rd gate: skin turns red and veins bulge; this is the gate tied to the Reverse Lotus.",
  source_url=NP + "Eight_Gates", notes=GATE_NOTE)
e(11, canon=True, rank="C", seals=[], users=["Tsunade"], classification="Taijutsu, Offensive", range="Close range",
  summary="Tsunade puts her full strength into a falling heel strike that shatters the ground and anything nearby.",
  source_url=DB2, notes=f"{R_DB2}. Narutopedia: {NP}Heavenly_Foot_of_Pain. {TAI_SEALS}.")
e(12, canon=True, rank="none", seals=[], users=["Might Guy", "Rock Lee"], classification="Taijutsu (Eight Gates), Supplementary",
  summary="4th gate: opened during the Reverse Lotus; causes muscle tearing and nosebleeds.",
  source_url=NP + "Eight_Gates", notes=GATE_NOTE)
e(13, canon=True, rank="C", seals=[], users=["Rock Lee"], classification="Taijutsu, Offensive, Defensive", range="Close range",
  summary="Lee fights with erratic drunken movements that even he cannot predict, throwing opponents off guard.",
  source_url=DB2, notes=f"{R_DB2}. {TAI_SEALS}.")
e(14, canon=True, rank="none", seals=[], users=["Might Guy", "Rock Lee"], classification="Taijutsu (Eight Gates), Supplementary",
  summary="5th gate: opened for the Reverse Lotus's final blow; afterwards the limbs can suffer compound fractures.",
  source_url=NP + "Eight_Gates", notes=GATE_NOTE)
e(15, canon=True, seals=[], users=["Rock Lee"], classification="Taijutsu ('attack of last resort')",
  summary="With at least three gates open, Lee strikes from many directions, launches the target into the air and finishes with a crushing blow.",
  source_url=NP + "Reverse_Lotus",
  notes=f"Rank unverified: Databook 1 lists Reverse Lotus with no data block in the translation, and the {NO_IB}. Taught by Might Guy. Cites Rin no Sho and ch. 86.")
e(16, canon=True, rank="none", seals=[], users=["Might Guy"], classification="Taijutsu (Eight Gates), Supplementary",
  summary="6th gate: increases all abilities; tied to the Morning Peacock.",
  source_url=NP + "Eight_Gates", notes=GATE_NOTE)
e(17, canon=True, seals=[], users=None, classification="Taijutsu",
  summary="Taijutsu used with the 6th gate (Gate of View) open.",
  source_url=NP + "Eight_Gates",
  notes="Gate link from the Narutopedia Eight Gates article. The Morning Peacock page could not be read (client_error), so rank and users are unverified. Not in the Databook 1/2/4 translations that were checked (probably Databook 3, which is not transcribed).")
e(18, canon=True, rank="none", seals=[], users=["Might Guy"], classification="Taijutsu (Eight Gates), Supplementary",
  summary="7th gate: produces blue sweat that forms an aura; tied to the Daytime Tiger.",
  source_url=NP + "Eight_Gates", notes=GATE_NOTE)
e(19, canon=True, rank="A", seals=[], users=["Might Guy"], classification="Taijutsu, Offensive", range="Close to mid range",
  summary="With the 7th gate open, Guy throws a single punch of compressed air pressure that blasts apart the area around the target.",
  source_url=DB4, notes=f"{R_DB4}. Narutopedia: {NP}Daytime_Tiger. {TAI_SEALS}.")
e(20, canon=True, rank="S", seals=[], users=["Might Guy"], classification="Taijutsu, Offensive", range="Close range",
  summary="8th gate (at the heart) opened at the cost of the user's life: Evening Elephant is a barrage of air-cannon strikes; Night Guy is a kick wrapped in a burning chakra dragon.",
  source_url=DB4,
  notes=f"{R_DB4}. Combined entry: Evening Elephant = A-rank, Night Guy = S-rank (both Taijutsu, Offensive, Close range, Might Guy). Narutopedia Eight Gates says opening the 8th gate kills the user. {TAI_SEALS}.")

# ---------------- Puppets ----------------
PUP_RANK = "Puppets are tools, not ranked jutsu; no rank found in the sources read."
e(21, canon=False, notes="Generic, game-invented (no canon name). No lookup done.")
e(22, canon=False, notes="Generic, game-invented (no canon name). No lookup done.")
e(23, canon=True, rank=None, users=["Sasori (creator)", "Kankurō"], classification="Puppet (Puppet Technique)",
  summary="Three-eyed, four-armed puppet with hidden poison projectiles, smoke-bomb launchers and blades; works with Kuroari in combination attacks.",
  source_url=NP + "Karasu", notes=f"NAMING: Narutopedia title is 'Karasu' (literally 'Crow'). {PUP_RANK}")
e(24, canon=False, notes="Generic, game-invented (no canon name). No lookup done.")
e(25, canon=True, rank=None, users=["Kankurō"], classification="Puppet (Puppet Technique)",
  summary="Capture puppet that traps the target in its body; combined with Crow in 'Black Secret Technique: Machine One Shot' (B-rank, Kankurō).",
  source_url=DB2,
  notes=f"NAMING: Narutopedia title is 'Kuroari'. The Kuroari page could not be read (client_error); description comes from the Databook 2 entry for Machine One Shot. {PUP_RANK}")
e(26, canon=True, rank=None, users=["Kankurō"], classification="Puppet; Databook 4 lists 'Black Secret Technique: Salamander' as Ninjutsu",
  summary=None, source_url=DB4M,
  notes=f"NAMING: Narutopedia title is 'Sanshōuo' ({NP}Sansh%C5%8Duo). The page could not be read (client_error). Databook 4 mini-file lists 'Black Secret Technique: Salamander (Kurohigi: Sanshōuo)' for Kankurō with no rank. The shield role from the game draft is not verified here. {PUP_RANK}")
e(27, canon=False, notes="Generic, game-invented (no canon 'scorpion puppet'). No lookup done.")
e(28, canon=True, rank=None, users=["Sasori"], classification="Puppet armour",
  summary="Sasori's armour puppet, worn as a shell: extendable iron tail, senbon launchers in the mouth and arm, heavy back shell, poisoned weapons.",
  source_url=NP + "Hiruko", notes=PUP_RANK)
e(29, canon=True, rank=None, users=["Chiyo", "Sasori (creator)"], classification="Puppets",
  summary="Two puppets Sasori built to simulate parental love; Chiyo later fitted them with chakra shields, linked razor wires and weapons for combat. Kankurō later inherited them.",
  source_url=NP + "Mother_and_Father", notes=PUP_RANK)
e(30, canon=True, rank=None, users=["Sasori"], classification="Human puppet (Magnet Release kekkei genkai)",
  summary="Human puppet made from the Third Kazekage's body; it keeps his Magnet Release/Iron Sand and has built-in weapons coated in Sasori's poison.",
  source_url=NP + "Third_Kazekage_(puppet)",
  notes=f"{PUP_RANK} The databook-based compilation ({COMP}) lists 'Iron Sand Drizzle', 'Iron Sand Gathering Assault' and 'Iron Sand World Method' for the Third Kazekage, with no ranks.")
e(31, canon=False, notes="Generic, game-invented (no canon spider-thread puppet by this name). No lookup done.")
e(32, canon=True, rank="none", users=["Chiyo", "Monzaemon Chikamatsu (creator)"], classification="Puppet Technique",
  summary="Ten powerful puppets made by the first puppeteer, Monzaemon Chikamatsu, and controlled by Chiyo with one finger each; they attack and defend together.",
  source_url=NP + "White_Secret_Technique:_The_Chikamatsu_Collection_of_Ten_Puppets",
  notes="NAMING: Narutopedia title is 'White Secret Technique: The Chikamatsu Collection of Ten Puppets'. The article gives no formal rank.")
e(33, canon=True, rank="none", users=["Sasori"], classification="Puppet Technique",
  summary="Sasori releases over a hundred chakra threads from his chest and controls more than a hundred red-cloaked puppets from a summoning scroll.",
  source_url=NP + "Red_Secret_Technique:_Performance_of_a_Hundred_Puppets",
  notes="The article gives no rank. Manga technique; the anime adds details such as use from inside Hiruko.")

# ---------------- Ninjutsu ----------------
e(34, canon=True, rank="E", seals=["Ram", "Snake", "Tiger"], users=["Naruto Uzumaki", "Sakura Haruno"],
  classification="Ninjutsu, Supplementary", range=None,
  summary="Creates intangible illusory copies of the user that can only confuse enemies; usually combined with other jutsu.",
  source_url=DB1, notes=f"{R_DB1}. Seals from Sportskeeda ({SK}), a secondary source, because the {NO_IB}.")
e(35, canon=True, rank="E", users=["Naruto Uzumaki", "Iruka Umino"], classification="Ninjutsu, Supplementary",
  summary="Changes the user's appearance to impersonate people, animals or objects.",
  source_url=DB1, notes=f"{R_DB1}. Seals unverified ({NO_IB}).")
e(36, canon=True, rank="E", users=["Kakashi Hatake", "Naruto Uzumaki"], classification="Ninjutsu, Supplementary",
  summary="At the moment of an attack the user swaps places with a log or similar object, creating an opening to escape or counter.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Body_Replacement_Technique. Seals unverified.")
e(37, canon=True, rank="D", users=["Kakashi Hatake", "Gaara"], classification="Ninjutsu, Supplementary",
  summary="Chakra-powered movement so fast it looks like teleportation; chakra cost grows with distance and elevation.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Body_Flicker_Technique. Seals unverified.")
e(38, canon=True, rank="D", users=["Sasuke Uchiha"], classification="Ninjutsu, Offensive", range="Mid to long range",
  summary="Two shuriken thrown stacked together: one draws the enemy's attention while the hidden second one strikes from a blind spot.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Shadow_Shuriken_Technique.")
e(39, canon=True, rank="A", users=["Taiseki"], classification="Ninjutsu, Supplementary",
  summary="Bends light around the body with chakra so the user is nearly invisible; only the Sharingan, Byakugan or similar can see through it.",
  source_url=DB2, notes=f"{R_DB2}. Narutopedia: {NP}Hiding_with_Camouflage_Technique.")
e(40, canon=True, rank="C", seals=["Boar", "Dog", "Bird", "Monkey", "Ram"], users=["Naruto Uzumaki", "Kakashi Hatake"],
  classification="Ninjutsu, Offensive, Defensive, Supplementary", range="Any distance (summons anywhere)",
  summary="Calls a creature bound by a blood contract: blood is smeared on the hand and the palm is pressed to the ground or air at the summoning spot.",
  source_url=DB1,
  notes=f"{R_DB1}. Seals from Sportskeeda ({SK}); Looper and GameRant agree on five seals with Monkey fourth. Narutopedia {NP}Summoning_Technique.")
e(41, canon=True, rank=None, users=["Karin", "Nagato"], classification="Sensory technique (sensor-type ninja)",
  range="Varies between sensors",
  summary="Sensor-type ninja shape their chakra into a sensing form to locate and track targets by their chakra signatures.",
  source_url=NP + "Sensing_Technique",
  notes=f"NAMING: Narutopedia title is 'Sensing Technique'. Rank unverified ({NO_IB}). Other users: Kidōmaru, Gaara.")
e(42, canon=True, rank="B", seals=["Special: cross-shaped seal (index and middle fingers of both hands crossed)"],
  users=["Naruto Uzumaki", "Kakashi Hatake"], classification="Ninjutsu, Supplementary",
  summary="Creates solid clones that can fight and use the user's jutsu; chakra is split evenly and the clones' experience returns to the user when they are dispelled.",
  source_url=DB1,
  notes=f"{R_DB1}. Creator: Tobirama Senju (Narutopedia {NP}Shadow_Clone_Technique). Seal described by the MyAnimeList hand-signs guide ({MAL}).")
e(43, canon=False, rank=None, classification="Fūinjutsu (a class of techniques)",
  summary="Generic: in canon, 'sealing' is a whole class of techniques (Fūinjutsu), not one technique with a rank.",
  source_url=None,
  notes="Treated as non-canon because it is generic. Suggest naming a specific canon sealing technique. Ranked canon examples: Five Elements Seal (A), Evil Sealing Method (A), Fire Sealing Method (B) (Databooks 1-2).")
e(44, canon=True, rank="A", users=["Hiruzen Sarutobi (Third Hokage)"], classification="Ninjutsu, Offensive", range="Close to mid range",
  summary="One thrown shuriken is multiplied by shadow clones into up to a thousand real blades.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Shuriken_Shadow_Clone_Technique.")
e(45, canon=True, rank="A", users=["Orochimaru"], classification="Fūinjutsu, Supplementary", range="Close range",
  summary="An odd-numbered seal placed over Naruto's even-numbered seal blocks the Nine-Tails' chakra and scrambles his own chakra.",
  source_url=DB1, notes=f"{R_DB1}. Counter: Five Elements Unseal (A-rank, Jiraiya).")
e(46, canon=True, rank="A", users=["Itachi Uchiha"], classification="Ninjutsu, Offensive", range="Close range",
  summary="A shadow clone serves as bait and detonates in a large explosion when the target closes in.",
  source_url=DB2, notes=f"{R_DB2}. NAMING: Narutopedia title is 'Clone Great Explosion' ({NP}Clone_Great_Explosion).")
e(47, canon=True, rank="A", users=["Naruto Uzumaki", "Kakashi Hatake"], classification="Ninjutsu, Supplementary",
  summary="A chakra-heavy form of the Shadow Clone that makes huge numbers of solid clones; sealed as a forbidden technique.",
  source_url=DB1, notes=f"{R_DB1}. Forbidden (kinjutsu) per Databook 1 and Narutopedia.")
e(48, canon=True, rank="A", users=["Hiruzen Sarutobi (Third Hokage)"], classification="Ninjutsu, Supplementary", range="Long range",
  summary="Uses a crystal ball to watch a specific person anywhere, provided the caster knows that person's chakra.",
  source_url=DB1, notes=R_DB1)
e(49, canon=True, rank="A", seals=[], users=["Naruto Uzumaki", "Minato Namikaze (creator)"], classification="Ninjutsu, Offensive", range="Close range",
  summary="Compresses rapidly spinning chakra into a sphere in the palm and drives it into the target.",
  source_url=DB2, notes=f"{R_DB2}. No hand seals (Databook 2 and Narutopedia {NP}Rasengan). Also used by Jiraiya.")
e(50, canon=True, rank=None, users=["Jiraiya (inventor)"], classification="Stealth / infiltration",
  summary="Lets the user secretly watch others without being detected; the anime shows it making the user invisible.",
  source_url=NP + "Transparent_Escape_Technique",
  notes="Narutopedia says it has never actually been shown in the manga (only mentioned); the anime shows it. Rank unverified. Hayate Gekkō is also named as skilled with it.")
e(51, canon=True, rank="C", users=["Anko Mitarashi"], classification="Ninjutsu, Offensive", range="Close range",
  summary="Snakes hidden in the sleeve shoot out to bite or coil around the opponent.",
  source_url=DB1, notes=R_DB1)
e(52, canon=True, rank="B", users=["Jiraiya"], classification="Ninjutsu, Offensive, Defensive", range="Close range",
  summary="Jiraiya covers himself in chakra-hardened spikes of hair that injure attackers and can be used to counter.",
  source_url=DB2, notes=R_DB2)
e(53, canon=True, rank="S", users=["Minato Namikaze", "Tobirama Senju"], classification="Ninjutsu, Supplementary", range="All ranges",
  summary="Instantly teleports the user to a spot marked with a jutsu formula, such as on a kunai or on an enemy.",
  source_url=DB2,
  notes=f"{R_DB2} (user listed: Fourth Hokage). Tobirama is a user of the Databook 4 variants (Flying Thunder God Slash / Mutually Instantaneous Revolving Technique).")

# ---------------- Fire Release ----------------
e(54, canon=True, rank="C", users=["Sasuke Uchiha"], classification="Ninjutsu (Fire Release), Offensive", range="Close range",
  summary="Spits several flames that scatter in different directions, each one steered with chakra.",
  source_url=DB1,
  notes=f"{R_DB1}. Seals unverified: Looper ({LOOPER}) gives six seals with Ox fourth, but the full sequence could not be confirmed.")
e(55, canon=True, rank="C", seals=["Snake", "Ram", "Monkey", "Boar", "Horse", "Tiger"], users=["Sasuke Uchiha", "Itachi Uchiha"],
  classification="Ninjutsu (Fire Release), Offensive", range="Close range",
  summary="Converts chakra into fire and expels it from the mouth as a large fireball; more chakra gives a bigger fireball. Uchiha clan signature.",
  source_url=DB1,
  notes=f"{R_DB1}; Databook 1 text names Horse then Tiger. Full 6-seal sequence from Sportskeeda ({SK}). Narutopedia: {NP}Fire_Release:_Great_Fireball_Technique.")
e(56, canon=True, rank="C", users=["Sasuke Uchiha"], classification="Ninjutsu (Fire Release), Offensive", range="Mid range",
  summary="Fire is launched in a straight line like a projectile to hit the enemy's upper body.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Fire_Release:_Dragon_Fire_Technique.")
e(57, canon=True, rank="none", seals=[], users=["Madara Uchiha"], classification="Ninjutsu (Fire Release)",
  summary="Spreads chakra-infused ash over a wide area that burns anyone it touches; works as both a deterrent and a smokescreen.",
  source_url=NP + "Fire_Release:_Hiding_in_Ash_and_Dust_Technique",
  notes=f"NAMING: Narutopedia title is 'Fire Release: Hiding in Ash and Dust Technique' (Haijingakure). Databook 4 mini-file gives no rank ({DB4M}); user Madara per {COMP}. Narutopedia says no hand seals are needed.")
e(58, canon=True, rank=None, users=None, classification="Ninjutsu (Fire Release)", source_url=NP + "Fire_Release:_Running_Fire",
  notes="Narutopedia page exists ('Fire Release: Running Fire'), but it could not be read (client_error). Search results tie it to Gitai from Naruto Shippūden the Movie, so it is probably movie-only (unverified). Rank, users and description are unverified.")
e(59, canon=True, rank="B", users=["Hiruzen Sarutobi (Third Hokage)"], classification="Ninjutsu (Fire Release), Offensive", range="Close to mid range",
  summary="Flames are shaped into a dragon that splits into three simultaneous strikes from the left, right and front.",
  source_url=DB2, notes=f"{R_DB2} (listed as 'Fire Dragon Flaming Bullet'). Narutopedia: {NP}Fire_Release:_Fire_Dragon_Flame_Bullet.")
e(60, canon=True, rank="B", users=["Asuma Sarutobi"], classification="Ninjutsu (Fire Release)",
  summary="Asuma's Fire Release technique, used to blow up Hidan.",
  source_url=COMP, notes=f"{R_COMP}. Exact mechanics not verified from the sources read.")
e(61, canon=True, rank="B", users=["Sasuke Uchiha"], classification="Ninjutsu (Fire Release)",
  summary="Sasuke's (Part 2) large-scale fire technique, used to blast through a ceiling.",
  source_url=COMP, notes=f"{R_COMP}. Narutopedia: {NP}Fire_Release:_Great_Dragon_Fire_Technique.")
e(62, canon=True, rank="none", seals=["Tiger"], users=["Madara Uchiha"], classification="Ninjutsu (Fire Release)",
  summary="Expels a massive stream of flame from the mouth that sets a vast area ablaze in a sea of fire.",
  source_url=NP + "Fire_Release:_Great_Fire_Destruction",
  notes=f"Databook 4 mini-file gives no rank ({DB4M}). Narutopedia: in the anime Madara first used a 7-seal sequence (seals not named); in his second use against Tsunade he used only the Tiger seal.")
e(63, canon=True, rank=None, users=["Sasuke Uchiha (games)"], classification="Ninjutsu (Fire Release)",
  summary="Fires many fireballs at once that rain down on the target and devastate the area around it.",
  source_url=NP + "Fire_Release:_Great_Flame_Flower",
  notes="MEDIA: not manga. Narutopedia says the name first appeared in the game Naruto: Ultimate Ninja 3 and was later used in the Boruto anime (ep. 175). No rank.")
e(64, canon=True, rank="B", users=["Madara Uchiha"], classification="Ninjutsu (Fire Release)",
  summary="Madara's huge fire attack, used against the Allied Shinobi Forces.",
  source_url=COMP,
  notes=f"{R_COMP}. NAMING: Narutopedia title is 'Fire Release: Great Fire Annihilation' ({NP}Fire_Release:_Great_Fire_Annihilation; Gōka Mekkyaku). 'Majestic Destroyer Flame' is not the Narutopedia title (probably an English dub name, not verified).")

# ---------------- Wind Release ----------------
e(65, canon=True, rank="C", users=["Nagato"], classification="Ninjutsu (Wind Release)",
  summary="A gust from the palm; Nagato used it to speed up Konan's paper shuriken.",
  source_url=COMP, notes=f"{R_COMP}. Narutopedia: {NP}Wind_Release:_Gale_Palm.")
e(66, canon=True, rank="C", users=["Orochimaru"], classification="Ninjutsu (Wind Release), Offensive", range="Close to mid range",
  summary="A sudden blast of wind that blows away everything in the caster's line of sight; power depends on the user's skill.",
  source_url=DB1, notes=R_DB1)
e(67, canon=True, rank="A", users=["Baki"], classification="Ninjutsu (Wind Release), Offensive", range="Close to mid range",
  summary="Chakra from the fingertips becomes an invisible blade of wind that cuts the enemy.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Blade_of_Wind.")
e(68, canon=True, rank="B", users=["Danzō Shimura"], classification="Ninjutsu (Wind Release), Offensive", range="All ranges",
  summary="Vacuum blades blown from the mouth that cut through chakra defences; a serial version can be boosted by summoning.",
  source_url=DB4, notes=f"{R_DB4} (combined entry: Vacuum Wave / Vacuum Serial Wave).")
e(69, canon=True, rank="C", users=["Temari"], classification="Ninjutsu (Wind Release), Offensive", range="Close to mid range",
  summary="A gale from a giant fan creates vacuum pockets that act as invisible blades to slash the target.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Sickle_Weasel_Technique.")
e(70, canon=True, rank="B", users=["Danzō Shimura"], classification="Ninjutsu (Wind Release), Offensive", range="All ranges",
  summary="Short breaths fire rapid piercing air bullets at the enemy.",
  source_url=DB4, notes=f"{R_DB4} (combined entry: Vacuum Sphere / Vacuum Great Sphere).")
e(71, canon=True, rank="B", users=["Kakuzu"], classification="Ninjutsu (Wind Release)",
  summary="Kakuzu's Wind Release attack, used against Kakashi and Team 10.",
  source_url=COMP, notes=f"{R_COMP}. Narutopedia: {NP}Wind_Release:_Pressure_Damage. Mechanics not verified.")
e(72, canon=True, rank=None, users=None, classification="Ninjutsu (Wind Release)",
  summary="The user blows wind-natured chakra onto a weapon to make it sharper, longer-reaching and deadlier.",
  source_url=NP + "Wind_Release:_Vacuum_Blade",
  notes="MEDIA: anime-only (only reference is Naruto Shippūden ep. 322). No user named, no rank.")
e(73, canon=True, rank="B", users=["Temari"], classification="Ninjutsu (Wind Release), Offensive, Defensive", range="All ranges",
  summary="A giant fan's gale cuts with vacuum blades and also cancels sound-based genjutsu aimed at the user.",
  source_url=DB2, notes=f"{R_DB2}. Narutopedia: {NP}Great_Sickle_Weasel_Technique (a separate 'Wind Release: Great Sickle Weasel Technique' page also exists).")
e(74, canon=True, rank="B", users=["Danzō Shimura"], classification="Ninjutsu (Wind Release), Offensive", range="All ranges",
  summary="One long breath forms a giant air sphere that can destroy a body.",
  source_url=DB4, notes=f"{R_DB4} (combined entry: Vacuum Sphere / Vacuum Great Sphere).")
e(75, canon=True, rank="S", users=["Naruto Uzumaki"], classification="Ninjutsu (Wind Release)",
  summary="Naruto's wind-natured Rasengan; first used against Kakuzu, when it collapsed early.",
  source_url=COMP,
  notes=f"{R_COMP}. Narutopedia: {NP}Wind_Release:_Rasenshuriken. Databook 4 jutsu file has the title only (no data block).")

# ---------------- Lightning Release ----------------
e(76, canon=True, rank="none", users=["Darui"], classification="Ninjutsu, Storm Release (kekkei genkai: Lightning + Water)",
  summary="A Storm Release attack of electric beams; Darui used it against Sasuke.",
  source_url=DB4M,
  notes=f"NAMING/CLASS: canon name is 'Storm Release: Laser Circus'. It is a kekkei genkai (Storm Release) technique, not Lightning Release, so it is a poor fit for a Lightning skill at level 1. Databook 4 gives no rank ({DB4M}; {COMP}). Storm = lightning + water per Narutopedia {NP}Storm_Release.")
e(77, canon=True, rank="none", users=["Konoha shinobi"], classification="Ninjutsu (Lightning Release; also creates rock like Earth Release), Offensive",
  range="Short, mid and long (page tags)",
  summary="Four large stone pillars rise around the target and lightning arcs between them, pinning it in place.",
  source_url=NP + "Lightning_Release:_Four_Pillar_Bind",
  notes=f"Databook 4 mini-file, no rank ({DB4M}; compilation marks '? Rank'). Konoha ninja used it on Pain's summoned dog.")
e(78, canon=True, rank="B", users=["Kakuzu"], classification="Ninjutsu (Lightning Release)",
  summary="Kakuzu's lightning attack, used against Shikamaru and Chōji.",
  source_url=COMP, notes=f"{R_COMP}. Narutopedia: {NP}Lightning_Release:_False_Darkness.")
e(79, canon=True, rank="B", users=["Darui"], classification="Ninjutsu (Lightning Release), Offensive", range="Close to mid range",
  summary="Lightning shaped like a jet-black panther rushes many enemies; water can spread its shock over a wide area.",
  source_url=DB4, notes=f"{R_DB4}. Narutopedia: {NP}Lightning_Release:_Black_Panther.")
e(80, canon=True, rank="A", seals=["Monkey", "Dragon", "Rat", "Bird", "Ox", "Snake", "Dog", "Tiger", "Monkey"],
  users=["Sasuke Uchiha", "Kakashi Hatake (creator)"], classification="Ninjutsu (Lightning Release), Offensive", range="Close range",
  summary="Lightning chakra concentrated in one hand, driven forward in a fast piercing thrust.",
  source_url=DB1,
  notes=f"{R_DB1}. SEALS CONFLICT: the 9-seal sequence is from Sportskeeda ({SK}) and matches GameRant's 'almost ten seals' (anime). Looper says the manga version uses three seals with Hare second; the commonly cited Ox-Hare-Monkey could not be fully verified.")
e(81, canon=True, rank="S", users=["Kakashi Hatake"], classification="Ninjutsu (Lightning Release), Offensive", range="Close range",
  summary="Kakashi's refined Chidori: a blade-like lightning thrust that can cut almost anything (named after he split a lightning bolt).",
  source_url=DB1,
  notes=f"{R_DB1}; the translation explicitly reads 'S-rank', and the compilation agrees. NAMING: Narutopedia title is 'Lightning Cutter' ({NP}Lightning_Cutter; Raikiri). 'Lightning Blade' is the English anime name and is not used as the Narutopedia title.")
e(82, canon=True, rank="A", users=["A (Fourth Raikage)", "Killer B"], classification="Taijutsu + Lightning Release",
  summary="A charge-in, chakra-boosted lariat that can blow out an opponent's chest; A and B also perform it together as the Double Lariat.",
  source_url=COMP, notes=f"{R_COMP}. Narutopedia: {NP}Lightning_Release:_Lariat (manga ch. 541-542).")
e(83, canon=True, rank="C", users=["Kakashi Hatake"], classification="Ninjutsu (Lightning Release), Offensive, Supplementary", range="Close to mid range",
  summary="Lightning Cutter chakra shaped like a wolf that chases its target with erratic movement; a hit paralyses the enemy.",
  source_url=DB4, notes=f"{R_DB4}. Narutopedia: {NP}Lightning_Release:_Lightning_Beast_Tracking_Fang.")
e(84, canon=True, rank=None, users=["Kakashi Hatake", "Boruto Uzumaki"], classification="Ninjutsu (Lightning Release)",
  summary="Fires a bolt of purple electricity from the hand, at range or by direct contact; Kakashi invented it to replace the Lightning Cutter.",
  source_url=NP + "Lightning_Release:_Purple_Electricity",
  notes="NAMING: Narutopedia title is 'Lightning Release: Purple Electricity'. MEDIA: Kakashi Hiden novel and Boruto manga/anime (post-Naruto era). No rank.")
e(85, canon=True, rank="B", users=["A (Fourth Raikage)", "Third Raikage"], classification="Ninjutsu (Lightning Release)",
  summary="The Raikage's Lightning Release chakra mode, used in his fights against Sasuke's team and Obito.",
  source_url=COMP,
  notes=f"{R_COMP}. NAMING: Narutopedia title is 'Lightning Release Chakra Mode'. The page could not be read; the 'armour' wording in the game draft is not verified.")
e(86, canon=True, rank="S", users=["Sasuke Uchiha"], classification="Ninjutsu (Lightning Release)",
  summary="Sasuke draws natural lightning from thunderclouds and steers it with chakra; it destroyed Itachi's Susanoo.",
  source_url=COMP, notes=f"{R_COMP}. Narutopedia: {NP}Kirin.")

# ---------------- Earth Release ----------------
e(87, canon=True, rank="C", users=["Kakashi Hatake", "Orochimaru"], classification="Ninjutsu (Earth Release)",
  summary="An Earth Release concealment technique (hiding like a mole); Kakashi used it to attack Itachi.",
  source_url=COMP, notes=f"{R_COMP}. NAMING: Narutopedia title is 'Earth Release: Hiding Like a Mole Technique'. Exact mechanics not verified.")
e(88, canon=True, rank="D", users=["Kakashi Hatake"], classification="Ninjutsu (Earth Release), Supplementary", range="Close range",
  summary="The user hides underground, drags the target down into the earth and then attacks their neck.",
  source_url=DB1,
  notes=f"{R_DB1}. NAMING: canon title is 'Earth Release: Double Suicide Decapitation Technique'. 'Headhunter Jutsu' is not the Narutopedia/databook name (probably an English dub name, not verified).")
e(89, canon=True, rank="B", users=["Hiruzen Sarutobi (Third Hokage)", "Kakashi Hatake"], classification="Ninjutsu (Earth Release), Defensive", range="Close range",
  summary="Chakra is converted into earth and spat out to form a chakra-reinforced wall that resists fire and water.",
  source_url=DB2, notes=f"{R_DB2}. NAMING: Narutopedia title is 'Earth Release: Earth-Style Wall'. Seals unverified.")
e(90, canon=True, rank="B", users=["Kakuzu"], classification="Ninjutsu (Earth Release)",
  summary="Kakuzu's defensive Earth Release, used to withstand an explosive attack.",
  source_url=COMP, notes=f"{R_COMP}. Narutopedia: {NP}Earth_Release:_Earth_Spear. Mechanics not verified.")
e(91, canon=True, rank=None, users=None, classification="Ninjutsu (Earth Release)",
  summary="Turns the ground under the opponent into a muddy current that sweeps them off their feet and carries them away.",
  source_url=NP + "Earth_Release:_Earth_Flow_River",
  notes="NAMING: Narutopedia title is 'Earth Release: Earth Flow River'. No user, rank or media stated in the text read.")
e(92, canon=True, rank=None, users=None, classification="Ninjutsu (Earth Release)",
  summary="From a mud source, the user forms a dragon head that fires mud balls; fire can be added to make them very hot.",
  source_url=NP + "Earth_Release:_Earth_Dragon_Bullet",
  notes="MEDIA: Narutopedia marks this as the article on the anime technique (anime-only). No user or rank given.")
e(93, canon=True, rank="B", users=["Yamato"], classification="Ninjutsu (Earth Release)",
  summary="Yamato's Earth Release rampart, demonstrated for Naruto.",
  source_url=COMP, notes=f"{R_COMP}. NAMING: Narutopedia title is 'Earth Release: Earth-Style Rampart'.")
e(94, canon=True, rank="B", users=["Jirōbō"], classification="Ninjutsu (Earth Release barrier), Offensive, Supplementary", range="Close to mid range",
  summary="Forms an earthen dome barrier around the targets and drains the chakra of everyone inside.",
  source_url=DB2,
  notes=f"{R_DB2}. NAMING: Narutopedia title is 'Earth Release Barrier: Earth Prison Dome of Magnificent Nothingness'.")
e(95, canon=True, rank="B", users=["Ōnoki"], classification="Ninjutsu (Earth Release), Offensive, Supplementary", range="Close range",
  summary="By touch, removes a target's weight so the user (or the target) can move quickly and fly.",
  source_url=DB4, notes=f"{R_DB4}. NAMING: Narutopedia title is 'Earth Release: Light-Weight Rock Technique'.")
e(96, canon=True, rank="B", users=["Ōnoki"], classification="Ninjutsu (Earth Release), Offensive, Supplementary", range="Close range",
  summary="By touch, multiplies a target's weight, slowing it and making the user's blows hit much harder.",
  source_url=DB4, notes=f"{R_DB4}. NAMING: Narutopedia title is 'Earth Release: Added-Weight Rock Technique'.")

# ---------------- Water Release ----------------
e(97, canon=True, rank="C", users=["Zabuza Momochi", "Kisame Hoshigaki"], classification="Ninjutsu (Water Release), Supplementary",
  summary="Makes clones out of water that keep the user's abilities; several can be made at once.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Water_Clone_Technique. Seals unverified.")
e(98, canon=True, rank="C", users=["Gamabunta"], classification="Ninjutsu (Water Release), Offensive", range="All ranges",
  summary="Chakra is turned into condensed water balls spat from the mouth with gunshot-like force; no water source is needed.",
  source_url=DB2, notes=f"{R_DB2}. NAMING: 'Water Release: Gunshot'. The canon user is the toad Gamabunta; no human user was verified.")
e(99, canon=True, rank="D", users=["Zabuza Momochi", "Mei Terumi"], classification="Ninjutsu (Water Release), Supplementary",
  summary="Raises a mist from nearby water so the user can vanish and reappear at will.",
  source_url=DB1,
  notes=f"{R_DB1}. NAMING: Narutopedia title is 'Hiding in Mist Technique' ({NP}Hiding_in_Mist_Technique). 'Hidden Mist Technique' is a common English (anime) name, not the wiki title. Seals unverified.")
e(100, canon=True, rank="B", users=["Tobirama Senju", "Kakashi Hatake"], classification="Ninjutsu (Water Release), Supplementary", range="Close range",
  summary="Water spat by the user circles them and rises into a clear wall that blocks attacks.",
  source_url=DB2, notes=f"{R_DB2}. NAMING: Narutopedia title is 'Water Release: Water Formation Wall'. Narutopedia text mentions seal sequences without naming them.")
e(101, canon=True, rank="C", users=["Zabuza Momochi", "Kisame Hoshigaki"], classification="Ninjutsu (Water Release), Supplementary", range="Close range",
  summary="Traps the target in a sphere of water that is hard to break from inside; it collapses if the caster lets go.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Water_Prison_Technique. Seals unverified.")
WD = ["Ox", "Monkey", "Hare", "Rat", "Boar", "Bird", "Ox", "Horse", "Bird", "Rat", "Tiger", "Dog",
      "Tiger", "Snake", "Ox", "Ram", "Snake", "Boar", "Ram", "Rat", "Yang Water", "Monkey", "Bird", "Dragon",
      "Bird", "Ox", "Horse", "Ram", "Tiger", "Snake", "Rat", "Monkey", "Hare", "Boar", "Dragon", "Ram",
      "Rat", "Ox", "Monkey", "Bird", "Yang Water", "Rat", "Boar", "Bird"]
assert len(WD) == 44
e(102, canon=True, rank="B", seals=WD, users=["Zabuza Momochi", "Kakashi Hatake"], classification="Ninjutsu (Water Release), Offensive", range="All ranges",
  summary="Shapes a large mass of water into a dragon that slams into the target with physical force.",
  source_url=DB1,
  notes=f"{R_DB1}. The 44-seal sequence is from Sportskeeda ({SK}). Narutopedia: 44 seals at first appearance (the most ever shown for one jutsu); later users need far fewer (Tobirama). Other users: Tobirama, Mei, Itachi ({COMP}).")
e(103, canon=True, rank="B", seals=["Tiger", "Ox", "Dragon", "Hare", "Dog", "Bird", "Rat", "Clone seal", "Dragon", "Ram"],
  users=["Kisame Hoshigaki", "Kakashi Hatake"], classification="Ninjutsu (Water Release), Offensive", range="Close to mid range",
  summary="A mass of water fired at the enemy that takes the shape of a shark from its speed and force.",
  source_url=DB2, notes=f"{R_DB2}. Seals from Sportskeeda ({SK}), which includes a 'Clone seal'; GameRant agrees on ten seals. Secondary source.")
e(104, canon=True, rank="none", users=["Tobirama Senju"], classification="Ninjutsu (Water Release)",
  summary="Chakra kneaded in the stomach is expelled as a high-pressure water jet that can cleanly cut the roots of the God Tree.",
  source_url=NP + "Water_Release:_Water_Severing_Wave",
  notes=f"Databook 4 mini-file (Tobirama), no rank ({DB4M}; compilation '? Rank').")
e(105, canon=True, rank="B", users=["Kisame Hoshigaki"], classification="Ninjutsu (Water Release)",
  summary="Kisame's large-scale Water Release attack, used against Team Guy.",
  source_url=COMP,
  notes=f"{R_COMP}. NAMING: Narutopedia title is 'Water Release: Exploding Water Colliding Wave' ({NP}Water_Release:_Exploding_Water_Colliding_Wave). A stronger 'Great Exploding Water Colliding Wave' also exists (no rank). Mechanics not verified.")
e(106, canon=True, rank="A", users=["Kisame Hoshigaki"], classification="Ninjutsu (Water Release), Offensive", range="Mid to long range",
  summary="A huge shark-shaped water projectile that devours enemy jutsu and adds their energy to its own.",
  source_url=DB4, notes=f"{R_DB4}. Narutopedia: {NP}Water_Release:_Great_Shark_Bullet_Technique.")
e(107, canon=True, rank="B", users=["Kisame Hoshigaki"], classification="Ninjutsu (Water Release)",
  summary="Kisame's mass shark attack, used against Might Guy (who had the Gate of View open).",
  source_url=COMP,
  notes=f"{R_COMP}. NAMING: canon title is 'Water Release: A Thousand Feeding Sharks' (Narutopedia talk page title). Databook 4 jutsu file has the title only.")

# ---------------- Genjutsu ----------------
e(108, canon=True, rank=None, users=["Any shinobi (victim or ally)"], classification="Genjutsu counter-measure",
  summary="Breaking a genjutsu by disrupting the victim's chakra flow, done by the victim or by an ally sending chakra into them.",
  source_url=NP + "Genjutsu",
  notes="NAMING: Narutopedia calls this 'Genjutsu Dissipation' (Genjutsu Kai), also 'Genjutsu Reversal'. It is a general method, not a ranked technique. No seal named.")
e(109, canon=True, rank=None, users=None, classification="Genjutsu",
  summary="Makes targets walk in circles while believing they are moving in a straight line.",
  source_url=NP + "Sly_Mind_Affect_Technique",
  notes="Manga ch. 61 (Forest of Death). Databook 1 includes it, but the translation has no data block, so the rank is unverified. The Narutopedia excerpt named Team 7, apparently as the targets; the casters were not confirmed.")
e(110, canon=True, rank="D", users=["Kakashi Hatake"], classification="Genjutsu, Supplementary", range="Close range",
  summary="Pulls a person's deepest fear from their heart and makes them see it as real.",
  source_url=DB1, notes=f"{R_DB1}. NAMING: Narutopedia title is 'Demonic Illusion: Hell Viewing Technique'.")
e(111, canon=True, rank="D", users=["Mubi"], classification="Genjutsu, Supplementary",
  summary="Slow black phantoms emerge from the fog and multiply each time one is struck.",
  source_url=DB1, notes=R_DB1)
e(112, canon=True, rank="A", users=["Hashirama Senju (First Hokage)"], classification="Genjutsu, Supplementary", range="Mid to long range",
  summary="Covers the target's sight in an illusory, impenetrable darkness so they cannot counter.",
  source_url=DB2, notes=f"{R_DB2}. Narutopedia: {NP}Bringer-of-Darkness_Technique.")
e(113, canon=True, rank="A", users=["Kabuto Yakushi"], classification="Genjutsu, Supplementary", range="Close to long range",
  summary="Illusory white feathers fall over an area and put everyone who sees them into an irresistible sleep.",
  source_url=DB1, notes=R_DB1)
e(114, canon=True, rank="B", users=["Kurenai Yūhi"], classification="Genjutsu, Supplementary", range="Close range",
  summary="An illusory tree binds the target, who stays conscious and immobile, open to interrogation or a follow-up attack.",
  source_url=DB2, notes=f"{R_DB2}. NAMING: Narutopedia title is 'Demonic Illusion: Tree Binding Death'.")
e(115, canon=True, rank="B", users=["Tayuya"], classification="Genjutsu, Supplementary", range="All ranges",
  summary="Flute music makes listeners feel their limbs are chained, paralysing them and wearing down their mind with hallucinations.",
  source_url=DB2, notes=R_DB2)
e(116, canon=True, rank="none", users=["Itachi Uchiha"], classification="Genjutsu, Kekkei Genkai (Sharingan), Supplementary", range="Close range",
  summary="The Sharingan reads a genjutsu cast on the user and reflects the same illusion back onto the caster.",
  source_url=DB2, notes=f"{R_DB2} (listed with no rank). NAMING: 'Demonic Illusion: Mirror Heaven and Earth Change'. Requires the Sharingan.")
e(117, canon=True, rank=None, users=["Fukasaku", "Shima"], classification="Genjutsu (sound-based)",
  summary="A song sung by the two Great Sage Toads traps everyone who hears it in an illusion where four toad warriors hold them behind a barrier; called their most powerful genjutsu.",
  source_url=NP + "Demonic_Illusion:_Toad_Confrontation_Chant",
  notes="NAMING: 'Demonic Illusion: Toad Confrontation Chant'. Manga ch. 378-379; Sha no Sho pp. 302-303. Canon casters are the two sage toads, not a human. No rank found.")

# ---------------- Bukijutsu ----------------
e(118, canon=False, notes="No English name (generic action: throwing a kunai). No lookup done.")
e(119, canon=True, rank=None, users=["Sasuke Uchiha"], classification="Supplementary (page tag)", range="Short, mid and long (page tags)",
  summary="A shuriken tied to a strong elastic string is steered in mid-flight to hit from an unexpected angle.",
  source_url=NP + "Manipulated_Shuriken_Technique",
  notes="Source: Sha no Sho p. 282. Shino uses it in the anime. No rank found.")
e(120, canon=True, rank="none", users=["Zabuza Momochi", "Sasuke Uchiha"], classification="Weapon (Fūma shuriken)",
  summary="A large folding four-bladed 'demon wind' shuriken, nicknamed 'Shadow Windmill'.",
  source_url=NP + "F%C5%ABma_Shuriken",
  notes="NAMING: no technique called 'Demon Wind Shuriken: Windmill of Shadows' exists on Narutopedia. The weapon is the Fūma Shuriken ('Shadow Windmill' / Kage Fūsha is its nickname). It is a tool, so it has no rank. Sasuke's Land of Waves trick is covered by Shadow Shuriken Technique (D) and Manipulating Windmill Triple Blades (C).")
e(121, canon=True, rank="C", users=["Sasuke Uchiha"], classification="Ninjutsu, Offensive", range="Mid range",
  summary="Weapons are thrown on strings, and a returning shuriken strikes as a hidden third blade.",
  source_url=DB1, notes=f"{R_DB1}. NAMING: Narutopedia title is 'Manipulating Windmill Triple Blades'.")
e(122, canon=True, rank=None, users=["Tenten"], classification="Weapon technique (scroll-summoned weapons)",
  summary="Tenten summons weapons in a smoke 'dragon' and throws them in quick succession with pinpoint accuracy; the weapons can be recalled.",
  source_url=NP + "Twin_Rising_Dragons",
  notes="NAMING: Narutopedia title is 'Twin Rising Dragons'. The page mentions 'the necessary hand signs' but does not list them. No rank found.")
e(123, canon=False, notes="No English name (generic kusarigama throw). No lookup done.")
e(124, canon=False, notes="No English name (generic poisoned senbon). No lookup done.")
e(125, canon=False, notes="No English name (generic explosive kunai). No lookup done.")
e(126, canon=True, rank="A", users=["Hayate Gekkō"], classification="Ninjutsu, Offensive", range="Close range",
  summary="The user splits into three clones that attack the enemy from blind spots at the same time.",
  source_url=DB1, notes=f"{R_DB1}. NAMING: canon title is 'Dance of the Crescent Moon'.")
e(127, canon=True, rank="B", users=["Asuma Sarutobi"], classification="Taijutsu, Offensive", range="Close range",
  summary="Chakra fed into a blade forms a visible, extending edge whose reach depends on the chakra used.",
  source_url=DB2, notes=f"{R_DB2} (Taijutsu there; the compilation files it under Wind Release).")
e(128, canon=True, rank=None, users=["Zabuza Momochi"], classification="Assassination technique (Kirigakure)",
  summary="Silent assassination: the user kills by striking vital points, usually from behind, before the victim can react.",
  source_url=NP + "Silent_Killing",
  notes="NAMING: Narutopedia title is 'Silent Killing' (Muon Satsujin Jutsu). Manga ch. 12; also the Seven Ninja Swordsmen of the Mist. No rank found.")
e(129, canon=True, rank="B", users=["Sasuke Uchiha"], classification="Ninjutsu (Lightning Release + sword)",
  summary="Sasuke runs Chidori through his Kusanagi sword; the electric current paralyses whoever it stabs (used on Yamato).",
  source_url=COMP, notes=f"{R_COMP}. NAMING: Narutopedia title is 'Sword of Kusanagi: Chidori Katana'.")

# ---------------- Medical ninjutsu ----------------
e(130, canon=True, rank="A", users=["Kabuto Yakushi"], classification="Ninjutsu (medical), Supplementary", range="Close range",
  summary="Chakra sent through the hands speeds up healing of wounds; it can also overload an opponent into a coma.",
  source_url=DB1, notes=f"{R_DB1}. Narutopedia: {NP}Mystical_Palm_Technique.")
e(131, canon=True, rank=None, users=None, classification="Medical ninjutsu",
  summary="Draws a poison or pathogen out through a chakra-scalpel incision using medicinal fluid and repairs the damage; an antidote is still needed.",
  source_url=NP + "Delicate_Illness_Extraction_Technique",
  notes="Described as extremely difficult. Source: Sha no Sho p. 256. Users not named in the text read (Sakura's use on Kankurō is well known but was not verified). No rank found.")
e(132, canon=True, rank=None, users=["Kabuto Yakushi"], classification="Medical ninjutsu",
  summary="Shapes chakra into a small, sharp blade for surgery, cutting inside the body without an open wound.",
  source_url=NP + "Chakra_Scalpel",
  notes="Manga ch. 168, 290, 583-585, 663. Shizune uses it only in games. No rank found.")
e(133, canon=True, rank="B", users=["Shizune"], classification="Ninjutsu, Offensive", range="Close to mid range",
  summary="Chakra is converted into toxic chemicals and breathed out as a deadly poison mist.",
  source_url=DB2, notes=R_DB2)
e(134, canon=True, rank=None, users=None, classification=None, source_url=NP + "Chakra_Transfer_Technique",
  notes="Narutopedia page exists (title verified), but it could not be read (client_error). All fields unverified.")
e(135, canon=True, rank="A", users=["Tsunade"], classification="Ninjutsu (medical), Supplementary", range="Close range",
  summary="Converts chakra into electricity and sends it into the opponent's nervous system, scrambling signals between brain and body.",
  source_url=DB2, notes=R_DB2)
e(136, canon=False, notes="No English name (generic triage). No lookup done.")
e(137, canon=True, rank="A", users=["Konoha medical team"], classification="Ninjutsu (medical), Supplementary", range="Close range",
  summary="Uses part of the patient's body as a medium whose cells regrow the missing tissue; slow and needs several coordinated casters.",
  source_url=DB2, notes=R_DB2)
e(138, canon=False, notes="No English name (generic poison neutralisation). No lookup done.")
e(139, canon=True, rank=None, users=["Tsunade"], classification="Fūinjutsu / medical",
  summary="A forehead seal that stores chakra; releasing it (Yin Seal: Release) powers Creation Rebirth.",
  source_url=DB2,
  notes=f"Databook 2 ranks the release, 'Yin Seal: Release', S-rank (Fūinjutsu, Supplementary, Tsunade). Databook 4 lists 'Ninja Art Creation Rebirth - Strength of a Hundred Technique' (title only). Narutopedia has a 'Strength of a Hundred Seal' article (talk archive seen) that was not read. The seal itself: rank unverified.")
e(140, canon=False, notes="No English name (generic tissue regeneration). No lookup done.")
e(141, canon=True, rank="S", users=["Tsunade"], classification="Ninjutsu (medical), Supplementary",
  summary="Releases stored chakra to force rapid cell division, rebuilding organs and tissue so even mortal wounds heal, at the cost of lifespan.",
  source_url=DB2, notes=f"{R_DB2}. Narutopedia: {NP}Creation_Rebirth.")
e(142, canon=True, rank=None, users=["Chiyo"], classification="Kinjutsu (forbidden), Sunagakure",
  summary="Transfers the user's life force through chakra to heal the living or revive the dead; reviving the dead kills the user.",
  source_url=NP + "One%27s_Own_Life_Reincarnation",
  notes="Developed by the Puppet Brigade and declared forbidden by Suna. Source: Sha no Sho p. 243. No rank found.")

# ---------------- Senjutsu ----------------
e(143, canon=False, notes="No English name (generic nature-energy gathering). No lookup done.")
e(144, canon=False, notes="No English name (generic nature sensing). No lookup done.")
e(145, canon=True, rank=None, users=["Naruto Uzumaki", "Jiraiya"], classification="Senjutsu (Mount Myōboku toad style)",
  summary="Sage Mode learned from the toads of Mount Myōboku; it unlocks techniques such as Frog Kata and Sage Art: Goemon.",
  source_url=NP + "Sage_Mode",
  notes="The Narutopedia Sage Mode article could not be read (client_error). Users are confirmed through the Frog Kata (Naruto) and Sage Art: Goemon (Jiraiya with Fukasaku and Shima) articles. No rank found.")
e(146, canon=True, rank=None, users=["Kabuto Yakushi"], classification="Senjutsu (Ryūchi Cave snake style)",
  summary="Sage Transformation trained at Ryūchi Cave; Kabuto's version enables Sage Art: White Rage.",
  source_url=NP + "Sage_Art:_White_Rage_Technique",
  notes="Confirmed through the White Rage article (Ryūchi Cave, Kabuto). The Sage Mode article could not be read. No rank found.")
e(147, canon=True, rank=None, users=None, classification="Senjutsu (Shikkotsu Forest slug style)",
  summary=None, source_url=NP + "Sage_Mode",
  notes="Could not verify any canon user of slug-style Sage Mode, or any detail; the Sage Mode article could not be read. Canon fidelity risk: check that the slug variant is actually shown in canon before using it.")
e(148, canon=True, rank=None, seals=[], users=["Naruto Uzumaki"], classification="Taijutsu (Sage Mode only)",
  summary="A toad martial art for Sage Mode users that boosts strikes and enables precise counters; only sage users can sense its aura.",
  source_url=NP + "Frog_Kata", notes="Manga ch. 555. Databook 4 lists it with the title only (no rank).")
e(149, canon=True, rank="none", users=["Fukasaku", "Shima"], classification="Ninjutsu, Senjutsu",
  summary="The two sage toads croak in unison, using senjutsu chakra to send out sound waves that disorient and briefly paralyse foes.",
  source_url=NP + "Sage_Art:_Frog_Call",
  notes=f"NAMING: 'Sage Art: Frog Call'. Databook 4 mini-file, no rank ({DB4M}). The canon casters are the toads, not a human sage.")
e(150, canon=True, rank=None, users=["Jiraiya", "Fukasaku & Shima"], classification="Senjutsu collaboration technique",
  summary="Shima coats the enemy in oil, Fukasaku drives it with wind and Jiraiya ignites it with fire, burning the area to cinders.",
  source_url=NP + "Sage_Art:_Goemon",
  notes="Source: Sha no Sho p. 281. No canon rank; the A-rank Narutopedia mentions comes from a trading card game. In canon it needs three users.")
e(151, canon=True, rank="B", users=["Jiraiya", "Gamabunta"], classification="Ninjutsu (Fire Release), Offensive", range="All ranges",
  summary="Gamabunta sprays toad oil and Jiraiya ignites it with Fire Release, greatly boosting the flames' power and reach.",
  source_url=DB2,
  notes=f"{R_DB2}. NAMING: canon name is 'Fire Release: Toad Oil Flame Bullet' (Katon: Gamayu Endan). It is NOT a Sage Art; it is a summoner + summon combination (no Sage Mode needed).")
e(152, canon=True, rank=None, users=["Naruto Uzumaki"], classification="Ninjutsu, Senjutsu (Rasengan variant)",
  summary="A Sage Mode Ultra-Big Ball Rasengan: a gigantic sphere whose impact shockwave blows nearby enemies away.",
  source_url=NP + "Ultra-Big_Ball_Rasengan",
  notes="NAMING: Narutopedia name is 'Sage Art: Ultra-Big Ball Rasengan'; 'Sage Art: Massive Rasengan' is the English TV name. No rank given.")
e(153, canon=True, rank="none", users=["Kabuto Yakushi"], classification="Ninjutsu, Senjutsu, Offensive, Supplementary", range="Close to mid range",
  summary="Gives inorganic matter a kind of life, so floors, walls and ceilings move and can impale the opponent with spikes.",
  source_url=DB4, notes=f"Databook 4: no rank stated ({DB4}). NAMING: Narutopedia title is 'Sage Art: Inorganic Reincarnation'.")
e(154, canon=True, rank=None, users=["Kabuto Yakushi"], classification="Senjutsu (Sage Art)",
  summary="A dragon emerges from the mouth and coils around an orb that releases light and sound, disorienting and paralysing nearby enemies.",
  source_url=NP + "Sage_Art:_White_Rage_Technique",
  notes="NAMING: 'Sage Art: White Rage Technique'. Databook 4 page 263; listed there with the title only. No rank found. The white-dragon visual comes from a game.")
e(155, canon=True, rank="S", users=["Naruto Uzumaki"], classification="Ninjutsu (Wind Release) + Senjutsu",
  summary="The Wind Release: Rasenshuriken performed in Sage Mode.",
  source_url=COMP,
  notes=f"{R_COMP} (lists Wind Release: Rasenshuriken S-rank under Naruto (Sage Mode)). The exact Narutopedia title for the sage version was not verified.")
e(156, canon=True, rank=None, users=None, classification="Senjutsu",
  summary=None, source_url=NP + "Sage_Mode",
  notes="No separate Narutopedia article; 'perfect Sage Mode' is a concept inside the Sage Mode article, which could not be read. Users unverified.")
e(157, canon=True, rank="none", users=["Hashirama Senju"], classification="Senjutsu + Wood Release (kekkei genkai)",
  summary="In Sage Mode, Hashirama summons a colossal wooden statue with countless arms that fights under his direction.",
  source_url=NP + "Sage_Art_Wood_Release:_True_Several_Thousand_Hands",
  notes="NAMING: Narutopedia title is 'Sage Art Wood Release: True Several Thousand Hands'; the game's word order is wrong. Manga ch. 621, 626. Databook 4 lists it with the title only (no rank).")

# ---------------- Wood Release (fusion) ----------------
WR = "Wood Release is a kekkei genkai (Earth + Water)."
e(158, canon=True, rank=None, users=["Yamato", "Hashirama Senju"], classification="Ninjutsu, Wood Release clone",
  summary="Creates a duplicate by turning the user's body cells into plant matter; it can merge with plants to scout and pass messages.",
  source_url=NP + "Wood_Clone_Technique", notes=f"Manga ch. 288, 300-301, 577, 632. Madara also uses it. No rank found. {WR}")
e(159, canon=True, rank=None, users=["Yamato"], classification="Ninjutsu, Wood Release",
  summary="Roots grow into wooden pillars on both sides of the user that curve into a dome, trapping nearby enemies or sheltering the user.",
  source_url=NP + "Wood_Release:_Wood_Locking_Wall",
  notes=f"Manga ch. 293; Sha no Sho p. 308. User per {COMP}. No rank found.")
e(160, canon=True, rank=None, users=["Yamato"], classification="Ninjutsu, Wood Release",
  summary="Sends chakra into the ground and grows a building from tree roots, shaped by the user's imagination or memories.",
  source_url=NP + "Wood_Release:_Four-Pillar_House_Technique",
  notes="NAMING: Narutopedia title is 'Wood Release: Four-Pillar House Technique'. Sha no Sho p. 305. No rank found.")
e(161, canon=True, rank=None, users=["Yamato"], classification="Ninjutsu, Wood Release",
  summary="Grows a wooden prison whose size scales with the chakra used; its chakra-treated wood is very hard to break.",
  source_url=NP + "Wood_Release:_Four-Pillar_Prison_Technique",
  notes="NAMING: Narutopedia title is 'Wood Release: Four-Pillar Prison Technique'. No rank found.")
e(162, canon=True, rank=None, users=["Yamato"], classification="Ninjutsu, Wood Release",
  summary="The user turns their arm into wood and makes it grow and branch to trap or, with sharpened ends, pierce enemies.",
  source_url=NP + "Wood_Release:_Great_Forest_Technique", notes="Manga ch. 302; Sha no Sho p. 306. No rank found.")
e(163, canon=True, rank=None, users=["Hashirama Senju"], classification="Ninjutsu, Wood Release",
  summary="A huge wooden dragon that binds or attacks targets and drains their chakra by biting them.",
  source_url=NP + "Wood_Release:_Wood_Dragon_Technique",
  notes="Manga ch. 608, 620, 641, 656. Databook 4 lists it with the title only (no rank). Reanimated Madara also uses it.")
e(164, canon=True, rank="none", users=["Hashirama Senju", "Zetsu"], classification="Ninjutsu, Kekkei Genkai (Wood Release), Offensive, Defensive",
  summary="Shapes boosted Wood Release chakra into a giant wooden humanoid avatar (usually with a wooden dragon around it) that fights and shields the user.",
  source_url=DB4, notes=f"Databook 4: no rank stated ({DB4}). Narutopedia: {NP}Wood_Release:_Wood_Human_Technique.")
e(165, canon=True, rank=None, users=None, classification="Wood Release",
  summary=None, source_url=NP + "Wood_Release_Secret_Technique:_Nativity_of_a_World_of_Trees",
  notes="NAMING: 'Deep Forest Emergence' is not a Narutopedia title. A search for the exact phrase returns only 'Wood Release Secret Technique: Nativity of a World of Trees' and 'Wood Release: Nativity of a Sea of Trees', so it is probably an English (dub/game) name for one of them, which would DUPLICATE #166. Unverified.")
e(166, canon=True, rank="none", users=["Hashirama Senju"], classification="Ninjutsu, Hiden (Wood Release), Offensive, Defensive, Supplementary", range="All ranges",
  summary="Splits the earth and raises a vast, chakra-controlled forest whose trees attack and trap anyone inside.",
  source_url=DB2,
  notes=f"Databook 2: hiden, no rank ({DB2}). NAMING: Narutopedia title is 'Wood Release Secret Technique: Nativity of a World of Trees'. Yamato's smaller version is 'Wood Release: Nativity of a Sea of Trees'.")
e(167, canon=True, rank="none", users=["Hashirama Senju"], classification="Wood Release",
  summary=None, source_url=NP + "Wood_Release:_Wood_Human_Technique",
  notes="NAMING: no Narutopedia article is titled 'Wood Golem Technique'. A search for the exact phrase returns only 'Wood Release: Wood Human Technique' (Mokujin no Jutsu), so this is probably an alternate English name for it, a DUPLICATE of #164. Unverified. If it is the same technique, Databook 4 gives no rank.")

# ---------------- build ----------------
FIELDS = ["skill_id", "uk", "en", "canon", "rank", "seals", "users", "classification", "range", "summary", "source_url", "notes"]
src = json.load(open(SRC_IN, encoding="utf-8"))
assert len(src) == 168
missing = [i for i in range(168) if i not in D]
assert not missing, missing

out = []
for i, s in enumerate(src):
    d = D[i]
    o = OrderedDict()
    o["skill_id"] = s["skill_id"]
    o["uk"] = s["uk"]
    o["en"] = s["en"]
    o["canon"] = d.get("canon")
    for f in FIELDS[4:]:
        o[f] = d.get(f)
    if not o["canon"]:
        for f in ["rank", "seals", "users", "classification", "range", "summary", "source_url"]:
            o[f] = d.get(f) if f in ("classification", "summary") and d.get(f) else None
    out.append(o)

with open(OUT_JSON, "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=False, indent=2)

# ---------------- summary ----------------
def bands(level):
    r = []
    if 1 <= level <= 30: r.append("D")
    if 30 <= level <= 50: r.append("C")
    if 50 <= level <= 70: r.append("B")
    if 70 <= level <= 90: r.append("A")
    if 90 <= level <= 99: r.append("S")
    return r

BAND_TXT = {"D": "1-30", "C": "30-50", "B": "50-70", "A": "70-90", "S": "90-99"}
ORDER = ["S", "A", "B", "C", "D", "E", "none", None]

canon_items = [(i, s, o) for i, (s, o) in enumerate(zip(src, out)) if o["canon"]]
cnt = Counter(o["rank"] for _, _, o in canon_items)
noncanon = [(i, s) for i, (s, o) in enumerate(zip(src, out)) if not o["canon"]]

mism = []
for i, s, o in canon_items:
    r = o["rank"]
    if r in (None, "none"):
        continue
    eff = "D" if r == "E" else r
    allowed = bands(s["level"])
    if eff not in allowed:
        mism.append((i, s, o, eff, allowed))

def rank_idx(r):
    return "DCBAS".index(r)

lines = []
L = lines.append
L("# Canon technique check (Narutopedia + official databooks)")
L("")
L("Generated from `techniques_in_map.json` (168 entries). The data is in `canon_techniques.json` (same order; each entry's `notes` names its sources).")
L("")
L("## How the data was obtained (read first)")
L("")
L("- **Narutopedia infoboxes could not be read.** The web-fetch tool returns only the article body text; the infobox with rank, hand seals, classification and range is dropped. Category, Property and Concept pages (e.g. `Category:A-rank_techniques`) failed with client errors, and the MediaWiki API (`naruto.fandom.com/api.php`) is blocked by this session's network policy (HTTP 403). Narutopedia was still used to verify official titles (via search results), descriptions, users and media (manga / anime / game).")
L("- **Ranks, classification and range come from the official databooks**, through English translations on *The Narutoversity*: [Databook 1 (Rin no Sho)](" + DB1 + "), [Databook 2 (Tō no Sho)](" + DB2 + "), [Databook 4 (Jin no Sho)](" + DB4 + "), [Databook 4 mini-files](" + DB4M + "), and a [databook-based elemental compilation](" + COMP + ") that also covers Databook 3 (Sha no Sho) items. The compilation gives rank and user only. Narutopedia's own ranks come from these same databooks, but a fan translation summarised by a tool can contain transcription errors. Spot-check high-impact entries against Narutopedia in a normal browser.")
L("- `rank: \"none\"` means a databook or the wiki explicitly gives no rank (e.g. hiden or kekkei genkai techniques, single gates, mini-file entries). `rank: null` means not verified (no rank source could be read).")
L("- **Hand seals are mostly null.** Only a few sequences could be confirmed, from secondary sources (Sportskeeda, MyAnimeList, Looper/GameRant cross-checks): Clone, Summoning, Great Fireball, Chidori (with a conflict noted), Water Dragon Bullet (44), Water Shark Bullet. Rasengan and Hiding in Ash and Dust are confirmed to need no seals. `seals: []` means no seals needed (Rasengan, Hiding in Ash and Dust, and taijutsu/gate entries); null means unverified.")
L("- In general, a null field means unverified, not 'none'.")
L("")
L("## Counts per canon rank")
L("")
L("| Rank | Count |")
L("|---|---|")
for r in ORDER:
    if cnt.get(r):
        label = {None: "unverified (null)", "none": "no rank (explicit)"}.get(r, r)
        L(f"| {label} | {cnt[r]} |")
L(f"| **canon total** | **{len(canon_items)}** |")
L(f"| non-canon / generic (no lookup) | {len(noncanon)} |")
L("")
L("Non-canon / generic entries: " + ", ".join(f"#{i} {s['uk']}" for i, s in noncanon) + ".")
L("")
L("## Level band vs canon rank: mismatches")
L("")
L("Rule: D 1-30, C 30-50, B 50-70, A 70-90, S 90-99. Canon E counts as D. Boundary levels (30/50/70/90) are accepted for either neighbouring rank. Only entries with a verified letter rank are checked.")
L("")
L(f"**{len(mism)} of {sum(1 for _,_,o in canon_items if o['rank'] not in (None,'none'))} ranked canon techniques fall outside their band.**")
L("")
L("| # | Skill | Technique (uk / en) | Level | Level band | Canon rank | Band for canon rank | Direction |")
L("|---|---|---|---|---|---|---|---|")
for i, s, o, eff, allowed in mism:
    lvl_band = "/".join(allowed)
    shown = o["rank"] + (" (counts as D)" if o["rank"] == "E" else "")
    direction = "too early (rank higher than band)" if rank_idx(eff) > max(rank_idx(a) for a in allowed) else "too late (rank lower than band)"
    L(f"| {i} | {s['skill_id']} | {s['uk']} / {s['en']} | {s['level']} | {lvl_band} | {shown} | {BAND_TXT[eff]} | {direction} |")
L("")
early=[m for m in mism if rank_idx(m[3])>max(rank_idx(a) for a in m[4])]
late=[m for m in mism if rank_idx(m[3])<min(rank_idx(a) for a in m[4])]
gap=lambda m: abs(rank_idx(m[3])-(max(rank_idx(a) for a in m[4]) if m in early else min(rank_idx(a) for a in m[4])))
early.sort(key=lambda m:(-gap(m),m[1]['level']))
late.sort(key=lambda m:(-gap(m),-m[1]['level']))
L(f"**Placed too early** (canon rank above the level band), {len(early)} entries; largest gaps first: " + "; ".join(f"{m[2]['en']} ({m[2]['rank']} at {m[1]['level']})" for m in early[:12]) + ".")
L("")
L(f"**Placed too late** (canon rank below the level band), {len(late)} entries: " + "; ".join(f"{m[2]['en']} ({m[2]['rank']} at {m[1]['level']})" for m in late) + ".")
L("")
L("Unranked or unverified canon entries (not in the table): " + ", ".join(f"#{i} {o['en'].split(' · ')[0]} ({'no rank' if o['rank']=='none' else 'unverified'})" for i, s, o in canon_items if o['rank'] in (None, 'none')) + ".")
L("")
L("## Naming corrections (game `en` vs canon / Narutopedia title)")
L("")
L("Only wrong or misleading names are listed. Missing 'Fire Release:' / 'Wind Release:' / 'Water Release:' / 'Lightning Release:' / 'Earth Release:' / 'Wood Release:' prefixes are a style choice and are not listed individually.")
L("")
L("| # | Game `en` | Canon / Narutopedia name | Issue |")
L("|---|---|---|---|")
NC = [
 (4, "Leaf Hurricane", "(none) - English-anime name used for both Leaf Whirlwind and Leaf Gale", "Duplicate of #0/#3. Replace with e.g. Leaf Great Whirlwind (C) or Leaf Strong Whirlwind (B)"),
 (20, "Gate of Death: Evening Elephant, Night Guy", "Eight Gates (8th gate) + Evening Elephant (A) + Night Guy (S)", "Composite entry, fine as a design choice"),
 (23, "Crow", "Karasu", "Wiki title is the Japanese name; 'Crow' is the literal meaning"),
 (25, "Black Ant", "Kuroari", "As above"),
 (26, "Salamander", "Sanshōuo (databook: Black Secret Technique: Salamander)", "As above"),
 (32, "White Secret Technique: Chikamatsu's Collection of Ten Puppets", "White Secret Technique: The Chikamatsu Collection of Ten Puppets", "Minor wording"),
 (41, "Sensor Technique", "Sensing Technique", "Wrong title"),
 (43, "Sealing Technique", "Fūinjutsu (a class of techniques)", "Generic, not a single canon technique"),
 (46, "Shadow Clone Explosion", "Clone Great Explosion", "Wrong title"),
 (57, "Hiding in Ash Technique", "Fire Release: Hiding in Ash and Dust Technique", "Wrong title"),
 (64, "Majestic Destroyer Flame", "Fire Release: Great Fire Annihilation", "Not the wiki/databook title (probably a dub name)"),
 (76, "Laser Circus", "Storm Release: Laser Circus", "Storm Release (kekkei genkai), not Lightning Release"),
 (81, "Lightning Blade", "Lightning Cutter (Raikiri)", "'Lightning Blade' is the anime dub name, not the wiki title"),
 (84, "Purple Lightning", "Lightning Release: Purple Electricity", "Wrong title; Boruto-era / novel technique"),
 (85, "Lightning Release Armour", "Lightning Release Chakra Mode", "Wrong title"),
 (88, "Headhunter Jutsu", "Earth Release: Double Suicide Decapitation Technique", "Not the wiki/databook title (probably a dub name)"),
 (89, "Earth Style Wall", "Earth Release: Earth-Style Wall", "Missing hyphen/prefix"),
 (91, "Mud River", "Earth Release: Earth Flow River", "Wrong title"),
 (93, "Earth Flow Rampart", "Earth Release: Earth-Style Rampart", "Wrong title"),
 (94, "Earth Dome Prison", "Earth Release Barrier: Earth Prison Dome of Magnificent Nothingness", "Wrong title"),
 (95, "Light Weight Rock Technique", "Earth Release: Light-Weight Rock Technique", "Hyphen/prefix"),
 (96, "Added Weight Rock Technique", "Earth Release: Added-Weight Rock Technique", "Hyphen/prefix"),
 (99, "Hidden Mist Technique", "Hiding in Mist Technique", "Wiki/databook title differs (anime name)"),
 (100, "Water Encampment Wall", "Water Release: Water Formation Wall", "Wrong title"),
 (105, "Bursting Water Collision Waves", "Water Release: Exploding Water Colliding Wave", "Wrong title"),
 (107, "Thousand Feeding Sharks", "Water Release: A Thousand Feeding Sharks", "Missing 'A'/prefix"),
 (108, "Release", "Genjutsu Dissipation (Genjutsu Kai)", "Wiki name for dispelling genjutsu"),
 (110, "Hell Viewing Technique", "Demonic Illusion: Hell Viewing Technique", "Missing prefix"),
 (114, "Tree Binding Death", "Demonic Illusion: Tree Binding Death", "Missing prefix"),
 (116, "Mirror Heaven and Earth Change", "Demonic Illusion: Mirror Heaven and Earth Change", "Missing prefix; needs Sharingan"),
 (117, "Toad Confrontation Chant", "Demonic Illusion: Toad Confrontation Chant", "Missing prefix; cast by the two sage toads"),
 (120, "Demon Wind Shuriken: Windmill of Shadows", "Fūma Shuriken (nickname 'Shadow Windmill')", "A weapon, not a technique"),
 (121, "Windmill Triple Attack", "Manipulating Windmill Triple Blades", "Wrong title"),
 (122, "Rising Twin Dragons", "Twin Rising Dragons", "Word order"),
 (126, "Crescent Moon Dance", "Dance of the Crescent Moon", "Word order"),
 (128, "Silent Killing Technique", "Silent Killing", "Minor"),
 (129, "Kusanagi Sword: Chidori Katana", "Sword of Kusanagi: Chidori Katana", "Minor"),
 (151, "Sage Art: Gamayu Endan", "Fire Release: Toad Oil Flame Bullet (Katon: Gamayu Endan)", "Not a Sage Art: Jiraiya + Gamabunta combination, B-rank"),
 (152, "Sage Art: Massive Rasengan", "Sage Art: Ultra-Big Ball Rasengan", "'Massive' is the English TV name"),
 (153, "Sage Art: Inorganic Animation", "Sage Art: Inorganic Reincarnation", "Wrong title"),
 (154, "Sage Art: White Rage", "Sage Art: White Rage Technique", "Minor"),
 (157, "Wood Release: Sage Art: True Several Thousand Hands", "Sage Art Wood Release: True Several Thousand Hands", "Word order"),
 (160, "Four Pillar House Technique", "Wood Release: Four-Pillar House Technique", "Hyphen/prefix"),
 (161, "Four Pillar Prison Technique", "Wood Release: Four-Pillar Prison Technique", "Hyphen/prefix"),
 (165, "Deep Forest Emergence", "Probably Nativity of a World of Trees / Nativity of a Sea of Trees (unverified)", "Not a wiki title; likely duplicate of #166"),
 (166, "Nativity of a World of Trees", "Wood Release Secret Technique: Nativity of a World of Trees", "Missing prefix"),
 (167, "Wood Golem Technique", "Probably Wood Release: Wood Human Technique (unverified)", "Not a wiki title; likely duplicate of #164"),
]
for i, g, c, why in NC:
    L(f"| {i} | {g} | {c} | {why} |")
L("")
L("## Other canon-fidelity flags")
L("")
L("- **Not manga canon:** Great Flame Flower (#63, game-origin, later Boruto anime), Vacuum Blade (#72, anime only), Earth Dragon Bullet (#92, anime technique), Transparent Escape (#50, only mentioned in the manga; shown in the anime), Running Fire (#58, probably movie-only, unverified), Purple Electricity (#84, novel/Boruto era).")
L("- **Canon user is not a human shinobi:** Gunshot (#98, Gamabunta), Frog Call (#149, Fukasaku & Shima), Toad Confrontation Chant (#117, the two sage toads), Toad Oil Flame Bullet (#151, needs Gamabunta), Sage Art: Goemon (#150, needs Jiraiya + both toads).")
L("- **Kekkei genkai / special requirements:** Laser Circus (Storm Release), Mirror Heaven and Earth Change (Sharingan), Third Kazekage puppet (Magnet Release), all Wood Release entries (Wood Release kekkei genkai), Multiple Shadow Clone (forbidden technique), One's Own Life Reincarnation (forbidden; kills the user when reviving the dead), Gate of Death (kills the user).")
L("- **Slug Sage Mode (#147):** no canon user could be verified. Check this before keeping it as a canon option.")
L("- **Cherry Blossom Impact (#9)** is described by Narutopedia as medical ninjutsu / chakra-enhanced strength rather than taijutsu.")
L("- **Raikiri / Lightning Cutter** reads S-rank in the Databook 1 translation (Chidori is A). If your design treats them as the same tier, note this difference.")
L("")
L("## How to fill the remaining gaps")
L("")
L("If `naruto.fandom.com` is added to this environment's allowed network domains, the MediaWiki API (`api.php?action=query&prop=revisions&rvprop=content`) returns each article's infobox wikitext (rank, hand seals, classification, range, users) for 50 pages per request. That would fill every null in a few minutes. The alternative is checking the remaining infoboxes by hand in a browser.")

with open(OUT_MD, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")

print("canon:", len(canon_items), "noncanon:", len(noncanon))
print("rank counts:", dict(cnt))
print("mismatches:", len(mism))
