// Central app state + browser persistence. The Excel workbook is the
// system of record; localStorage is a crash-safe working copy.
import { uid } from './utils.js';

export const CATEGORIES = {
  Container:   { icon: '🎒', color: '#0b5e7e' },  // deep ocean
  Clothing:    { icon: '🧥', color: '#f0624d' },  // sunset coral
  Shelter:     { icon: '⛺', color: '#4f7d3a' },  // kelp
  Sleep:       { icon: '🛌', color: '#5b6fb5' },  // dusk
  Cooking:     { icon: '🔥', color: '#d9682b' },  // island fox
  Food:        { icon: '🍲', color: '#e9a812' },  // coreopsis
  Water:       { icon: '💧', color: '#1f9bb0' },  // channel teal
  Navigation:  { icon: '🧭', color: '#a8724a' },  // sandstone cliff
  Safety:      { icon: '⛑️', color: '#d63a3a' },
  Tools:       { icon: '🛠️', color: '#66796c' },  // sage stone
  Electronics: { icon: '🔋', color: '#2a9d8f' },  // sea glass
  Science:     { icon: '🧪', color: '#8e5aa8' },  // urchin
  Personal:    { icon: '🪥', color: '#c29a5b' },
  Other:       { icon: '📦', color: '#7f939b' },
};
export const catInfo = c => CATEGORIES[c] || CATEGORIES.Other;

export const ENVIRONMENTS = ['island', 'coastal', 'desert', 'forest', 'mountain', 'wetland', 'arctic', 'tropical', 'grassland', 'urban'];
export const ACTIVITIES = ['hiking', 'backpacking', 'camping', 'survey', 'sampling', 'research', 'wildlife', 'photography', 'boat', 'sea-kayak', 'snorkel', 'tidepooling', 'birding', 'cooking', 'day-trip', 'overnight', 'remote', 'basecamp'];

// Transport presets: limits are per person (multiplied by party size) unless `total` is set.
export const TRANSPORT = {
  foot:    { label: 'On foot (backpacks)', icon: '🥾', kgPerPerson: 15, lPerPerson: 70 },
  ferry:   { label: 'Island ferry + carry to camp', icon: '⛴️', kgPerPerson: 20, lPerPerson: 100 },
  vehicle: { label: '4x4 / Truck', icon: '🛻', total: true, kg: 400, l: 1500 },
  canoe:   { label: 'Canoe / Kayak', icon: '🛶', kgPerPerson: 45, lPerPerson: 180 },
  plane:   { label: 'Small bush plane', icon: '🛩️', kgPerPerson: 23, lPerPerson: 140 },
  flight:  { label: 'Commercial flight', icon: '✈️', kgPerPerson: 30, lPerPerson: 160 },
  animal:  { label: 'Pack animal', icon: '🐴', total: true, kg: 90, l: 300 },
  custom:  { label: 'Custom limits', icon: '⚙️' },
};

const STATE_KEY = 'fieldpack.state.v1';
const SETTINGS_KEY = 'fieldpack.settings.v1';

export const defaultRequest = () => ({
  name: '', destination: '', startDate: '', days: 2, people: 2,
  environments: [], activities: [], transport: 'ferry',
  maxWeightKg: 40, maxVolumeL: 200, mustHaves: '', notes: '',
});

export const emptyPlan = () => ({
  id: uid('TRIP').toUpperCase(),
  request: defaultRequest(),
  containers: [],   // [{ uid, itemId }]
  packed: [],       // [{ itemId, qty, container: uid|null }]
  ai: { messages: [], analysis: '', suggestion: null, provider: '', model: '' },
  status: 'draft',
});

export const state = {
  items: [],
  trips: [],
  plan: emptyPlan(),
  view: 'planner',
  workbook: { name: '', dirty: false, connected: false, lastSaved: null },
};

export const settings = {
  units: 'metric',
  autosave: true,
  ai: { provider: 'anthropic', model: '', apiKey: '', baseUrl: '', keys: {} },
};

const listeners = new Set();
export const subscribe = fn => (listeners.add(fn), () => listeners.delete(fn));

export function commit({ dirty = true, render = true } = {}) {
  if (dirty) state.workbook.dirty = true;
  persist();
  if (render) listeners.forEach(fn => fn());
}

export function persist() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      items: state.items, trips: state.trips, plan: state.plan, view: state.view,
      workbook: { name: state.workbook.name, dirty: state.workbook.dirty, lastSaved: state.workbook.lastSaved },
    }));
  } catch (e) { console.warn('persist failed', e); }
}

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s) Object.assign(settings, s, { ai: { ...settings.ai, ...(s.ai || {}) } });
  } catch { /* ignore */ }
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (!raw) return false;
    state.items = raw.items || [];
    state.trips = raw.trips || [];
    state.plan = { ...emptyPlan(), ...(raw.plan || {}) };
    state.plan.request = { ...defaultRequest(), ...(state.plan.request || {}) };
    state.view = raw.view || 'planner';
    Object.assign(state.workbook, raw.workbook || {}, { connected: false });
    return true;
  } catch { return false; }
}

export const itemById = id => state.items.find(i => i.id === id);

export function nextItemId(category) {
  const prefix = (category || 'Other').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'IT';
  let n = 1;
  const ids = new Set(state.items.map(i => i.id));
  while (ids.has(`${prefix}-${String(n).padStart(3, '0')}`)) n++;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}
