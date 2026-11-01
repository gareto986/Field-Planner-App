// Excel workbook I/O via SheetJS (global XLSX). Reads/writes the
// "Items" and "Trips" sheets; any other sheets in the file are preserved.
// Uses the File System Access API (Chrome/Edge) to save back into the same
// file, with a download fallback for other browsers.
import { num, splitList } from './utils.js';

export const ITEM_COLS = [
  ['id', 'ID'], ['name', 'Name'], ['category', 'Category'], ['icon', 'Icon'],
  ['weightKg', 'Weight (kg)'], ['lengthCm', 'Length (cm)'], ['widthCm', 'Width (cm)'], ['heightCm', 'Height (cm)'],
  ['volumeL', 'Volume (L)'], ['qtyOwned', 'Qty Owned'], ['useCases', 'Use Cases'], ['environments', 'Environments'],
  ['perPerson', 'Per Person'], ['consumable', 'Consumable'], ['perPersonDay', 'Per Person/Day'],
  ['capacityL', 'Capacity (L)'], ['maxLoadKg', 'Max Load (kg)'], ['notes', 'Notes'], ['updated', 'Last Updated'],
];

export const TRIP_COLS = [
  ['id', 'Request ID'], ['created', 'Created'], ['status', 'Status'], ['name', 'Trip Name'], ['destination', 'Destination'],
  ['startDate', 'Start Date'], ['days', 'Days'], ['people', 'People'], ['environments', 'Environments'],
  ['activities', 'Activities'], ['transport', 'Transport'], ['maxWeightKg', 'Max Weight (kg)'], ['maxVolumeL', 'Max Volume (L)'],
  ['mustHaves', 'Must-Haves'], ['notes', 'Requirements / Notes'], ['totalWeightKg', 'Total Weight (kg)'],
  ['totalVolumeL', 'Total Volume (L)'], ['packingSummary', 'Packing Summary'], ['packingList', 'Packing List (JSON)'],
  ['aiProvider', 'AI Provider'], ['aiModel', 'AI Model'], ['aiAnalysis', 'AI Analysis'],
];

const NUMERIC = new Set(['weightKg', 'lengthCm', 'widthCm', 'heightCm', 'volumeL', 'qtyOwned', 'perPersonDay', 'capacityL', 'maxLoadKg',
  'days', 'people', 'maxWeightKg', 'maxVolumeL', 'totalWeightKg', 'totalVolumeL']);
const LISTS = new Set(['useCases', 'environments', 'activities']);
const BOOLS = new Set(['perPerson', 'consumable']);
const MAX_CELL = 32000; // Excel's hard limit is 32,767 chars per cell

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = { weight: 'weightKg', weightkg: 'weightKg', qty: 'qtyOwned', quantity: 'qtyOwned', owned: 'qtyOwned',
  capacity: 'capacityL', volume: 'volumeL', uses: 'useCases', usecase: 'useCases', tags: 'useCases', env: 'environments',
  environment: 'environments', emoji: 'icon', item: 'name', itemname: 'name', type: 'category' };

function headerMap(headers, cols) {
  const lookup = {};
  cols.forEach(([k, label]) => { lookup[norm(label)] = k; lookup[norm(k)] = k; });
  Object.entries(ALIASES).forEach(([a, k]) => { if (cols.some(c => c[0] === k)) lookup[a] ??= k; });
  return headers.map(h => {
    const n = norm(h);
    if (lookup[n]) return { key: lookup[n], lb: false };
    if (/^weight.*lb/.test(n) && cols.some(c => c[0] === 'weightKg')) return { key: 'weightKg', lb: true };
    return null;
  });
}

const toBool = v => /^(y|yes|true|1|x|✓)$/i.test(String(v ?? '').trim());

function readSheet(ws, cols) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (!rows.length) return [];
  const map = headerMap(rows[0], cols);
  return rows.slice(1).filter(r => r.some(c => String(c).trim() !== '')).map(r => {
    const o = {};
    map.forEach((m, i) => {
      if (!m) return;
      let v = r[i];
      if (NUMERIC.has(m.key)) { v = num(v); if (m.lb) v *= 0.45359237; }
      else if (LISTS.has(m.key)) v = splitList(v);
      else if (BOOLS.has(m.key)) v = toBool(v);
      else if (v instanceof Date) v = v.toISOString().slice(0, 10);
      else v = String(v ?? '').trim();
      o[m.key] = v;
    });
    return o;
  });
}

function writeSheet(rows, cols) {
  const aoa = [cols.map(c => c[1])];
  rows.forEach(r => aoa.push(cols.map(([k]) => {
    const v = r[k];
    if (Array.isArray(v)) return v.join('; ');
    if (typeof v === 'boolean') return v ? 'Y' : 'N';
    if (v == null) return '';
    if (typeof v === 'string' && v.length > MAX_CELL) return v.slice(0, MAX_CELL) + '…[truncated]';
    return v;
  })));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = cols.map(([k, label]) => ({ wch: Math.min(60, Math.max(label.length + 2, ...rows.slice(0, 50).map(r => String(Array.isArray(r[k]) ? r[k].join('; ') : r[k] ?? '').length + 2))) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: cols.length - 1 } }) };
  return ws;
}

