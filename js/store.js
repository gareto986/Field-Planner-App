// Central app state + browser persistence. The Excel workbook is the
// system of record; localStorage is a crash-safe working copy.
import { uid } from './utils.js';

export const CATEGORIES = {
  Container:   { icon: '🎒', color: '#7c5cff' },
  Clothing:    { icon: '🧥', color: '#ff7a59' },
  Shelter:     { icon: '⛺', color: '#2bb673' },
  Sleep:       { icon: '🛌', color: '#4c8dff' },
  Cooking:     { icon: '🔥', color: '#ff4d6d' },
  Food:        { icon: '🍲', color: '#f4a300' },
  Water:       { icon: '💧', color: '#1fb6d6' },
  Navigation:  { icon: '🧭', color: '#9b6b43' },
  Safety:      { icon: '⛑️', color: '#e63946' },
  Tools:       { icon: '🛠️', color: '#6c757d' },
  Electronics: { icon: '🔋', color: '#00a19a' },
  Science:     { icon: '🧪', color: '#b04fd1' },
  Personal:    { icon: '🪥', color: '#d4a373' },
  Other:       { icon: '📦', color: '#8d99ae' },
};
export const catInfo = c => CATEGORIES[c] || CATEGORIES.Other;

export const ENVIRONMENTS = ['desert', 'forest', 'mountain', 'wetland', 'coastal', 'arctic', 'tropical', 'grassland', 'urban'];
export const ACTIVITIES = ['hiking', 'backpacking', 'camping', 'survey', 'sampling', 'research', 'wildlife', 'photography', 'boat', 'kayak', 'cooking', 'day-trip', 'overnight', 'remote', 'basecamp'];

// Transport presets: limits are per person (multiplied by party size) unless `total` is set.
export const TRANSPORT = {
  foot:    { label: 'On foot (backpacks)', icon: '🥾', kgPerPerson: 15, lPerPerson: 70 },
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
  environments: [], activities: [], transport: 'foot',
  maxWeightKg: 30, maxVolumeL: 140, mustHaves: '', notes: '',
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
