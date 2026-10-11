// Builds src/data/scannables/places.json from the authored place list below.
// Items are named as in codexScanRequirements extraInfo; a name shared by two entries
// must be given as its type path.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const extra = JSON.parse(fs.readFileSync(path.join(repo, "src/data/codexScanRequirements.json"), "utf8")).extraInfo;

const SECTION_GROUP = { objects: "objects", plants: "objects", songs: "somachords", fighterFrames: "frameFighter" };
const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").trim();
const byName = new Map();
for (const [type, e] of Object.entries(extra)) {
  if (!e.section || !(e.section in SECTION_GROUP || e.section === "loreFragments")) continue;
  const key = norm(e.name);
  byName.set(key, [...(byName.get(key) ?? []), type]);
}
const groupOf = (type) => {
  const e = extra[type];
  if (e.section === "loreFragments") return type.includes("/LoreCardFragments/") ? "prex" : "fragments";
  return SECTION_GROUP[e.section];
};
function resolve(ref) {
  if (ref.startsWith("/Lotus/")) {
    if (!extra[ref]) throw new Error(`unknown type ${ref}`);
    return ref;
  }
  const hits = byName.get(norm(ref)) ?? [];
  if (hits.length !== 1) throw new Error(`${hits.length} matches for "${ref}"`);
  return hits[0];
}

/** A pool; every item must belong to the same group. */
function pool(names, perItem = 1, cap = null) {
  const types = names.map(resolve);
  const groups = new Set(types.map(groupOf));
  if (groups.size !== 1) throw new Error(`mixed groups in pool: ${names.join(", ")}`);
  return { group: [...groups][0], types, perItem, cap };
}
const ff = (frames) => frames.map((f) => `Frame Fighter Data: ${f}`);
const wiki = (page) => `https://wiki.warframe.com/w/${page}`;

const CEPH_GEAR = ["Helios + Investigator", "Thief's Wit", "Codex Scanner"];
const CEPH_STEPS = (node, { ceph, frames, songs }) => [
  "Equip a Codex Scanner and Thief's Wit",
  `Run ${node}; watch the minimap while moving`,
  ...(ceph.length ? ["Blue block: Cephalon fragment"] : []),
  ...(frames.length ? ["Blue orb: Frame Fighter data"] : []),
  ...(songs.length ? ["Pink icon: Somachord tone"] : []),
  "Scan it, then finish the mission to save",
];

function planet({ id, name, node, mission, ceph = [], frames = [], songs = [], pools = [], gates = [], steps = [], art }) {
  const all = [];
  if (ceph.length) all.push(pool(ceph, 1, 0.5));
  if (frames.length) all.push(pool(ff(frames), 1, 0.5));
  if (songs.length) all.push(pool(songs, 1, 1));
  all.push(...pools);
  return {
    id,
    name,
    kind: "planet",
    art: art ?? `${id}.webp`,
    mapKey: null,
    run: `${mission} · ${node}`,
    gear: CEPH_GEAR,
    steps: [...CEPH_STEPS(node, { ceph, frames, songs }), ...steps],
    gates,
    fixed: false,
    wiki: wiki(name.replace(/ /g, "_")),
    pools: all,
  };
}