const README_ROWS = [
  ['FieldPack database'],
  [''],
  ['This workbook is the reference database for the FieldPack trip planner web app.'],
  ['Items — one row per inventory item. Weights in kg, dimensions in cm, volumes in liters.'],
  ['   Use Cases / Environments: separate values with ; (e.g. "hiking; overnight").'],
  ['   Per Person = Y → planner packs one per traveler. Consumable = Y with Per Person/Day → planner packs rate × people × days.'],
  ['   Containers (bags, totes, cases): set Category = Container plus Capacity (L) and Max Load (kg).'],
  ['   Add the tag "worn" to Use Cases for items that are worn instead of packed.'],
  ['Trips — history of every trip request, its packing list and the AI analysis. Written by the app.'],
  [''],
  ['You can edit this file in Excel; reopen it in the app to pick up changes. Extra sheets you add are preserved.'],
];

export function parseWorkbook(wb) {
  const find = name => wb.SheetNames.find(n => n.toLowerCase() === name.toLowerCase());
  const itemsName = find('Items') || find('Inventory') || wb.SheetNames[0];
  const items = readSheet(wb.Sheets[itemsName], ITEM_COLS).filter(i => i.name);
  const trips = readSheet(wb.Sheets[find('Trips') || find('History')], TRIP_COLS).filter(t => t.id).map(t => {
    try { t.packingList = t.packingList ? JSON.parse(t.packingList) : null; } catch { t.packingList = null; }
    return t;
  });
  return { items, trips };
}

export function buildWorkbook(baseWb, items, trips) {
  const wb = baseWb || XLSX.utils.book_new();
  const put = (name, ws) => {
    const existing = wb.SheetNames.find(n => n.toLowerCase() === name.toLowerCase());
    if (existing) wb.Sheets[existing] = ws; else XLSX.utils.book_append_sheet(wb, ws, name);
  };
  put('Items', writeSheet(items, ITEM_COLS));
  put('Trips', writeSheet(trips.map(t => ({ ...t, packingList: t.packingList ? JSON.stringify(t.packingList) : '' })), TRIP_COLS));
  if (!wb.SheetNames.some(n => n.toLowerCase() === 'readme')) {
    const ws = XLSX.utils.aoa_to_sheet(README_ROWS); ws['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(wb, ws, 'README');
  }
  return wb;
}

// ---------- File handling ----------
const XLSX_TYPE = { description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } };
export const canSaveInPlace = 'showOpenFilePicker' in window;

let handle = null;
let workbook = null;

export const currentHandle = () => handle;

// Persist the file handle in IndexedDB so the user can reconnect after reload.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('fieldpack', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbSet(k, v) { const db = await idb(); return new Promise(r => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = r; }); }
async function idbGet(k) { const db = await idb(); return new Promise(r => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); }

export async function storedHandle() { try { return canSaveInPlace ? await idbGet('handle') : null; } catch { return null; } }

async function ensurePermission(h, mode = 'readwrite') {
  if ((await h.queryPermission?.({ mode })) === 'granted') return true;
  return (await h.requestPermission?.({ mode })) === 'granted';
}

async function readFile(file) {
  const buf = await file.arrayBuffer();
  workbook = XLSX.read(buf, { type: 'array', cellDates: true });
  return { name: file.name, ...parseWorkbook(workbook) };
}

/** Open a workbook. Returns {name, items, trips} or null if cancelled. */
export async function openWorkbook() {
  if (canSaveInPlace) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [XLSX_TYPE], excludeAcceptAllOption: false });
      handle = h; await idbSet('handle', h).catch(() => {});
      return await readFile(await h.getFile());
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
  }
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.xlsx,.xls,.csv' });
    input.onchange = async () => resolve(input.files[0] ? await readFile(input.files[0]) : null);
    input.click();
  });
}

export async function reconnect(h) {
  if (!(await ensurePermission(h))) throw new Error('Permission to the workbook was not granted.');
  handle = h;
  return readFile(await h.getFile());
}

/** Create a new workbook file. Returns its name, or null if cancelled. */
export async function createWorkbook(items, trips, suggestedName = 'fieldpack-database.xlsx') {
  workbook = null;
  if (canSaveInPlace) {
    try {
      handle = await window.showSaveFilePicker({ suggestedName, types: [XLSX_TYPE] });
      await idbSet('handle', handle).catch(() => {});
    } catch (e) { if (e.name === 'AbortError') return null; throw e; }
    await saveWorkbook(items, trips);
    return handle.name;
  }
  handle = null;
  await saveWorkbook(items, trips, suggestedName);
  return suggestedName;
}

/** Write items/trips back into the workbook. Returns 'saved' or 'downloaded'. */
export async function saveWorkbook(items, trips, fallbackName = 'fieldpack-database.xlsx') {
  workbook = buildWorkbook(workbook, items, trips);
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  if (handle) {
    if (!(await ensurePermission(handle))) throw new Error('Write permission denied for the workbook.');
    try {
      const w = await handle.createWritable();
      await w.write(new Blob([data])); await w.close();
      return 'saved';
    } catch (e) {
      throw new Error(`Could not write ${handle.name}. If it is open in Excel, close it and try again. (${e.message})`);
    }
  }
  const blob = new Blob([data], { type: XLSX_TYPE.accept && Object.keys(XLSX_TYPE.accept)[0] });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: fallbackName });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return 'downloaded';
}

export function disconnect() { handle = null; workbook = null; idbSet('handle', null).catch(() => {}); }
