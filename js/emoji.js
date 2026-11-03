// Emoji library for inventory icons, grouped for field / archaeology gear.
// Each entry: [emoji, 'search keywords']. Keywords also drive automatic icon
// suggestions from an item's name. Only emoji up to Unicode 15 are used so they
// render on Windows 10/11, macOS and phones.
import { esc } from './utils.js?v=202611030056';

export const EMOJI_GROUPS = {
  'Bags & packs': [
    ['🎒', 'backpack pack rucksack daypack knapsack expedition'], ['👜', 'duffel duffle bag holdall gear bag tote handbag'],
    ['💼', 'briefcase case document bag laptop bag'], ['🧳', 'suitcase luggage roller hard case pelican'],
    ['👝', 'pouch pocket hip belt waist pack fanny pack ditty bag'], ['🛍️', 'dry bag stuff sack bags sack'],
    ['💰', 'sack sandbag gunny bag'], ['🎽', 'vest pack hydration vest'], ['👛', 'small pouch coin purse wallet'],
    ['🧺', 'basket sieve screen shaker screen sifter mesh'], ['🪣', 'bucket pail dustpan'], ['📮', 'drop box mail'],
  ],
  'Boxes & containers': [
    ['📦', 'box tote crate bin storage carton'], ['🗃️', 'file box card box artifact box specimen box'],
    ['🗄️', 'cabinet drawer filing curation storage'], ['🧰', 'toolbox tool box kit'], ['🧊', 'cooler ice chest ice'],
    ['🫙', 'jar container sample jar'], ['🥡', 'takeout box food container'], ['🍱', 'bento lunch box meal container'],
    ['🛢️', 'drum barrel fuel canister'], ['🚰', 'water jug jerry can potable water'], ['🗳️', 'ballot box locked box'],
    ['🏺', 'amphora pot vessel ceramic pottery'], ['🧴', 'bottle lotion squeeze bottle'], ['🍶', 'bottle flask'],
  ],
  'Excavation tools': [
    ['⛏️', 'pick mattock pickaxe hand pick'], ['🔺', 'trowel pointing trowel margin trowel'], ['🪓', 'axe hatchet'],
    ['🔨', 'hammer mallet rock hammer'], ['⚒️', 'hammer pick tools'], ['🛠️', 'tools multitool kit'],
    ['🔧', 'wrench spanner shovel spade'], ['🪛', 'screwdriver'], ['🪚', 'saw handsaw'], ['✂️', 'clippers shears root clippers scissors pruners'],
    ['🖌️', 'brush paintbrush soft brush'], ['🪥', 'toothbrush brush cleaning brush'], ['🧹', 'broom whisk brush sweep'],
    ['🪝', 'hook dental pick probe'], ['🧲', 'magnet metal detector'], ['🔩', 'auger corer coring bolt'],
    ['🪜', 'ladder'], ['🪤', 'trap'], ['🧱', 'brick unit wall feature'], ['🕳️', 'hole test pit unit shovel test'],
  ],
  'Recording & survey': [
    ['📋', 'clipboard forms field forms checklist'], ['📓', 'notebook field book journal'], ['📒', 'ledger log book'],
    ['📝', 'notes forms paperwork'], ['✏️', 'pencil'], ['🖊️', 'pen marker'], ['🖍️', 'crayon sharpie marker'],
    ['📏', 'ruler tape measure meter stick rule probe'], ['📐', 'triangle line level scale square photo scale'],
    ['🎨', 'munsell soil color chart palette'], ['🧭', 'compass north arrow'], ['🗺️', 'map topo map'], ['📍', 'pin gps point location datum'], ['📌', 'pushpin stake marker'],
    ['🚩', 'flag pin flag survey flag'], ['🏷️', 'tag label artifact tag'], ['🪧', 'sign placard'],
    ['📷', 'camera photo'], ['📸', 'camera flash photogrammetry'], ['🎥', 'video camera'], ['🔭', 'telescope total station binoculars'],
    ['🛰️', 'gnss satellite gps receiver rtk'], ['📡', 'antenna satellite messenger radio dish geophysics'], ['💻', 'laptop computer'],
    ['📱', 'phone tablet'], ['📟', 'pager data logger device'], ['⌚', 'watch'],
  ],
  'Science & samples': [
    ['🧪', 'test tube sample vial'], ['🧫', 'petri dish culture sample'], ['🔬', 'microscope lab'], ['⚗️', 'chemistry flask'],
    ['🧬', 'dna'], ['🌡️', 'thermometer temperature'], ['⚖️', 'scale balance weigh'], ['🔍', 'magnifier hand lens loupe'],
    ['🔎', 'magnifying glass inspect'], ['🦴', 'bone faunal'], ['💀', 'skull human remains'], ['🐚', 'shell midden'],
    ['🪨', 'rock stone lithic geology'], ['🗿', 'statue monolith'], ['🏛️', 'museum classical site'], ['🪵', 'wood log charcoal'],
    ['🌿', 'plant botanical herb'], ['🍂', 'leaves botanical'], ['🌾', 'grass seed'], ['🫧', 'bubbles water sample'],
  ],
  'Clothing & PPE': [
    ['🧥', 'jacket coat shell rain puffy'], ['🥼', 'lab coat'], ['🦺', 'safety vest high visibility pfd life vest'],
    ['👕', 'shirt base layer tee'], ['👖', 'pants trousers'], ['🩳', 'shorts'], ['🧦', 'socks'], ['🧤', 'gloves work gloves'],
    ['🧣', 'scarf buff neck gaiter'], ['🥾', 'boots hiking boots'], ['👢', 'rubber boots wellies'], ['👟', 'shoes sneakers'],
    ['🩴', 'sandals flip flops'], ['👒', 'sun hat hat'], ['🧢', 'cap'], ['⛑️', 'helmet hard hat'], ['🕶️', 'sunglasses'],
    ['🥽', 'goggles safety glasses'], ['😷', 'mask respirator dust mask'], ['🩱', 'wetsuit swimsuit'], ['🌬️', 'windbreaker wind shell'],
  ],
  'Camp & shelter': [
    ['⛺', 'tent'], ['🏕️', 'camp tarp shelter'], ['🛖', 'hut shade'], ['⛱️', 'umbrella shade'], ['🛌', 'sleeping bag'],
    ['🛏️', 'cot bed pad'], ['🟫', 'pad mat ground cloth'], ['🪑', 'chair stool'], ['🔥', 'stove fire'], ['🏮', 'lantern'],
    ['🕯️', 'candle'], ['🔦', 'headlamp flashlight torch'], ['💡', 'light bulb lamp'], ['🧯', 'fire extinguisher'],
    ['🔋', 'battery power bank'], ['🪫', 'low battery'], ['🔌', 'charger plug cable'], ['☀️', 'solar panel sun'],
  ],
  'Food & water': [
    ['🍲', 'meal dehydrated stew'], ['🥫', 'can canned food'], ['🥜', 'trail mix nuts'], ['🍫', 'bar energy bar chocolate'],
    ['🍎', 'fruit apple'], ['🍌', 'banana'], ['🥖', 'bread'], ['🧀', 'cheese'], ['🥓', 'jerky meat'], ['🍜', 'noodles ramen'],
    ['☕', 'coffee'], ['🍵', 'tea'], ['💧', 'water filter drop'], ['🫗', 'hydration bladder pour'], ['🧂', 'salt electrolytes'],
    ['🍳', 'cook pot pan'], ['🥄', 'spoon spork utensil'], ['🍴', 'cutlery utensils'], ['🔪', 'knife'], ['💊', 'tablets purification pills'],
  ],
  'Safety & medical': [
    ['🩹', 'bandage first aid'], ['⛑️', 'first aid kit rescue'], ['🩺', 'medical stethoscope'], ['💉', 'epipen syringe'],
    ['🆘', 'emergency sos bivy'], ['📻', 'radio vhf'], ['🐻', 'bear spray'], ['🐍', 'snake gaiters'], ['🧴', 'sunscreen'],
    ['🦟', 'insect repellent mosquito'], ['🛟', 'life ring buoy'], ['🚨', 'alarm beacon'], ['🔔', 'bell whistle'], ['🗝️', 'key'], ['🔒', 'lock'],
  ],
  'Transport & hardware': [
    ['🚤', 'boat'], ['🛶', 'canoe kayak'], ['⛴️', 'ferry'], ['🛻', 'truck pickup'], ['🚙', 'suv vehicle'], ['🚲', 'bike'],
    ['🛞', 'wheel wheelbarrow cart'], ['🐴', 'horse pack animal'], ['✈️', 'plane flight'], ['🪢', 'rope cord knot'],
    ['🧵', 'string thread line'], ['🧶', 'yarn twine'], ['🔗', 'chain link carabiner'], ['⛓️', 'chain'], ['🧷', 'safety pin'],
    ['🪡', 'needle sewing repair'], ['📎', 'clip'], ['🗜️', 'clamp'], ['📌', 'stake'], ['🔩', 'bolt hardware'],
  ],
};