const PLANETS = [
  planet({ id: "mercury", name: "Mercury", node: "Elion", mission: "Capture",
    ceph: ["Mercury", "Grineer Leadership", "Archaic Weapons"], frames: ["Ivara"], songs: ["Vor's Prize"] }),
  planet({ id: "venus", name: "Venus", node: "Venera", mission: "Capture",
    ceph: ["Venus", "Dojo", "Corpus Crew"], frames: ["Garuda"],
    steps: ["Stay on star chart nodes, not the Orb Vallis"] }),
  planet({ id: "earth", name: "Earth", node: "E Prime", mission: "Exterminate",
    ceph: ["Earth", "Earth Settlements", "Wildlife"] }),
  planet({ id: "mars", name: "Mars", node: "Ara", mission: "Capture",
    ceph: ["Mars", "Mars Settlement", "Sentinels"], songs: ["Consume Us"],
    pools: [pool(["Gallium Deposit"], 1, 0.5)],
    steps: ["Bullet-jump up; radar reaches only 12 m up"] }),
  planet({ id: "phobos", name: "Phobos", node: "Skyresh", mission: "Capture",
    ceph: ["Phobos", "Grineer", "Corpus Weapons"], frames: ["Nidus", "Protea"] }),
  planet({ id: "ceres", name: "Ceres", node: "Lex", mission: "Capture",
    ceph: ["Ceres", "Grineer Labour"], songs: ["This Is What You Are"] }),
  planet({ id: "jupiter", name: "Jupiter", node: "Ananke", mission: "Capture",
    ceph: ["Jupiter", "Robotics"], frames: ["Limbo", "Valkyr", "Wisp"], songs: ["The Profit"],
    pools: [
      pool([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `The Partnership Fragment ${n}/8`), 1, 2),
      pool(["Distressed Pipe"], 3),
      pool(["Neural Array"], 1, 0.5),
    ],
    steps: [
      "Scan violet Hexenon canisters in Gas City tiles",
      "Partnership 1: tile with a big overhead gas tube",
      "Partnership 6: the open vista tile",
      "Scan orange-lit Distressed Pipes",
    ] }),
  planet({ id: "europa", name: "Europa", node: "Abaddon", mission: "Capture",
    ceph: ["Europa", "Corpus", "Europa Landscape"], frames: ["Nova", "Vauban"], songs: ["Origin System"] }),
  planet({ id: "saturn", name: "Saturn", node: "Cassini", mission: "Capture",
    ceph: ["Saturn", "Citizens", "Landing Craft"], frames: ["Zephyr"] }),
  planet({ id: "uranus", name: "Uranus", node: "Ariel", mission: "Capture",
    ceph: ["Orbiter", "Uranus"], frames: ["Lavos"], songs: ["Hunhow", "Sentient Tombs", "Grakata"],
    pools: [pool(["Gallium Deposit"], 1, 0.5)] }),
  planet({ id: "neptune", name: "Neptune", node: "Galatea", mission: "Capture",
    ceph: ["Neptune", "Lotus"], frames: ["Hildryn", "Nyx"], songs: ["Archwing"] }),
  planet({ id: "pluto", name: "Pluto", node: "Hydra", mission: "Capture",
    ceph: ["Pluto", "Infested"], frames: ["Chroma", "Trinity"], songs: ["March Of The Moa"] }),
  planet({ id: "sedna", name: "Sedna", node: "Adaro", mission: "Exterminate",
    ceph: ["Sedna", "Grineer Technology"], frames: ["Titania"], songs: ["Grineer Onslaught"] }),
  planet({ id: "eris", name: "Eris", node: "Isos", mission: "Capture",
    ceph: ["Eris", "Warframe Technology", "Infestation"], frames: ["Atlas"], songs: ["Our Disease"] }),
  planet({ id: "void", name: "Void", node: "Hepit", mission: "Capture",
    ceph: ["Orokin", "Void"], songs: ["Corrupted", "Ghosts of Void"],
    pools: [pool(["Death Orb", "Argon Pegmatite"], 1, 2)],
    steps: ["Scan the Death Orb traps and Argon deposits"] }),
  planet({ id: "lua", name: "Lua", node: "Copernicus", mission: "Capture",
    ceph: ["Lua", "Warframes"], frames: ["Harrow"], songs: ["Rapid Adaptation", "The Second Dream"],
    gates: ["The Second Dream"] }),
  planet({ id: "deimos", name: "Deimos", node: "Horend", mission: "Capture",
    ceph: ["Lephantis", "The Collapse", "Orokin Derelict"], gates: ["Heart of Deimos"] }),
  planet({ id: "kuva-fortress", name: "Kuva Fortress", node: "Dakata", mission: "Exterminate",
    songs: ["Red Broth", "The Witches Lair"],
    pools: [
      pool(["Polished Storage Crate", "Shrapnel Mine", "Imperial Rampart", "Large Grineer Exploding Barrel"], 1, 3),
      pool(["Neural Array"], 1, 0.5),
    ],
    gates: ["The War Within"],
    steps: ["Climb every floor; tones hide high and low", "Scan mines from range before they trigger"] }),
  planet({ id: "zariman", name: "Zariman Ten Zero", node: "Halako Perimeter", mission: "Exterminate",
    songs: ["The Offering"],
    pools: [pool(["Hatch Cover"], 2), pool(["Molted Cask", "Ancient Molted Cask"], 1, 0.1)],
    gates: ["Angels of the Zariman"],
    steps: ["Hatch Covers: second floor of the shaft room", "Use a Globe Light; follow the ghost child"] }),
];

function place({ id, name, kind, run, gear = [], steps, gates = [], fixed = true, page, mapKey = null, art, pools }) {
  return { id, name, kind, art: art ?? `${id}.webp`, mapKey, run, gear, steps, gates, fixed, wiki: page ? wiki(page) : null, pools };
}

const EIDOLON_FISH = [
  "Amps", "Ancient History", "Cetus", "Grineer Excavations", "Harvesting The Tower", "Life In Cetus",
  "Merchants of Cetus", "Ostron Artisans", "Plains Animals", "Plains of Eidolon", "Remnants of Orokin",
  "Teralyst Eidolon", "The Grineer Tusks", "The Ostrons", "The Quills of Cetus", "The Tower's Flesh",
  "The Unum", "Tools of Harvest", "Ostron Patois", "Scavenging Way of Life",
];
const GHOULS = [
  "A New Phase", "A Tide of Claws and Flesh", "Augur", "Born To Die", "Devourer", "Doctor Tengus", "Ghouls",
  "Overwhelming Numbers", "Rictus", "Shock Troops", "Strength In Numbers", "The Expired", "Unstoppable",
];
const SOLARIS_CHARS = ["Eudico", "Legs", "Little Duck's", "Rude Zuud's", "Smokefinger's", "The Business'", "Ticker's"];
const SOLARIS = SOLARIS_CHARS.flatMap((c) => [1, 2, 3, 4, 5].map((n) => `${c} Mem Fragment ${n}/5`));
const LOST_ISLANDS = [
  "Lake Verula", "Manipura Island", "Scholar's Landing", "The Bleeding Earth", "The Caves of Academe",
  "The Doll Mausoleum", "The Galleria", "The Island of Lorn", "Watcher's Island", "We Are Not What We Were",
];
const DUVIRI_SONGS = [
  "Below The Thunder", "Unbound", "Drifters Respite", "Paragrimm Ascending", "Perditions Coils",
  "Shadows and Summoning", "He Who Waits", "Into Madness", "Eyes That Burn", "Duviri Paradox",
];
const TENETS = [
  "Humble Beginnings", "To The City", "What Right Do They Have?", "The Taking", "Crawling Back", "The Gemstone",
  "A New Beginning", "Giving Back", "Bury The Past", "A New Empire", "We Are Corpus",
];
const LEVERIAN = ["Ash", "Atlas", "Dante", "Gauss", "Grendel", "Ivara", "Lavos", "Nezha", "Nova", "Styanax", "Voruna"];