const ALL = Object.values(EMOJI_GROUPS).flat();

/** Suggest an icon from an item's name (e.g. "70L duffel" → 👜, "1/8 screen" → 🧺). */
export function suggestIcon(name, fallback = '') {
  const words = String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return fallback;
  let best = null, bestScore = 0;
  for (const [e, kw] of ALL) {
    const keys = kw.split(' ');
    let score = 0;
    for (const w of words) {
      if (keys.includes(w)) score += 3;
      else if (keys.some(k => k.length > 3 && (k.startsWith(w) || w.startsWith(k)))) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore >= 3 ? best : fallback;
}

/** Searchable, grouped emoji picker. Wire it with wirePicker(). */
export function pickerHtml() {
  return `<div class="emoji-picker">
    <div class="ep-top"><input type="search" class="ep-search" placeholder="Search icons: duffel, trowel, sieve, gnss…" aria-label="Search icons">
      <div class="ep-tabs">${Object.keys(EMOJI_GROUPS).map((g, i) => `<button type="button" class="ep-tab ${i ? '' : 'on'}" data-ep-group="${esc(g)}">${EMOJI_GROUPS[g][0][0]} ${esc(g)}</button>`).join('')}</div></div>
    <div class="ep-grid"></div></div>`;
}

export function wirePicker(root, onPick) {
  const grid = root.querySelector('.ep-grid');
  const search = root.querySelector('.ep-search');
  let group = Object.keys(EMOJI_GROUPS)[0];
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const list = q ? ALL.filter(([, kw]) => kw.includes(q)).filter((x, i, a) => a.findIndex(y => y[0] === x[0]) === i) : EMOJI_GROUPS[group];
    grid.innerHTML = list.map(([e, kw]) => `<button type="button" data-emoji="${e}" title="${esc(kw)}">${e}</button>`).join('') || '<span class="muted small">No match. Type or paste any emoji in the box.</span>';
  };
  root.addEventListener('click', ev => {
    const tab = ev.target.closest('[data-ep-group]');
    if (tab) { group = tab.dataset.epGroup; search.value = ''; root.querySelectorAll('.ep-tab').forEach(t => t.classList.toggle('on', t === tab)); draw(); }
    const em = ev.target.closest('[data-emoji]');
    if (em) onPick(em.dataset.emoji);
  });
  search.addEventListener('input', draw);
  search.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); grid.querySelector('[data-emoji]')?.click(); } });
  draw();
}