const LANDSCAPES = [
  place({ id: "plains-of-eidolon", name: "Plains of Eidolon", kind: "landscape", mapKey: "plains-of-eidolon",
    run: "Free roam · Cetus", page: "Plains_of_Eidolon",
    gear: ["Helios + Investigator", "Fishing Spear", "Bait"], gates: ["Vor's Prize"],
    steps: [
      "Equip Helios with Investigator and a scanner",
      "Loop the fish statues using the map pins",
      "Ostron Artisans: shoot the windmill with the Rampart",
      "Then hack the console; the fish is in a pipe",
      "Buy a Fishing Spear and bait from Fisher Hai-Luk",
      "Hold the spear out, then scan fish as they swim",
      "Throw bait on a hotspot for the rare fish",
      "Kill Ghouls; take Ghoul Purge bounties when up",
      "Sunkiller: under the Galleon wreck north of Gara Toht",
      "Return to Cetus to save progress",
    ],
    pools: [
      pool(EIDOLON_FISH),
      pool(GHOULS, 1, 1.5),
      pool(["Khut-Khut", "Yogwun", "Mortus Lungfish", "Cuthol", "Norg", "Sharrac", "Karkina", "Glappid",
        "Tralok", "Murkray", "Charc Eel", "Goopolla", "Mawfish", "Imperial Rampart", "Grineer Supply Cache"], 1, 8),
      pool(["Sunkiller"]),
    ] }),
  place({ id: "orb-vallis", name: "Orb Vallis", kind: "landscape", mapKey: "orb-vallis",
    run: "Free roam · Fortuna", page: "Orb_Vallis",
    gear: ["Helios + Investigator", "Golden Instinct", "Loot radar", "Fishing Spear"], gates: ["Vox Solaris"],
    steps: [
      "Sweep peaks, ruins and every cave for Debt-Bonds",
      "Any fragment of a character fills its next entry",
      "Find one roaming tone and scan it first",
      "Scan the Fortuna roof tone by the chimneys",
      "Scan the Spaceport roof tone by the cargo launcher",
      "Scan Sunkiller on the Temple Fabrication north wall",
      "Leave and re-enter for the next tone set",
      "Fixed tones need The New War",
      "Buy a spear and bait from The Business",
      "Warm-only fish: 6 min 40 s window per cycle",
    ],
    pools: [
      pool(SOLARIS, 1, 17),
      pool(["Cold Tundra", "Coldwave", "Fluid Mechanics", "Klokkit", "Null Unit", "We All Lift Together",
        "Vapor Trails", "Sunkiller", "For Narmer", "Hybrid Abominations"], 4, 4),
      pool(["Echowinder", "Kriller", "Sapcaddy", "Longwinder", "Brickie", "Eye-Eye", "Charamote", "Synathid",
        "Gorgaricus Sac", "Mirewinder", "Recaster", "Scrubber", "Tink", "Tromyzon"], 1, 8),
    ] }),
  place({ id: "cambion-drift", name: "Cambion Drift", kind: "landscape", mapKey: "cambion-drift",
    run: "Free roam · Necralisk", page: "Cambion_Drift", fixed: false,
    gear: ["Helios + Investigator", "Fishing Spear"], gates: ["Heart of Deimos"],
    steps: [
      "Go during Vome for the Vome-only fish",
      "Collect Fass and Vome Residue first",
      "Cave fish: throw residue on cave hotspots",
      "Scan every casket and cyst you pass",
      "Run an Isolation Vault: 14 containers inside",
    ],
    pools: [
      pool(["Amniophysi", "Vitreospina", "Duroid", "Chondricord", "Glutinox", "Aquapulmo", "Myxostomata",
        "Cryptosuctus", "Barbisteo", "Kymaeros", "Ostimyr"], 1, 7),
      pool(["Sagiant Entrati Casket", "Auroron Entrati Casket", "Spitia Infested Cyst", "Rolizor Infested Cyst"], 1, 2),
      pool(["Isolation Vault Container"], 12),
    ] }),
  place({ id: "duviri", name: "Duviri", kind: "landscape", mapKey: "duviri",
    run: "Duviri Experience · solo", page: "Duviri", gates: ["The Duviri Paradox"],
    steps: [
      "Turn on the fragment and Somachord map pins",
      "Ride out and sweep islands one entry at a time",
      "Follow the looping fragment sound",
      "Check caves; crouch or slide through brush",
      "Kullervo's Hold: turn the busts, hack, open cell",
      "Kullervo's Hold needs the Anger or Fear Spiral",
      "Earn a Decree before you leave to save",
    ],
    pools: [pool(LOST_ISLANDS), pool(DUVIRI_SONGS)] }),
];

const STOPS = [
  place({ id: "leverian", name: "Leverian", kind: "stop", run: "Codex · Leverian galleries", page: "Leverian",
    gates: LEVERIAN.map((f) => `${f} Rank 30`),
    steps: [
      "Open the Codex, pick the frame, press Leverian",
      "Walk to the card spot and press interact",
      "A card shows only at that frame's Rank 30",
    ],
    pools: [pool(LEVERIAN.map((f) => `${f} Prex`))] }),
  place({ id: "kronia-relay", name: "Kronia Relay", kind: "stop", run: "Dock · Kronia Relay, Saturn", page: "Kronia_Relay",
    steps: [
      "Protea: behind the pillar right of the Ducat kiosk",
      "Titania: atop the Earth projection, New Loka room",
      "Garuda: behind the tombstone in Teshin's room",
      "Vauban: on barrels above the Steel Meridian door",
      "Ember: archway above the Red Veil table",
    ],
    pools: [pool(["Ember Prex", "Garuda Prex", "Protea Prex", "Titania Prex", "Vauban Prex"])] }),
  place({ id: "hollvania-central-mall", name: "Höllvania Central Mall", kind: "stop", run: "Pom-2 · Höllvania Mall",
    page: "Höllvania_Central_Mall", gates: ["The Hex"],
    steps: [
      "Use the Pom-2 computer in the Orbiter",
      "Cyte-09: planter opposite the Backroom exit",
      "Temple: Round Table Pub floor, by a table leg",
    ],
    pools: [pool(["Cyte-09 Prex", "Temple Prex"])] }),
  place({ id: "drifters-camp", name: "Drifter's Camp", kind: "stop", run: "Drifter's Camp · Earth", page: "Drifter's_Camp",
    gates: ["The New War", "Caliban Rank 30"],
    steps: [
      "Cross the hidden bridge right of Kahl's outcrop",
      "Card is on rocks across the river, by a cave",
      "Break the two rocks in front of it",
    ],
    pools: [pool(["Caliban Prex"])] }),
  place({ id: "chrysalith", name: "Chrysalith", kind: "stop", run: "Chrysalith · Zariman", page: "Chrysalith",
    gates: ["Angels of the Zariman"],
    steps: ["Walk the hallway past the docking bays", "Card is atop the lockers across from Melica"],
    pools: [pool(["Gyre Prex"])] }),
  place({ id: "dagaths-hollow", name: "Dagath's Hollow", kind: "stop", run: "Clan dojo · Dagath's Hollow", page: "Dagath's_Hollow",
    steps: ["Build the Dagath's Hollow room if missing", "Look up at the hanging fire pot", "Bullet-jump to the ledge right of it"],
    pools: [pool(["Dagath Prex"])] }),
  place({ id: "fortuna-airlock", name: "Fortuna", kind: "stop", run: "Fortuna · The Airlock", page: "Fortuna",
    gates: ["The New War"],
    steps: ["Climb to the upper balcony of The Airlock", "Card sits behind the large crates"],
    pools: [pool(["Nokko Prex"])] }),
  place({ id: "maroo-ayatan-hunt", name: "Maroo's Ayatan Hunt", kind: "tileset", run: "Maroo's weekly Ayatan hunt",
    page: "Maroo", art: "maroo-ayatan-hunt.webp",
    steps: [
      "Start Maroo's hunt from the Alerts window",
      "One sculpture a week, six-week rotation",
      "Scan the sculpture before you pick it up",
    ],
    pools: [pool(["Ayatan Sah Sculpture", "Ayatan Ayr Sculpture", "Ayatan Orta Sculpture", "Ayatan Vaya Sculpture",
      "Ayatan Piv Sculpture"], 1, 1)] }),
];

const MISSIONS = [
  place({ id: "isleweaver", name: "Isleweaver", kind: "tileset", run: "Isleweaver · solo", page: "Isleweaver",
    gates: ["The Hex"],
    steps: [
      "Pick Isleweaver in Teshin's Cave",
      "Grab the drive in Teshin's Cave first",
      "Sweep Castle Town and Scholar's Landing",
      "Search the Undercroft transition, 10 to 15 s",
      "Tones: palace fountain, tower top, arena bridge",
      "Oraxia Prex: lone island SW of Castle Town",
    ],
    pools: [
      pool(["Along Came A Spider"]),
      pool(["Beneath Her Eyes", "Dust's Dominion", "Tethra Jahrak"]),
      pool(["Oraxia Prex"]),
    ] }),
  place({ id: "ascension", name: "Ascension", kind: "tileset", run: "Ascension · Brutus, Uranus", page: "Ascension",
    gates: ["Jade Shadows", "Jade Rank 30"],
    steps: [
      "Run Ascension from the Brutus node",
      "Jade Prex: under the ramp south of the start",
      "Tones spawn on the floor and up top",
      "Use the star chart run, not the Operation",
      "Extract so the scans save",
    ],
    pools: [pool(["Jade Prex"]), pool(["Angels Requiem", "Final Ascent"])] }),
  place({ id: "the-descendia", name: "The Descendia", kind: "tileset", run: "Descendia · to Infernum 21",
    page: "The_Descendia", gates: ["The Old Peace"],
    steps: [
      "Open from the Dark Refractory in Navigation",
      "Clear to Infernum 21; 7 and 14 are checkpoints",
      "Floor 21: turn around; card by the chained statue",
      "Tone sits atop a high pillar at the entrance",
      "Plunder rooms: scan every box before breaking",
      "Go solo: one Uriel card per squad",
    ],
    pools: [pool(["Uriel Prex"]), pool(["Roses From The Abyss"]), pool(["Raro Hoard", "Inusitatus Hoard"], 1, 0.5)] }),
  place({ id: "perita-rebellion", name: "The Perita Rebellion", kind: "tileset", run: "Recall · Perita Rebellion",
    page: "The_Perita_Rebellion", gates: ["The Old Peace"], fixed: false,
    steps: [
      "Lullaby: high cave above a waterfall, bunker tile",
      "Adis's Lament: behind the waterfall, bridge room",
      "Deepest Dark: dead-end Xenoflora shrine",
      "Ironclad: above the chained Hunhullus",
      "Executor: canyon gully, ledge below the cliff",
      "Break and scan every storage container",
      "Beat the boss so the scans save",
    ],
    pools: [
      pool(["Lullaby of the Manifold", "Lullaby of the Manifold - Adis's Lament", "Deepest Dark", "Ironclad", "Executor"], 1, 2),
      pool(["Standard Prime Grineer Munitions Box", "Abundant Prime Grineer Munitions Box"], 1, 0.5),
    ] }),
  place({ id: "break-narmer", name: "Break Narmer", kind: "tileset", run: "Junk Run · Break Narmer", page: "Break_Narmer",
    gates: ["Veilbreaker"],
    steps: ["Wait for the Junk Run week", "Take the left path to the Sprag room", "Interact with the tone by the far left door"],
    pools: [pool(["Hold The Line"])] }),
  place({ id: "albrecht-laboratories", name: "Albrecht's Laboratories", kind: "tileset", run: "Exterminate · Nex, Deimos",
    page: "Albrecht's_Laboratories", gates: ["Whispers in the Walls"], fixed: false,
    gear: ["Void damage", "Amp", "Helios + Investigator"],
    steps: [
      "Sweep every room for a floating Grimoire",
      "Unbind it and drain the Whisper's first bar",
      "Destroy the marked Grimoire before it heals",
      "Grab the page if one drops",
      "Deadly Whispers bounty guarantees a Whisper",
      "The Fragmented: balcony crystal puzzle room",
      "Library room: start the Grimoire Altar puzzle",
      "Scan coffers before you break them",
    ],
    pools: [
      pool(["Albrecht's Notes - The Aftermath", "Albrecht's Notes - The Cavia", "Albrecht's Notes - Duviri",
        "Albrecht's Notes - The Vessels", "Albrecht's Notes - We End as we Began"], 1, 1),
      pool(["No God Above Knowledge", "The Fragmented", "The Master Returns"], 1, 1),
      pool(["Muzureh Entrati Coffer", "Thalmin Entrati Coffer"], 1, 0.5),
    ] }),
  place({ id: "corpus-temple-relief", name: "Corpus Temple Relief", kind: "tileset", run: "Assassination · Iliad, Phobos",
    page: "Corpus_Ship", gates: ["The Deadlock Protocol"], fixed: false,
    steps: [
      "Kill the Treasurer and walk over its Crown",
      "Find the Parvos statue room: the Temple Relief",
      "Clear enemies, spend the Crown at the console",
      "Granum Void tone: atop the giant coin",
      "Entwined Forever: spend a Crown on Golden Hand",
      "Then scan the NW ridge tone within 60 s",
      "Scan the big path-opening barrels",
      "Finish the mission to save",
    ],
    pools: [pool(TENETS, 1, 1), pool(["Granum Void", "Entwined Forever"], 1, 1), pool(["Large Corpus Exploding Barrel"], 2)] }),
];

const OBJ_GEAR = ["Helios + Investigator", "Codex Scanner"];
const CORE_PIPE = "/Lotus/Types/Friendly/Agents/DefenseCorePipeAvatar";
const TILESETS = [
  place({ id: "grineer-sealab", name: "Grineer Sealab", kind: "tileset", run: "Exterminate · Puck, Uranus",
    page: "Grineer_Sealab", gear: OBJ_GEAR, fixed: false,
    steps: [
      "Kill Lancers and Troopers until they drop Blunts",
      "Scan the Lanx shark in the flooded areas",
      "Scan the wandering Domestik vacuum drone",
      "Big barrels: Ariel flooded room, upper left",
    ],
    pools: [pool(["Drekar Blunt", "Lanx", "Soag Domestik Drone", "Large Grineer Exploding Barrel"], 1, 3.5)] }),
  place({ id: "grineer-settlement", name: "Grineer Settlement", kind: "tileset", run: "Defense · Spear, Mars",
    page: "Grineer_Settlement", gear: OBJ_GEAR,
    steps: ["Scan the Cryopod at the start", "Scan a sandy Blunt when a Grineer deploys one"],
    pools: [pool(["Arid Blunt", "Warframe Cryopod"])] }),
  place({ id: "grineer-asteroid", name: "Grineer Asteroid", kind: "tileset", run: "Defense · Lares, Mercury",
    page: "Grineer_Asteroid", gear: OBJ_GEAR,
    steps: ["Scan the Orokin Power Core at the start", "Scan broken fans and big barrels on the way"],
    pools: [pool(["Orokin Power Core", "Fan", "Large Grineer Exploding Barrel"])] }),
  place({ id: "enceladus-sabotage", name: "Enceladus", kind: "tileset", run: "Sabotage · Enceladus, Saturn",
    page: "Enceladus", art: "grineer-asteroid.webp", gear: OBJ_GEAR,
    steps: ["Scan every Mining Machine at the target spots"],
    pools: [pool(["Mining Machine"], 3)] }),
  place({ id: "grineer-galleon", name: "Grineer Galleon", kind: "tileset", run: "Sabotage · Terminus, Mercury",
    page: "Grineer_Galleon", gear: OBJ_GEAR,
    steps: ["Put the Coolant in the fuel core", "Scan the pipes on the four reactor pillars", "Scan broken fans in doorways"],
    pools: [pool([CORE_PIPE], 4), pool(["Fan"])] }),
  place({ id: "grineer-forest", name: "Grineer Forest", kind: "tileset", run: "Excavation · Everest, Earth",
    page: "Grineer_Forest", gear: OBJ_GEAR, fixed: false,
    steps: ["Power every dig site as it appears", "Scan each Excavator as it deploys", "Scan mossy glowing containers before opening"],
    pools: [pool(["Excavator"], 10), pool(["Forgotten Grineer Storage Container"], 1, 0.05)] }),
  place({ id: "cervantes-sabotage", name: "Cervantes", kind: "tileset", run: "Sabotage · Cervantes, Earth",
    page: "Cervantes", art: "grineer-forest.webp", gear: OBJ_GEAR,
    steps: ["Scan the Toxin Injector before the defense ends", "Go at night for Moonlight Jadeleaf by water"],
    pools: [pool(["Toxin Injector", "Moonlight Jadeleaf"])] }),
  place({ id: "carme-mobile-defense", name: "Corpus Gas City", kind: "tileset", run: "Mobile Defense · Carme, Jupiter",
    page: "Corpus_Gas_City", gear: OBJ_GEAR,
    steps: ["Scan every data terminal you defend", "Scan the orange-lit Distressed Pipes"],
    pools: [pool(["Corpus Systems"], 3), pool(["Distressed Pipe"], 3)] }),
  place({ id: "kepler-rush", name: "Kepler", kind: "tileset", run: "Archwing Rush · Kepler, Phobos",
    page: "Kepler", gear: OBJ_GEAR, gates: ["The Archwing"],
    steps: ["Scan the three transports", "Scan the Stasis Mines along the route"],
    pools: [pool(["Transport"], 3), pool(["Corpus Stasis Mine"], 5)] }),
  place({ id: "oestrus-salvage", name: "Oestrus", kind: "tileset", run: "Infested Salvage · Oestrus, Eris",
    page: "Oestrus", art: "infested-ship.webp", gear: OBJ_GEAR, fixed: false,
    steps: ["Scan the three glass panes", "Only one of the two maps has them"],
    pools: [pool(["Reinforced Glass"], 3, 1.5)] }),
  place({ id: "hive-sabotage", name: "Infested Ship", kind: "tileset", run: "Hive Sabotage · Naeglar, Eris",
    page: "Infested_Ship", art: "infested-ship.webp", gear: OBJ_GEAR,
    steps: ["Scan the five tumors around each hive"],
    pools: [pool(["/Lotus/Objects/Gameplay/InfestedHiveMode/InfestedTumorObjectiveDeco"], 5)] }),
];

const QUESTS = [
  place({ id: "the-sacrifice", name: "The Sacrifice", kind: "tileset", run: "Quest replay · The Sacrifice",
    page: "The_Sacrifice", gates: ["The Sacrifice"], gear: ["Codex Scanner"],
    steps: [
      "Replay The Sacrifice from the Codex",
      "Scan the tones in mission order",
      "Courtyard entrance; corridor before Umbra",
      "Ceres scaffolding; bridge in the mimic room",
      "Cave on the right after syncing with Umbra",
      "Missed one? Replay from that mission",
    ],
    pools: [pool(["Your Creator", "To Take Its Pain Away"], 3)] }),
  place({ id: "call-of-the-tempestarii", name: "Call of the Tempestarii", kind: "tileset", run: "Quest replay · Tempestarii",
    page: "Call_of_the_Tempestarii", gates: ["Call of the Tempestarii"], gear: ["Codex Scanner"],
    steps: ["Replay the quest from the Codex", "Tone 1: spy vault vent with the laser grids", "Tone 2: Tempestarii engineering, at the back"],
    pools: [pool(["Sleeping In The Cold Below"], 2)] }),
  place({ id: "awakening", name: "Awakening", kind: "tileset", run: "Quest replay · Awakening", page: "Awakening",
    steps: ["Replay Awakening from the Codex once"],
    pools: [pool(["The Awakening"])] }),
  place({ id: "the-new-strange", name: "The New Strange", kind: "tileset", run: "Quest replay · The New Strange",
    page: "The_New_Strange", gates: ["The New Strange"], gear: ["Codex Scanner"],
    steps: ["Replay the quest from the Codex", "Scan the machine in the Derelict defense"],
    pools: [pool(["Arcane Machine"])] }),
  place({ id: "once-awake", name: "Once Awake", kind: "tileset", run: "Quest replay · Once Awake", page: "Once_Awake",
    gates: ["Once Awake"], gear: ["Codex Scanner"],
    steps: ["Replay the quest from the Codex", "Final stage on Lares: scan the bomb"],
    pools: [pool(["Cascade Bomb"])] }),
];

const ANY = [
  place({ id: "any-mission", name: "Any mission", kind: "drop", run: "Capture · any short node", page: "Storage_Container",
    gear: ["Golden Instinct", "Loot radar", "Helios + Investigator"], fixed: false,
    steps: [
      "Cast Golden Instinct at the mission start",
      "Rare containers glow orange and hum",
      "Scan Corpus containers before breaking them",
      "Break crates and lockers for Ayatan stars",
      "Scan stars in the mission, not the Orbiter",
    ],
    pools: [
      pool(["Rare Grineer Storage Container", "Rare Corpus Storage Container", "Rare Orokin Storage Container",
        "Reinforced Grineer Storage Container", "Reinforced Corpus Storage Container", "Reinforced Orokin Storage Container"], 1, 0.025),
      pool(["Ayatan Sah Sculpture", "Ayatan Ayr Sculpture", "Ayatan Orta Sculpture", "Ayatan Vaya Sculpture",
        "Ayatan Piv Sculpture"], 1, 0.14),
      pool(["Ayatan Amber Star", "Ayatan Cyan Star"], 1, 1),
    ] }),
];

const places = [...PLANETS, ...LANDSCAPES, ...STOPS, ...MISSIONS, ...TILESETS, ...QUESTS, ...ANY];
const out = path.join(repo, "src/data/scannables/places.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(places, null, 2) + "\n");
console.log(`wrote ${places.length} places`);
