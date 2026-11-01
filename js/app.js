import { state, settings, commit, persist, saveSettings, restore, subscribe, CATEGORIES, catInfo, ENVIRONMENTS, ACTIVITIES, ACTIVITY_GROUPS,
  TRANSPORT, emptyPlan, defaultRequest, itemById, nextItemId } from './store.js?v=202611012336';
import { $, $$, esc, uid, num, round, fmtWeight, fmtVolume, fmtVolSmall, fmtVolPair, weightToDisplay, weightFromDisplay, weightUnit,
  lenToDisplay, lenFromDisplay, lenUnit, volSmallToDisplay, volSmallFromDisplay, volSmallUnit, volBigToDisplay, volBigFromDisplay, volBigUnit, splitList,
  toast, openModal, confirmDialog, markdown, debounce } from './utils.js?v=202611012336';
import { autoPack, binPack, planStats, packingSummary, itemVolume, isContainer, isWorn, limitsFor, suggestedQty, relevance } from './planner.js?v=202611012336';
import * as excel from './excel.js?v=202611012336';
import * as cloud from './onedrive.js?v=202611012336';
import { LOCAL_MODELS, hasWebGPU, gpuStatus, isModelCached, loadLocalModel, onLocalProgress, loadedModel } from './local-ai.js?v=202611012336';
import { PROVIDERS, fetchFreeModels, fetchOvhModels, servedModel, isLocal, aiConfig, aiReady, chat, testConnection, systemPrompt, buildTripBrief, parseSuggestion, stripJson, iconFor } from './ai.js?v=202611012336';
import { SAMPLE_ITEMS } from './sample-data.js?v=202611012336';
import { pickerHtml, wirePicker, suggestIcon } from './emoji.js?v=202611012336';
import { CONFIG } from './config.js?v=202611012336';
import { SEARCH_PROVIDERS, searchWeb } from './websearch.js?v=202611012336';
import { openIntake } from './intake.js?v=202611012336';

const U = () => settings.units;
const W = kg => fmtWeight(kg, U());
const V = l => fmtVolume(l, U());
const VS = l => fmtVolSmall(l, U());
let aiBusy = false;
let pendingHandle = null;
let pendingCloud = null; // Excel Online file remembered from last session, waiting for sign-in

const ENV_ICONS = { island: '🏝️', desert: '🏜️', forest: '🌲', mountain: '🏔️', wetland: '🦆', coastal: '🌊', arctic: '❄️', tropical: '🌴', grassland: '🌾', urban: '🏙️' };
const ACT_ICONS = { photogrammetry: '📸', geophysics: '📡', coring: '🔩', 'environmental-sampling': '💧', 'faunal-analysis': '🦴', 'botanical-survey': '🌿', 'wildlife-survey': '🦎', geology: '🪨', 'lab-processing': '🔬', curation: '🗄️', research: '📚', vehicle: '🛻', survey: '🚶', excavation: '⛏️', testing: '🕳️', screening: '🧺', mapping: '🗺️', 'site-recording': '📋', monitoring: '👀', hiking: '🥾', backpacking: '🎒', camping: '🏕️', sampling: '🧪', research: '🔬', wildlife: '🦌', photography: '📷',
  boat: '🚤', kayak: '🛶', 'sea-kayak': '🛶', snorkel: '🤿', tidepooling: '🦀', birding: '🐦', cooking: '🍳', 'day-trip': '☀️', overnight: '🌙', remote: '📡', basecamp: '⛺' };

// =====================================================================
// Rendering
// =====================================================================
function render() {
  try { renderUnsafe(); } catch (e) {
    console.error(e);
    $('#view').innerHTML = `<section class="card" style="max-width:640px;margin:2rem auto;text-align:center">
      <h2>Something went wrong showing this page</h2>
      <p>It may be data saved by an older version of FieldPack. You can try another tab, start a fresh trip, or reset the data stored in this browser (your Excel files are not touched).</p>
      <p><button class="btn" data-view="planner">Quick Plan</button> <button class="btn primary" data-action="recover-trip">Start a fresh trip</button>
      <button class="btn danger" data-action="reset-all">Reset browser data</button></p>
      <p class="muted small">Details: ${esc(e.message)}</p></section>`;
  }
}

function renderUnsafe() {
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  renderWorkbookStatus();
  const view = { planner: viewPlanner, board: viewBoard, inventory: viewInventory, history: viewHistory, settings: viewSettings }[state.view] || viewPlanner;
  const scrollY = window.scrollY;
  const shelfScroll = $('.shelf-list')?.scrollTop;
  $('#view').innerHTML = view();
  if (shelfScroll && $('.shelf-list')) $('.shelf-list').scrollTop = shelfScroll;
  window.scrollTo(0, scrollY);
  afterRender();
}

function renderWorkbookStatus() {
  const wb = state.workbook;
  const el = $('#wbStatus');
  if (wb.connected) {
    el.className = `pill ${wb.dirty ? 'warn' : 'ok'}`;
    el.innerHTML = `${wb.cloud ? '☁️' : '📗'} <b>${esc(wb.name)}</b> · ${wb.dirty ? 'unsaved changes' : 'saved'}`;
  } else if (pendingCloud) {
    el.className = 'pill warn clickable';
    el.innerHTML = `☁️ Reconnect <b>${esc(pendingCloud.name)}</b>`;
  } else if (pendingHandle) {
    el.className = 'pill warn clickable';
    el.innerHTML = `🔌 Reconnect <b>${esc(pendingHandle.name)}</b>`;
  } else {
    el.className = 'pill';
    el.innerHTML = wb.name ? `📄 ${esc(wb.name)} · browser copy` : '💾 Browser storage only';
  }
  $('#btnSave').classList.toggle('pulse', wb.dirty);
}

function chips(list, selected, field, icons) {
  return list.map(v => `<button type="button" class="chip ${selected.includes(v) ? 'on' : ''}" data-chip="${field}" data-val="${esc(v)}">${icons[v] || '🏷️'} ${esc(v)}</button>`).join('');
}

// ---------------- Quick Planner ----------------
function viewPlanner() {
  const r = state.plan.request;
  const custom = (settings.customActivities || []).filter(a => !ACTIVITIES.includes(a));
  // keep anything already selected (e.g. from an older trip) visible
  const extra = r.activities.filter(a => !ACTIVITIES.includes(a) && !custom.includes(a));
  const end = endDate(r);
  const lim = limitsFor(r.transport, r.people);
  return `
  <section class="planner">
    <div class="card planner-form">
      <div class="card-head"><h2>🗺️ Quick Planner</h2><span class="muted">Describe the field trip; FieldPack and your AI will build the crew's load-out.</span>${scaleBar()}</div>
      <div class="step"><span class="step-n">1</span><h3>The basics</h3></div>
      <div class="grid2">
        <label>Trip name<input data-req="name" value="${esc(r.name)}" placeholder="e.g. Santa Rosa Island midden testing, spring season"></label>
        <label>Destination<input data-req="destination" value="${esc(r.destination)}" placeholder="e.g. Santa Rosa Island, Channel Islands NP"></label>
        <label>Start date<input type="date" data-req="startDate" value="${esc(r.startDate)}"></label>
        <div class="grid2 tight">
          <label>Days <span class="stepper"><button type="button" data-step="days" data-d="-1">−</button><input type="number" class="days-in" min="1" max="999" data-req="days" value="${r.days}" aria-label="Days"><button type="button" data-step="days" data-d="1">+</button></span></label>
          <label>People <span class="stepper"><button type="button" data-step="people" data-d="-1">−</button><b id="peopleOut">${r.people}</b><button type="button" data-step="people" data-d="1">+</button></span></label>
        </div>
      </div>
      <div class="row wrap day-presets"><span class="muted small">Quick picks:</span>
        ${[[3, 'Long weekend'], [7, '1 week'], [14, '2 weeks'], [30, '1 month'], [60, '2 months'], [90, 'Field season · 3 mo']].map(([n, l]) => `<button type="button" class="chip mini-chip ${r.days === n ? 'on' : ''}" data-days="${n}">${l}</button>`).join('')}
        <span class="muted small" id="endDate">${end ? `Ends <b>${end}</b>` : ''}</span></div>
      <div class="grid2 tight resupply"><label>Resupply every (days) <small class="muted">optional, for long trips: consumables are packed for one leg</small><input type="number" min="0" max="999" data-req="resupplyDays" value="${r.resupplyDays || ''}" placeholder="none"></label></div>
      <div class="step"><span class="step-n">2</span><h3>Terrain</h3></div>
      <div class="chips">${chips(ENVIRONMENTS, r.environments, 'environments', ENV_ICONS)}</div>
      <div class="step"><span class="step-n">3</span><h3>What you'll be doing</h3></div>
      ${Object.entries(ACTIVITY_GROUPS).map(([g, list]) => `<div class="act-group"><span class="act-label">${esc(g)}</span><div class="chips">${chips(list, r.activities, 'activities', ACT_ICONS)}</div></div>`).join('')}
      <div class="act-group"><span class="act-label">Your own</span><div class="chips">
        ${[...custom, ...extra].map(a => `<span class="chip-wrap">${chips([a], r.activities, 'activities', ACT_ICONS)}${custom.includes(a) ? `<button type="button" class="chip-x" data-del-act="${esc(a)}" title="Remove from your list">✕</button>` : ''}</span>`).join('')}
        <form class="add-act" id="addAct"><input name="act" placeholder="＋ Add an activity (e.g. rock-art recording)" maxlength="40"><button class="btn small">Add</button></form>
      </div></div>
      <div class="step"><span class="step-n">4</span><h3>How you're getting there</h3></div>
      <div class="transport">${Object.entries(TRANSPORT).map(([k, t]) => `
        <button type="button" class="tcard ${r.transport === k ? 'on' : ''}" data-transport="${k}"><span>${t.icon}</span>${esc(t.label)}</button>`).join('')}
      </div>
      <div class="grid2">
        <label>Max total weight (${weightUnit(U())})<input type="number" min="0" step="any" data-req="maxWeightKg" data-unit="w" value="${weightToDisplay(r.maxWeightKg, U())}"></label>
        <label>Max total volume (${volBigUnit(U())})<input type="number" min="0" step="any" data-req="maxVolumeL" value="${volBigToDisplay(r.maxVolumeL, U())}"></label>
      </div>
      <p class="muted small">${lim ? `Preset for ${r.people} ${r.people > 1 ? 'people' : 'person'}: ${W(lim.kg)} / ${V(lim.l)}. Edit to override.` : 'Custom limits.'}</p>
      <div class="step"><span class="step-n">5</span><h3>Requirements</h3></div>
      <div class="grid2">
        <label>Must-haves <textarea data-req="mustHaves" rows="3" placeholder="One per line, e.g. 1/8 screen, Munsell chart, GNSS receiver">${esc(r.mustHaves)}</textarea></label>
        <label>Other notes for the AI <textarea data-req="notes" rows="3" placeholder="Sites & units planned, expected finds/samples, permit conditions, landing & water logistics…">${esc(r.notes)}</textarea></label>
      </div>
      <div class="actions">
        <button class="btn primary big" data-action="autopack">⚡ Auto-pack from inventory</button>
        <button class="btn accent big" data-action="autopack-ai" ${aiReady() ? '' : 'title="Connect an AI in Settings first"'}>🤖 Auto-pack + AI trip plan</button>
        <button class="btn ghost" data-action="go-board">Open Pack Board →</button>
        <button class="btn ghost" data-action="new-trip">↺ New trip</button>
      </div>
    </div>
    <aside class="card trip-preview" id="tripPreview">${tripPreview()}</aside>
  </section>`;
}

const SCENES = {
  island:    { sky: ['#ffcf8a', '#9fdbe8'], far: '#7d9bb0', near: '#c4935f', top: '#9bb37a', water: '#1f8a9e', fauna: ['🦊', '🐋', '🦭'], arch: true },
  coastal:   { sky: ['#ffd9a8', '#a8def0'], far: '#88a9a0', near: '#d8b57f', top: '#a9c27f', water: '#2a8fb0', fauna: ['🦀', '🐬', '🐚'] },
  wetland:   { sky: ['#e7f2c9', '#a9dbe3'], far: '#7aa37a', near: '#5f8f4a', top: '#8cb860', water: '#4c9fb5', fauna: ['🦆', '🐸', '🌾'] },
  desert:    { sky: ['#ffb36b', '#ffe3a8'], far: '#d99a62', near: '#e8b97c', top: '#d9a066', fauna: ['🌵', '🦎', '🌵'] },
  forest:    { sky: ['#cfe9d8', '#a9d6e5'], far: '#4f7d5a', near: '#2f5e3f', top: '#3f7a4c', fauna: ['🌲', '🦌', '🍄'] },
  mountain:  { sky: ['#bcd7f2', '#e8f2fb'], far: '#7f93b2', near: '#5d7590', top: '#f4f8fb', fauna: ['🦅', '🏔️', '🐐'] },
  arctic:    { sky: ['#cfe3f4', '#f3f9fd'], far: '#c9dbea', near: '#e9f2f8', top: '#ffffff', water: '#7fb6d6', fauna: ['🐧', '❄️', '🦭'] },
  tropical:  { sky: ['#ffd27a', '#8fe0e0'], far: '#3f9a6a', near: '#2f7d50', top: '#5fbf7a', water: '#22b3c4', fauna: ['🌴', '🦜', '🐢'] },
  grassland: { sky: ['#ffe4a8', '#bfe3f0'], far: '#a7bf73', near: '#c9b860', top: '#d8c66f', fauna: ['🌾', '🦬', '🌼'] },
  urban:     { sky: ['#c9d3e6', '#eef1f7'], far: '#9aa7bd', near: '#7a879c', top: '#8d99ae', fauna: ['🏙️', '🚏', '🐦'] },
};

function sceneSVG(env, people, vehicle) {
  const sc = SCENES[env] || SCENES.island;
  const land = sc.water ? 'M78 120 C92 100 112 80 140 77 C168 74 186 84 200 88 L200 120 L0 120Z' : 'M0 108 C50 84 90 96 130 82 C170 70 200 84 200 84 L200 120 L0 120Z';
  return `<div class="scene ${sc.water ? 'wet' : ''}">
    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sc.sky[0]}"/><stop offset="1" stop-color="${sc.sky[1]}"/></linearGradient></defs>
      <rect width="200" height="120" fill="url(#sky)"/>
      <circle cx="160" cy="30" r="13" fill="#ffe08a" class="sun"/>
      <path d="M0 86 C30 66 55 70 80 62 C105 54 120 70 145 64 C170 58 185 70 200 66 L200 120 L0 120Z" fill="${sc.far}" opacity=".75"/>
      ${sc.water ? `<rect y="86" width="200" height="34" fill="${sc.water}"/>` : ''}
      ${sc.water ? `<g class="waves" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"><path d="M-20 98 q5 -3 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0"/><path d="M-20 108 q5 -3 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0" stroke-opacity=".35"/></g>` : ''}
      ${sc.arch ? `<path d="M14 92 L16 70 C19 62 38 60 46 67 L50 92 L42 92 L41 80 C38 73 27 73 25 80 L23 92Z" fill="${sc.near}"/><path d="M15 72 C19 63 38 61 47 68 L46 71 C38 64 21 65 16 74Z" fill="${sc.top}"/>` : ''}
      <path d="${land}" fill="${sc.near}"/>
      <path d="${land.replace(/ L200 120 L0 120Z$/, '')}" fill="none" stroke="${sc.top}" stroke-width="4" stroke-linecap="round"/>
      <g class="dig" aria-hidden="true">
        <ellipse cx="114" cy="104" rx="12" ry="4" fill="#efe6d2"/>
        <g fill="#fff8ea">${[[106,103],[110,101],[115,102],[119,104],[112,105],[117,100],[108,106],[121,102]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="1.6" ry="1"/>`).join('')}</g>
        <path d="M150 99 L176 99 L178 106 L148 106 Z" fill="#5a3b22"/>
        <path d="M150 99 L176 99" stroke="#3b2614" stroke-width="1"/>
        <path d="M156.5 99 V106 M163 99 V106 M169.5 99 V106 M149 102.5 H177" stroke="#f4e3b5" stroke-width=".5" opacity=".75"/>
        <path d="M150 99 V95 M176 99 V95 M150 95 H176" stroke="#f4e3b5" stroke-width=".8"/>
        <path d="M181 103 q6 -9 12 0 Z" fill="#8a5a33"/>
        <g stroke="#3b2614" stroke-width=".7"><path d="M131 104 V95"/><path d="M139 107 V98"/><path d="M96 110 V101"/></g>
        <g fill="#e0483a"><path d="M131 95 l5 1.5 -5 1.5Z"/><path d="M139 98 l5 1.5 -5 1.5Z"/><path d="M96 101 l5 1.5 -5 1.5Z"/></g>
      </g>
      <g fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" class="birds"><path d="M40 28 q4 -4 8 0 q4 -4 8 0"/><path d="M62 20 q3 -3 6 0 q3 -3 6 0"/></g>
    </svg>
    <span class="f1">${sc.fauna[0]}</span><span class="f2">${sc.fauna[1]}</span><span class="f3">${sc.fauna[2]}</span>
    ${sc.water ? `<span class="boat">${vehicle === '⛴️' || vehicle === '🛶' ? vehicle : '⛵'}</span>` : ''}
    <div class="walkers">${'🧑‍🔬'.repeat(Math.min(people, 5))}${people > 5 ? `<small>+${people - 5}</small>` : ''}${sc.water ? '' : `<span class="vehicle">${vehicle}</span>`}</div>
  </div>`;
}

function tripPreview() {
  const r = state.plan.request;
  const env = r.environments[0] || 'island';
  const s = planStats();
  const t = TRANSPORT[r.transport] || TRANSPORT.custom;
  return `
    ${sceneSVG(env, r.people, t.icon)}
    <h3>${esc(r.name || 'Untitled field trip')}</h3>
    <p class="muted">${esc(r.destination || 'Somewhere with good context')}${r.startDate ? ` · ${esc(r.startDate)}` : ''}</p>
    <div class="stat-row">
      <div><b>${r.days}</b><span>days</span></div><div><b>${r.people}</b><span>people</span></div>
      <div><b>${W(r.maxWeightKg)}</b><span>weight cap</span></div><div><b>${V(r.maxVolumeL)}</b><span>space cap</span></div>
    </div>
    <div class="tagline">${r.environments.map(e => `<span class="tag">${ENV_ICONS[e] || ''} ${esc(e)}</span>`).join('')}${r.activities.map(a => `<span class="tag alt">${ACT_ICONS[a] || '🏷️'} ${esc(a)}</span>`).join('')}</div>
    <hr>
    <p class="small"><b>Current load-out:</b> ${s.count} items · ${state.plan.containers.length} containers · ${W(s.totalKg)}
      ${r.maxWeightKg ? `(${Math.round(s.weightPct * 100)}% of cap)` : ''}</p>
    ${miniBar(s.weightPct)}
    ${strata()}
    <p class="muted small">Inventory: ${state.items.length} items in ${state.workbook.connected ? esc(state.workbook.name) : 'browser storage'}.</p>`;
}

// Site-map style scale bar + north arrow.
const scaleBar = () => `<svg class="scalebar" viewBox="0 0 132 30" aria-hidden="true">
  <g transform="translate(4 14)">${[0, 1, 2, 3, 4].map(i => `<rect x="${i * 20}" y="0" width="20" height="6" fill="${i % 2 ? 'var(--card)' : 'var(--ink)'}" stroke="var(--ink)" stroke-width="1.2"/>`).join('')}
  <text x="0" y="15" class="sb-t">0</text><text x="100" y="15" class="sb-t" text-anchor="end">5 m</text></g>
  <g transform="translate(118 3)"><path d="M6 0 L11 18 L6 14 L1 18 Z" fill="var(--fox)" stroke="var(--ink)" stroke-width="1"/><text x="6" y="27" text-anchor="middle" class="sb-n">N</text></g>
</svg>`;

// Decorative stratigraphic profile (Munsell-ish soil layers with a few finds),
// drawn as a seamless tile so it repeats at any width without distortion.
const STRATA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 60" width="600" height="60">
  <rect width="600" height="60" fill="#e7d3a8"/>
  <path d="M0 10 C80 6 140 14 220 10 S380 4 460 10 S560 14 600 10 V60 H0Z" fill="#7a5638"/>
  <path d="M0 24 C90 20 160 30 250 25 S420 18 500 25 S570 30 600 24 V60 H0Z" fill="#a8774a"/>
  <path d="M0 40 C70 36 170 44 260 40 S430 34 520 41 S580 44 600 40 V60 H0Z" fill="#cdb084"/>
  <path d="M0 52 C100 49 200 55 300 52 S500 48 600 52 V60 H0Z" fill="#9d8f7a"/>
  <g fill="#fff6e6" opacity=".9">${[[40, 16], [62, 18], [90, 15], [150, 19], [176, 16], [330, 14], [355, 18], [520, 17], [545, 15]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="2.2"/>`).join('')}</g>
  <path d="M262 30 l6 -3 l7 3 l-6 4 Z" fill="#3c3a3f"/>
  <path d="M410 33 l3 -6 l3 6 l-3 9 Z" fill="#2b2b30"/>
  <circle cx="470" cy="47" r="2" fill="#3b2614"/><circle cx="120" cy="46" r="1.6" fill="#3b2614"/>
</svg>`;
const STRATA_URL = `url("data:image/svg+xml,${encodeURIComponent(STRATA_SVG)}")`;
const strata = () => `<div class="strata" style='background-image:${STRATA_URL}' aria-hidden="true"></div>`;

function endDate(r) {
  if (!r.startDate || !r.days) return '';
  const d = new Date(`${r.startDate}T12:00:00`);
  if (isNaN(d)) return '';
  d.setDate(d.getDate() + r.days - 1);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const miniBar = pct => `<div class="minibar"><i style="width:${Math.min(100, pct * 100)}%;background:${pctColor(pct)}"></i></div>`;
const pctColor = p => p > 1 ? 'var(--bad)' : p > 0.85 ? 'var(--warn)' : 'var(--good)';

// ---------------- Pack Board ----------------
function gauge(label, pct, value, sub) {
  const r = 52, len = Math.PI * r, p = Math.max(0, Math.min(pct, 1.25)) / 1.25;
  return `<div class="gauge">
    <svg viewBox="0 0 130 78" aria-hidden="true">
      <path d="M13 70 A52 52 0 0 1 117 70" class="g-track"/>
      <path d="M13 70 A52 52 0 0 1 117 70" class="g-fill" style="stroke:${pctColor(pct)};stroke-dasharray:${len};stroke-dashoffset:${len * (1 - p)}"/>
      <line x1="${65 + 41.6 * Math.cos(Math.PI * (1 - 0.8))}" y1="${70 - 41.6 * Math.sin(Math.PI * (1 - 0.8))}" x2="${65 + 56 * Math.cos(Math.PI * (1 - 0.8))}" y2="${70 - 56 * Math.sin(Math.PI * (1 - 0.8))}" class="g-limit"/>
      <text x="65" y="62" text-anchor="middle" class="g-pct">${Math.round(pct * 100)}%</text>
    </svg>
    <div class="g-label">${label}</div><div class="g-val">${value}</div><div class="g-sub muted">${sub}</div></div>`;
}

function categoryBar(byCat, total) {
  const entries = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="muted small">Weight by category appears here once items are packed.</p>';
  return `<div class="catbar">${entries.map(([c, v]) => `<i style="flex:${v};background:${catInfo(c).color}" title="${esc(c)}: ${W(v)}"></i>`).join('')}</div>
  <div class="legend">${entries.map(([c, v]) => `<span><i style="background:${catInfo(c).color}"></i>${catInfo(c).icon} ${esc(c)} <b>${W(v)}</b> <small>${Math.round(v / total * 100)}%</small></span>`).join('')}</div>`;
}

function tile(p) {
  const it = itemById(p.itemId);
  if (!it) return '';
  return `<div class="tile ${isWorn(it) ? 'worn' : ''}" draggable="true" data-drag="packed" data-item="${esc(it.id)}" data-from="${esc(p.container || 'loose')}" style="--c:${catInfo(it.category).color}" title="${esc(it.name)} · ${W(it.weightKg)} each">
    <span class="ti">${it.icon || catInfo(it.category).icon}</span>
    <span class="tn">${esc(it.name)}</span>
    <span class="tq">×${p.qty}</span>
    <span class="tw">${W(it.weightKg * p.qty)}</span>
    <span class="tile-actions"><button data-tile="dec" title="One less">−</button><button data-tile="inc" title="One more">+</button><button data-tile="rm" title="Remove">✕</button></span>
  </div>`;
}

function viewBoard() {
  const plan = state.plan, r = plan.request, s = planStats();
  const containerOpts = state.items.filter(isContainer);
  const inPlan = {}; plan.packed.forEach(p => { inPlan[p.itemId] = (inPlan[p.itemId] || 0) + p.qty; });
  const shelfItems = state.items.filter(i => !isContainer(i));
  const groups = {};
  shelfItems.forEach(i => (groups[i.category] ||= []).push(i));
  const loose = plan.packed.filter(p => !p.container || !plan.containers.some(c => c.uid === p.container));
  const warnings = [];
  if (s.weightPct > 1) warnings.push(`Over the weight cap by ${W(s.totalKg - r.maxWeightKg)}.`);
  if (r.maxVolumeL && s.transportPct > 1) warnings.push(`Over the volume cap by ${V(s.transportL - r.maxVolumeL)}.`);
  s.overfull.forEach(u => { const c = plan.containers.find(x => x.uid === u); warnings.push(`${itemById(c.itemId)?.name} is overfilled.`); });
  s.shortages.forEach(x => warnings.push(`Using ${x.q}× ${itemById(x.id)?.name} but you own ${x.have}.`));

  return `
  <section class="board-head card">
    <div class="trip-title">
      <h2>🎒 ${esc(r.name || 'Untitled field trip')}</h2>
      ${scaleBar()}
      <p class="muted">${esc(r.destination || 'No destination')} · ${r.days} days · ${r.people} people · ${TRANSPORT[r.transport]?.icon || ''} ${esc(TRANSPORT[r.transport]?.label || r.transport)}
        <button class="link" data-action="go-planner">edit requirements</button></p>
      <div class="row wrap">
        <button class="btn primary" data-action="autopack">⚡ Auto-pack</button>
        <button class="btn" data-action="repack" title="Re-distribute items across containers">🧩 Optimize placement</button>
        <button class="btn" data-action="copy-list">📋 Copy checklist</button>
        <button class="btn success" data-action="save-trip">💾 Save trip to history</button>
        <button class="btn ghost" data-action="clear-board">🗑 Clear</button>
      </div>
    </div>
    <div class="gauges">
      ${gauge('Weight', s.weightPct, W(s.totalKg), `of ${W(r.maxWeightKg)} · ${W(s.kgPerPerson)}/person`)}
      ${gauge('Container fill', s.spacePct, V(s.spacePct * s.capacityL), `of ${V(s.capacityL)} capacity`)}
      ${gauge('Transport volume', s.transportPct, V(s.transportL), `of ${V(r.maxVolumeL)} allowed`)}
    </div>
    <div class="cat-wrap">${categoryBar(s.byCat, s.totalKg)}</div>
    ${warnings.length ? `<div class="warnings">${warnings.map(w => `<span>⚠️ ${esc(w)}</span>`).join('')}</div>` : ''}
    <div class="strata-wrap">${strata()}</div>
  </section>

  <section class="board">
    <aside class="card shelf" data-drop="shelf">
      <div class="card-head"><h3>🧺 Gear shelf</h3><span class="muted small">Drag into a bag, or tap +</span><button class="btn tiny" data-action="ai-intake" title="Add new gear by describing it">🤖 New gear</button></div>
      <input class="search" id="shelfSearch" placeholder="Filter gear…" value="${esc(state.shelfFilter || '')}">
      <div class="shelf-list">
        ${Object.entries(groups).map(([cat, list]) => `
          <div class="shelf-group"><h4 style="--c:${catInfo(cat).color}">${catInfo(cat).icon} ${esc(cat)}</h4>
          ${list.map(it => {
            const used = inPlan[it.id] || 0, rel = relevance(it, r) >= 3;
            return `<div class="shelf-item ${used ? 'used' : ''}" draggable="true" data-drag="shelf" data-item="${esc(it.id)}" data-name="${esc(it.name.toLowerCase())}">
              <span class="ti">${it.icon || catInfo(it.category).icon}</span>
              <span class="sn">${esc(it.name)} ${rel ? '<span class="star" title="Matches this trip">★</span>' : ''}<small>${W(it.weightKg)} · ${VS(itemVolume(it))}</small></span>
              <span class="su ${used > (it.qtyOwned || Infinity) ? 'bad' : ''}">${used}/${it.qtyOwned || '∞'}</span>
              <button class="add" data-shelf-add="${esc(it.id)}" title="Add to plan">+</button>
            </div>`;
          }).join('')}</div>`).join('') || '<p class="muted">No gear yet. Add items in Inventory.</p>'}
      </div>
    </aside>

    <div class="packzone">
      <div class="row wrap packzone-head">
        <h3>🧳 Containers</h3>
        <select id="addContainer"><option value="">＋ Add a container…</option>
          ${containerOpts.map(c => `<option value="${esc(c.id)}">${c.icon || '🎒'} ${esc(c.name)} (${VS(c.capacityL)})</option>`).join('')}</select>
      </div>
      <div class="containers">
        ${plan.containers.map(c => containerCard(c, s)).join('')}
        <div class="container loose-zone" data-drop="loose">
          <div class="c-head"><span class="c-icon">🧍</span><div><b>Worn / carried loose</b><small class="muted">Boots, jackets, hand-carry items</small></div></div>
          <div class="c-body">${loose.map(tile).join('') || '<p class="muted small drop-hint">Drop items here</p>'}</div>
        </div>
      </div>
    </div>

    <aside class="card ai-panel">${aiPanel()}</aside>
  </section>`;
}

function containerCard(c, s) {
  const it = itemById(c.itemId) || { name: c.itemId, icon: '❓', capacityL: 0, maxLoadKg: 0, weightKg: 0 };
  const pc = s.perContainer[c.uid];
  const vp = pc.cap ? pc.usedL / pc.cap : 0, kp = pc.load ? pc.usedKg / pc.load : 0;
  const items = state.plan.packed.filter(p => p.container === c.uid);
  const fill = Math.min(1, Math.max(vp, kp));
  return `<div class="container ${s.overfull.includes(c.uid) ? 'over' : ''}" data-drop="${esc(c.uid)}" style="--fill:${Math.round(fill * 100)}%;--fillc:${pctColor(Math.max(vp, kp))}">
    <div class="c-head">
      <span class="c-icon">${it.icon || '🎒'}</span>
      <div><b>${esc(it.name)}</b><small class="muted">${W(pc.usedKg + it.weightKg)} packed · ${fmtVolPair(pc.usedL, pc.cap, U())}</small></div>
      <button class="icon-btn" data-remove-container="${esc(c.uid)}" title="Remove container (items go loose)">✕</button>
    </div>
    <div class="c-meters">
      <div title="Volume">${miniBar(vp)}<small>📦 ${Math.round(vp * 100)}%</small></div>
      <div title="Load">${miniBar(kp)}<small>⚖️ ${pc.load ? Math.round(kp * 100) + '%' : '–'}</small></div>
    </div>
    <div class="c-body">${items.map(tile).join('') || '<p class="muted small drop-hint">Drop gear here</p>'}</div>
  </div>`;
}

function aiPanel() {
  const ai = state.plan.ai;
  const c = aiConfig();
  if (!aiReady()) return `<div class="card-head"><h3>🤖 AI trip analyst</h3></div>
    <div class="empty"><div class="big-emoji">🔌</div>
    ${isLocal() ? `<p>The free built-in AI needs <b>WebGPU</b>, which this browser doesn't have. Open FieldPack in a recent <b>Chrome or Edge</b>, or connect a cloud AI.</p>`
      : `<p>Connect Claude, OpenAI, Gemini or a local model to get a detailed trip plan, risk check and load optimization.</p>`}
    <button class="btn accent" data-action="go-settings">AI settings</button></div>`;
  const msgs = ai.messages.map((m, i) => i === 0 && m.role === 'user'
    ? `<details class="brief"><summary>📨 Trip brief sent to ${esc(PROVIDERS[ai.provider]?.label || ai.provider)}</summary><pre>${esc(m.content)}</pre></details>`
    : `<div class="msg ${m.role}">${m.role === 'assistant' ? markdown(stripJson(m.content)) : esc(m.content)}</div>`).join('');
  const sug = ai.suggestion;
  return `<div class="card-head"><h3>🤖 AI trip analyst</h3><span class="muted small">${isLocal() ? `🏕️ Free built-in · ${esc(LOCAL_MODELS.find(m => m.id === c.model)?.label || c.model)}` : c.provider === 'ovh' ? `🌍 Free (OVHcloud) · ${esc(servedModel() || c.model)}` : `${esc(PROVIDERS[c.provider].label.split(' (')[0])} · ${esc(c.model)}`}</span></div>
    <button class="btn accent wide" data-action="ai-analyze" ${aiBusy ? 'disabled' : ''}>${ai.messages.length ? '🔄 Re-analyze current plan' : '✨ Analyze this trip'}</button>
    <div class="chat">${msgs || '<p class="muted small">The AI gets your requirements, full inventory and the current board, then returns a plan you can apply with one click.</p>'}
      ${aiBusy ? `<div class="msg assistant thinking"><span></span><span></span><span></span> ${isLocal() ? 'the built-in AI is working (this can take a minute or two)…' : 'thinking through your trip…'}</div>
        ${isLocal() && loadedModel() !== c.model ? '<div class="ai-progress" id="aiProgress"><div class="minibar"><i style="width:0%;background:var(--teal)"></i></div><span class="small muted">Starting the built-in AI…</span></div>' : ''}` : ''}</div>
    ${sug ? `<div class="suggestion">
      <b>AI packing plan:</b> ${sug.items.length} items in ${sug.containers.length} containers.
      <button class="btn primary wide" data-action="ai-apply">✅ Apply AI plan to board</button>
      ${sug.warnings.length ? `<ul class="warn-list">${sug.warnings.map(w => `<li>⚠️ ${esc(w)}</li>`).join('')}</ul>` : ''}
      ${sug.missing.length ? `<p class="small"><b>Suggested additions</b></p><ul class="missing">${sug.missing.map((m, i) => `<li><span>🛒 ${esc(m.name)} <small class="muted">${esc(m.reason || '')}</small></span><button class="btn tiny" data-missing="${i}">＋ Inventory</button></li>`).join('')}</ul>` : ''}
    </div>` : ''}
    ${ai.messages.length ? `<form class="followup" id="followup"><input name="q" placeholder="Ask a follow-up… (e.g. what if it rains all week?)" ${aiBusy ? 'disabled' : ''}><button class="btn" ${aiBusy ? 'disabled' : ''}>Send</button></form>` : ''}`;
}

// ---------------- Inventory ----------------
function viewInventory() {
  const f = state.invFilter || { q: '', cat: '', sort: 'category' };
  let list = state.items.filter(i => (!f.cat || i.category === f.cat) &&
    (!f.q || `${i.name} ${i.id} ${splitList(i.useCases).join(' ')} ${i.notes}`.toLowerCase().includes(f.q.toLowerCase())));
  const sorters = { category: (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name), name: (a, b) => a.name.localeCompare(b.name),
    weight: (a, b) => b.weightKg - a.weightKg, qty: (a, b) => (b.qtyOwned || 0) - (a.qtyOwned || 0) };
  list = list.sort(sorters[f.sort] || sorters.category);
  const totalUnits = state.items.reduce((s, i) => s + (i.qtyOwned || 0), 0);
  const totalKg = state.items.reduce((s, i) => s + i.weightKg * (i.qtyOwned || 0), 0);
  const cap = state.items.filter(isContainer).reduce((s, i) => s + i.capacityL * (i.qtyOwned || 1), 0);
  const byCat = {}; state.items.forEach(i => { byCat[i.category] = (byCat[i.category] || 0) + 1; });
  const inPlan = new Set(state.plan.packed.map(p => p.itemId).concat(state.plan.containers.map(c => c.itemId)));
  return `
  <section class="inv-head">
    <div class="kpis">
      <div class="kpi"><span>🧾</span><b>${state.items.length}</b><small>item types</small></div>
      <div class="kpi"><span>🔢</span><b>${totalUnits}</b><small>units owned</small></div>
      <div class="kpi"><span>⚖️</span><b>${W(totalKg)}</b><small>total gear weight</small></div>
      <div class="kpi"><span>🎒</span><b>${V(cap)}</b><small>container capacity</small></div>
    </div>
    <form class="card quickadd" id="quickAdd">
      <b>⚡ Quick add</b>
      <select name="category">${Object.keys(CATEGORIES).map(c => `<option>${c}</option>`).join('')}</select>
      <input name="name" placeholder="Item name" required>
      <input name="weight" type="number" step="any" min="0" placeholder="Weight (${weightUnit(U())})">
      <input name="qty" type="number" min="0" placeholder="Qty" value="1">
      <button class="btn primary">Add</button>
      <button type="button" class="btn accent" data-action="ai-intake">🤖 Add with AI</button>
      <button type="button" class="btn" data-action="new-item">＋ Detailed item…</button>
    </form>
  </section>
  <section class="card">
    <div class="row wrap filters">
      <input class="search" id="invSearch" placeholder="Search name, tag, notes…" value="${esc(f.q)}">
      <div class="chips">
        <button class="chip ${!f.cat ? 'on' : ''}" data-invcat="">All ${state.items.length}</button>
        ${Object.keys(CATEGORIES).filter(c => byCat[c]).map(c => `<button class="chip ${f.cat === c ? 'on' : ''}" data-invcat="${c}" style="--c:${catInfo(c).color}">${catInfo(c).icon} ${c} <small>${byCat[c]}</small></button>`).join('')}
      </div>
      <label class="inline">Sort <select id="invSort">${['category', 'name', 'weight', 'qty'].map(s => `<option ${f.sort === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    </div>
    <div class="inv-grid">
      ${list.map(i => `<button class="inv-card" data-edit="${esc(i.id)}" style="--c:${catInfo(i.category).color}">
        <span class="inv-icon">${i.icon || catInfo(i.category).icon}</span>
        <span class="inv-qty">×${i.qtyOwned || 0}</span>
        ${inPlan.has(i.id) ? '<span class="inv-inplan" title="In current plan">🎒</span>' : ''}
        <b>${esc(i.name)}</b>
        <small class="muted">${esc(i.id)} · ${esc(i.category)}</small>
        <span class="inv-stats">⚖️ ${W(i.weightKg)} · 📦 ${VS(itemVolume(i))}${isContainer(i) ? ` · holds ${VS(i.capacityL)}` : ''}</span>
        <span class="tags">${splitList(i.useCases).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${i.consumable ? '<span class="tag alt">consumable</span>' : ''}${i.perPerson ? '<span class="tag alt">per person</span>' : ''}</span>
      </button>`).join('') || '<p class="muted">No items match.</p>'}
    </div>
  </section>`;
}

// ---------------- History ----------------
function viewHistory() {
  const trips = [...state.trips].sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return `<section class="card">
    <div class="card-head"><h2>📜 Trip history</h2><span class="muted">Stored in the <b>Trips</b> sheet of your workbook.</span></div>
    <div class="history">
    ${trips.map(t => `<article class="trip-card">
      <div class="tag-head"><span class="hole"></span>FIELD TAG <span>${esc(t.id)}</span></div>
      <div class="trip-top"><b>${esc(t.name || 'Untitled trip')}</b><span class="status s-${esc(t.status || 'planned')}">${esc(t.status || 'planned')}</span></div>
      <p class="muted small">Recorded ${esc(String(t.created).slice(0, 16).replace('T', ' '))}</p>
      <p>📍 ${esc(t.destination || '-')} · 📅 ${esc(t.startDate || '-')} · ${t.days}d · 👥 ${t.people}</p>
      <p class="small">⚖️ ${W(t.totalWeightKg || 0)} / ${W(t.maxWeightKg || 0)} · ${(t.environments || []).map(e => ENV_ICONS[e] || e).join(' ')} ${(t.activities || []).map(a => ACT_ICONS[a] || '').join('')}</p>
      ${t.aiAnalysis ? `<p class="small">🤖 AI analysis by ${esc(t.aiProvider || '')} ${esc(t.aiModel || '')}</p>` : ''}
      <div class="row wrap">
        <button class="btn small primary" data-load-trip="${esc(t.id)}">Open on board</button>
        <button class="btn small" data-dup-trip="${esc(t.id)}">Duplicate as new</button>
        ${t.aiAnalysis ? `<button class="btn small" data-view-ai="${esc(t.id)}">View AI plan</button>` : ''}
        <select class="small" data-trip-status="${esc(t.id)}">${['planned', 'packed', 'in field', 'completed', 'cancelled'].map(s => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <button class="btn small ghost danger-text" data-del-trip="${esc(t.id)}">Delete</button>
      </div>
    </article>`).join('') || '<div class="empty"><div class="big-emoji">🏺</div><p>No field trips recorded yet. Build a plan and hit <b>Save trip to history</b>.</p></div>'}
    </div></section>`;
}

// ---------------- Settings ----------------
function specLookupCard() {
  const sp = settings.search || {};
  const mode = settings.ai.specMode || 'auto';
  return `<div class="card" id="specCard">
    <div class="card-head"><h2>🔎 Spec lookups</h2><span class="muted">How "Add gear with AI" checks weights and sizes on the web.</span></div>
    ${CONFIG.specProxyUrl ? '<p class="small">✅ This site provides <b>Google Search spec checks for everyone</b>; no key needed. A personal Gemini or Claude key below takes priority if you add one.</p>' : ''}
    <div class="row wrap">
      <label class="check"><input type="radio" name="specMode" value="auto" ${mode === 'auto' ? 'checked' : ''}> <b>Auto</b>: use Gemini (Google Search) or Claude web search when a key is saved below or in AI connection, otherwise the free lookup</label>
      <label class="check"><input type="radio" name="specMode" value="free" ${mode === 'free' ? 'checked' : ''}> Free lookup only</label>
    </div>
    <div class="grid2">
      <label>Gemini key for spec checks <small class="muted">(best free option: Google Search results; free tier from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>, daily limits apply)</small>
        <input id="specGeminiKey" type="password" autocomplete="off" value="${esc(settings.ai.keys?.gemini || '')}" placeholder="AIza…"></label>
      <div></div>
      <label>Free search API <small class="muted">(optional, improves the free lookup)</small>
        <select id="searchProv">${Object.entries(SEARCH_PROVIDERS).map(([k, v]) => `<option value="${k}" ${sp.provider === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
      <label>Search API key <a class="small" id="searchKeyLink" href="${SEARCH_PROVIDERS[sp.provider || 'tavily'].keyUrl}" target="_blank" rel="noopener">get a free key ↗</a>
        <input id="searchKey" type="password" autocomplete="off" value="${esc(sp.key || '')}" placeholder="${esc(SEARCH_PROVIDERS[sp.provider || 'tavily'].hint)}"></label>
    </div>
    <div class="row wrap" style="margin-top:.7rem"><button class="btn primary" data-action="spec-save">Save</button><button class="btn" data-action="spec-test">🔎 Test search</button><span id="specTestOut" class="muted small"></span></div>
    <p class="muted small">Without any key, FieldPack reads the manufacturer's page the AI points to, searches Marginalia when it isn't busy, tries the manufacturer's own site search, and follows matching product links. Tavily, Serper and Jina each offer a free tier with sign-up; keys stay in this browser only.</p>
  </div>`;
}

function cloudCard() {
  const cs = cloud.cloudSettings();
  const wb = state.workbook;
  return `<div class="card" id="cloudCard">
    <div class="card-head"><h2>☁️ Excel Online</h2><span class="muted">Keep the database in OneDrive or SharePoint so the whole team can use it.</span></div>
    <div class="note-box sync-box">
      <b>⭐ Easiest: OneDrive sync (no Entra, no admin, no setup)</b>
      <p class="small">Works with any Excel file you own or can edit in OneDrive, SharePoint or Teams. FieldPack edits the synced copy on your computer and the OneDrive app uploads every save to Excel Online automatically.</p>
      <ol class="small setup-steps">
        <li>Make sure the <b>OneDrive</b> app is signed in on this computer (it's built into Windows 10/11 and available for Mac).</li>
        <li>Find the workbook in File Explorer / Finder under <b>OneDrive</b>. For a SharePoint/Teams file, open its library in the browser and click <b>Add shortcut to My files</b> (or <b>Sync</b>).</li>
        <li>Right-click the file → <b>Always keep on this device</b> (recommended).</li>
        <li>Click below and pick that file. Leave <b>Auto-save</b> on (Excel database card) and every change is uploaded to Excel Online within seconds.</li>
      </ol>
      <div class="row wrap"><button class="btn primary" data-action="wb-open-local">📂 Open my OneDrive-synced workbook</button>
        <span class="muted small">Needs Chrome or Edge on a computer. Tip: avoid editing the same file in Excel at the same moment; OneDrive would keep both copies.</span></div>
    </div>
    <h3 class="cloud-adv">Direct connection (Microsoft sign-in)</h3>
    <p class="muted small">Opens files straight from OneDrive/SharePoint in any browser, but needs an app registration in Microsoft Entra (done once, by you or your IT admin).</p>
    ${wb.connected && wb.cloud ? `<p>Connected to <b>${esc(wb.name)}</b> in Excel Online. ${wb.webUrl ? `<a href="${esc(wb.webUrl)}" target="_blank" rel="noopener">Open in Excel ↗</a>` : ''}</p>` : ''}
    ${cloud.siteClientId() && !cs.clientId ? '<p class="small">✅ This site is already set up for Excel Online. Just sign in with your Microsoft account.</p>' : ''}
    <div class="grid2"><label>Microsoft app Client ID ${cloud.siteClientId() ? '<small class="muted">(optional, overrides the site default)</small>' : ''}<input id="cloudClientId" value="${esc(cs.clientId)}" placeholder="${cloud.siteClientId() ? 'using the site default' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}" autocomplete="off"></label>
      <div class="cloud-acct"><span class="small muted">Account</span><b id="cloudAcct">${cloud.cloudConfigured() ? 'Checking…' : 'Not set up yet'}</b></div></div>
    <div class="row wrap" style="margin-top:.8rem">
      <button class="btn" data-action="cloud-save-id">Save Client ID</button>
      <button class="btn primary" data-action="cloud-signin" ${cloud.cloudConfigured() ? '' : 'disabled'}>Sign in with Microsoft</button>
      <button class="btn accent" data-action="cloud-browse" ${cloud.cloudConfigured() ? '' : 'disabled'}>☁️ Browse workbooks</button>
      <button class="btn" data-action="cloud-link" ${cloud.cloudConfigured() ? '' : 'disabled'}>🔗 Open from link</button>
      <button class="btn" data-action="cloud-new" ${cloud.cloudConfigured() ? '' : 'disabled'}>✨ New in OneDrive</button>
      <button class="btn ghost" data-action="cloud-signout" ${cloud.cloudConfigured() ? '' : 'disabled'}>Sign out</button>
    </div>
    <details><summary>${cloud.siteClientId() ? 'Use your own app registration instead (optional)' : 'One-time setup (about 5 minutes, free)'}</summary>
      <ol class="small setup-steps">
        <li>Go to <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Microsoft Entra → App registrations</a> (or <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Azure portal</a>) and sign in with your Microsoft account. Click <b>New registration</b>.</li>
        <li>Name it <b>FieldPack</b>. Under <i>Supported account types</i>, pick <b>Accounts in any organizational directory and personal Microsoft accounts</b> (or only your organization, if IT prefers).</li>
        <li>Under <i>Redirect URI</i>, choose platform <b>Single-page application (SPA)</b> and enter exactly:<br><code class="copy">${esc(cloud.redirectUri())}</code><br>
          Add one redirect URI for every address you open FieldPack from (e.g. your published web address too).</li>
        <li>Click <b>Register</b>, then copy the <b>Application (client) ID</b> and paste it above.</li>
        <li>Under <b>API permissions</b>, confirm <i>Microsoft Graph → User.Read</i> and add <i>Files.ReadWrite.All</i> (delegated). In a work tenant, an admin may need to grant consent.</li>
      </ol>
      <p class="muted small">The Client ID isn't a secret. Sign-in happens directly with Microsoft; FieldPack never sees your password, and files go straight between your browser and Microsoft.</p>
    </details>
  </div>`;
}

function localSettings(c) {
  const gpu = hasWebGPU();
  return `<div class="local-ai">
    <p><b>No key, no account, no cost.</b> An open-weight model runs right here in your browser on your computer's graphics chip. Your trip and inventory never leave this machine.
    The first run downloads the model once; after that it's cached and even works offline.</p>
    <p class="small" id="gpuStatus">${gpu ? '⏳ Checking graphics support…' : '⚠️ This browser has no WebGPU. Use a recent Chrome or Edge on a computer with a reasonably modern GPU.'}</p>
    <div class="model-pick">${LOCAL_MODELS.map(m => `<label class="model-opt ${c.model === m.id ? 'on' : ''}">
      <input type="radio" name="localModel" value="${esc(m.id)}" ${c.model === m.id ? 'checked' : ''}>
      <span><b>${esc(m.label)}</b> <small class="muted">${esc(m.size)} · ${esc(m.vram)}</small><br><small>${esc(m.note)}</small>
      <small class="cache-flag" data-cache="${esc(m.id)}"></small></span></label>`).join('')}</div>
    <div class="row wrap"><button class="btn primary" data-action="ai-save">Save</button>
      <button class="btn" data-action="ai-test" ${gpu ? '' : 'disabled'}>⬇️ Download &amp; test now</button><span id="aiTestOut" class="muted small"></span></div>
    <div class="ai-progress" id="aiProgress" hidden><div class="minibar"><i style="width:0%;background:var(--teal)"></i></div><span class="small muted"></span></div>
    <p class="muted small">Small local models are slower and less thorough than big cloud models like Claude. For the deepest analysis, connect a cloud AI; for privacy and zero cost, use this.</p>
  </div>`;
}

function viewSettings() {
  const c = aiConfig();
  const p = PROVIDERS[c.provider];
  return `<section class="settings">
    <div class="card">
      <div class="card-head"><h2>🤖 AI connection</h2><span class="muted">Use the free built-in AI, or bring your own. Requests never go through any FieldPack server.</span></div>
      <div class="providers">${Object.entries(PROVIDERS).map(([k, v]) => `<button class="tcard ${c.provider === k ? 'on' : ''}" data-provider="${k}">
        <span>${{ ovh: '🌍', local: '🏕️', openrouter: '🆓', anthropic: '✳️', openai: '⚪', gemini: '💎', compatible: '🦙' }[k]}</span>${esc(v.label)}</button>`).join('')}</div>
      ${c.provider === 'local' ? localSettings(c) : `<div class="grid2">
        ${c.provider === 'openrouter' || c.provider === 'ovh'
          ? `<label>Free model <select id="aiModel"><option value="${esc(c.model)}">${esc(c.model)}</option></select><small class="muted" id="freeModelsNote">Loading the current list of free models…</small></label>`
          : `<label>Model<input id="aiModel" value="${esc(settings.ai.model)}" placeholder="${esc(p.defaultModel)}"></label>`}
        <label>API key ${p.keyUrl ? `<a href="${p.keyUrl}" target="_blank" rel="noopener" class="small">get a key ↗</a>` : ''}<input id="aiKey" type="password" autocomplete="off" value="${esc(c.apiKey)}" placeholder="${esc(p.keyHint)}"></label>
        ${c.provider === 'compatible' ? `<label class="span2">Base URL<input id="aiBase" value="${esc(settings.ai.baseUrl)}" placeholder="${esc(p.baseUrl)}"></label>` : ''}
      </div>
      <div class="row wrap"><button class="btn primary" data-action="ai-save">Save</button><button class="btn" data-action="ai-test">🔌 Test connection</button><span id="aiTestOut" class="muted small"></span></div>
      <p class="muted small">🔐 Your key is stored only in this browser's local storage, and the Excel file never sees it. Use a key with a spending limit.
      ${c.provider === 'compatible' ? 'For Ollama, start it with <code>OLLAMA_ORIGINS=*</code> so the browser can reach it.' : ''}
      ${c.provider === 'anthropic' ? 'Claude is called with direct browser access enabled, and refusals fall back automatically on current models.' : ''}</p>
      ${c.provider === 'ovh' ? `<div class="note-box"><b>🌍 Works right away: no account, no key.</b> Uses open-weight models (gpt-oss, Llama, Qwen, Mistral) on OVHcloud AI Endpoints, hosted in France under EU data-protection rules.
        Without a key you get 2 requests per minute per model; FieldPack automatically switches to another open model if one is busy. A free OVHcloud key (optional) raises that to 400/minute.
        <br><b>Privacy:</b> your trip details go to OVHcloud to be answered. For confidential site locations, use the built-in AI (runs on this computer).</div>` : ''}
      ${c.provider === 'openrouter' ? `<div class="note-box"><b>🆓 Free open models, in the cloud.</b> Create a free OpenRouter account (no credit card), make a key, and paste it above.
        You get open-weight models like Gemma and Nemotron at no cost, with daily limits (roughly 50 requests/day on a free account) and automatic fallback to another free model if one is busy.
        <br><b>Privacy:</b> free providers may log prompts. Don't put exact site locations or other confidential details in trip notes when using free cloud models; use the built-in AI for sensitive trips.</div>` : ''}`}
    </div>
    ${specLookupCard()}
    ${cloudCard()}
    <div class="card">
      <div class="card-head"><h2>📗 Excel database</h2></div>
      <p>${state.workbook.connected ? `Connected to <b>${esc(state.workbook.name)}</b>. ${excel.canSaveInPlace ? 'Saves write straight back into the file.' : ''}` : 'No workbook connected. Data lives in this browser until you save.'}</p>
      <div class="row wrap">
        <button class="btn primary" data-action="wb-open">📂 Open workbook</button>
        <button class="btn" data-action="wb-new">✨ New workbook from current data</button>
        <button class="btn" data-action="wb-save">💾 Save now</button>
        ${state.workbook.connected ? '<button class="btn ghost" data-action="wb-disconnect">Disconnect</button>' : ''}
      </div>
      <label class="check"><input type="checkbox" id="autosave" ${settings.autosave ? 'checked' : ''}> Auto-save changes to the workbook</label>
      ${excel.canSaveInPlace ? '' : '<p class="muted small">ℹ️ This browser cannot write files in place, so Save downloads an updated .xlsx. Use Chrome or Edge for live two-way sync.</p>'}
      <details><summary>Workbook layout</summary>
        <p class="small"><b>Items</b>: ${excel.columnLabels(excel.ITEM_COLS).map(c => esc(c)).join(' · ')}</p>
        <p class="small"><b>Trips</b>: ${excel.columnLabels(excel.TRIP_COLS).map(c => esc(c)).join(' · ')}</p>
        <p class="small muted">Headers are matched loosely (for example "Weight (lb)" converts automatically). Other sheets in your workbook are left untouched.</p>
      </details>
    </div>
    <div class="card">
      <div class="card-head"><h2>⚙️ Preferences</h2></div>
      <div class="row wrap">
        <label class="inline">Units <select id="units"><option value="imperial" ${U() === 'imperial' ? 'selected' : ''}>Imperial (lb, in, cu in / cu ft)</option><option value="metric" ${U() === 'metric' ? 'selected' : ''}>Metric (kg, cm, L)</option></select></label>
        <button class="btn" data-action="load-sample">Load sample gear</button>
        <button class="btn ghost danger-text" data-action="reset-all">Reset browser data</button>
      </div>
    </div>
  </section>`;
}

// =====================================================================
// After-render wiring (things delegation can't easily handle)
// =====================================================================
function afterRender() {
  const addAct = $('#addAct');
  if (addAct) addAct.onsubmit = e => {
    e.preventDefault();
    const a = addAct.act.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!a) return;
    settings.customActivities = [...new Set([...(settings.customActivities || []), a])]; saveSettings();
    if (!state.plan.request.activities.includes(a)) state.plan.request.activities.push(a);
    commit({ dirty: false });
    toast(`Added "${a}". Tag gear with it in Inventory so auto-pack can match it.`, 'ok');
  };
  const shelfSearch = $('#shelfSearch');
  if (shelfSearch) {
    const apply = () => {
      const q = shelfSearch.value.toLowerCase(); state.shelfFilter = shelfSearch.value;
      $$('.shelf-item').forEach(el => el.hidden = q && !el.dataset.name.includes(q));
      $$('.shelf-group').forEach(g => g.hidden = !$$('.shelf-item', g).some(el => !el.hidden));
    };
    shelfSearch.oninput = apply; apply();
  }
  const addC = $('#addContainer');
  if (addC) addC.onchange = () => {
    if (!addC.value) return;
    state.plan.containers.push({ uid: uid('C'), itemId: addC.value });
    commit({ dirty: false });
  };
  const inv = $('#invSearch');
  if (inv) inv.oninput = debounce(() => { state.invFilter = { ...(state.invFilter || {}), q: inv.value }; render(); $('#invSearch').focus(); $('#invSearch').setSelectionRange(9e9, 9e9); }, 200);
  const sort = $('#invSort');
  if (sort) sort.onchange = () => { state.invFilter = { ...(state.invFilter || {}), sort: sort.value }; render(); };
  const qa = $('#quickAdd');
  if (qa) qa.onsubmit = e => {
    e.preventDefault();
    const f = new FormData(qa);
    const category = f.get('category');
    upsertItem({ id: nextItemId(category), name: String(f.get('name')).trim(), category, icon: suggestIcon(f.get('name'), catInfo(category).icon),
      weightKg: weightFromDisplay(f.get('weight'), U()), qtyOwned: num(f.get('qty'), 1) });
    toast(`Added ${f.get('name')}`, 'ok');
  };
  const fu = $('#followup');
  if (fu) fu.onsubmit = e => { e.preventDefault(); const q = fu.q.value.trim(); if (q) aiFollowup(q); };
  const units = $('#units');
  if (units) units.onchange = () => { settings.units = units.value; saveSettings(); render(); };
  const as = $('#autosave');
  if (as) as.onchange = () => { settings.autosave = as.checked; saveSettings(); };
  $$('[data-trip-status]').forEach(sel => sel.onchange = () => {
    const t = state.trips.find(x => x.id === sel.dataset.tripStatus); t.status = sel.value; commit();
  });
  $$('input[name=localModel]').forEach(r => r.onchange = () => {
    settings.ai.model = r.value; saveSettings();
    $$('.model-opt').forEach(o => o.classList.toggle('on', o.contains(r)));
  });
  if ($('.cache-flag')) refreshCacheFlags();
  const sprov = $('#searchProv');
  if (sprov) sprov.onchange = () => { const v = SEARCH_PROVIDERS[sprov.value]; $('#searchKeyLink').href = v.keyUrl; $('#searchKey').placeholder = v.hint; };
  const acctEl = $('#cloudAcct');
  if (acctEl && cloud.cloudConfigured()) cloud.currentAccount().then(a => { const el = $('#cloudAcct'); if (el) el.textContent = a ? `${a.name || ''} (${a.username})` : 'Not signed in'; });
  const freeSel = $('select#aiModel');
  if (freeSel && aiConfig().provider === 'ovh') fetchOvhModels().then(ids => {
    settings.ai.ovhModels = ids; saveSettings();
    const cur = aiConfig().model;
    if (!ids.includes(cur)) ids.unshift(cur);
    freeSel.innerHTML = ids.map(id => `<option value="${esc(id)}" ${id === cur ? 'selected' : ''}>${esc(id)}${id === 'gpt-oss-120b' ? ' (recommended)' : ''}</option>`).join('');
    const note = $('#freeModelsNote'); if (note) note.textContent = `${ids.length} open models available. If yours is busy, the next one answers.`;
  }).catch(() => { const note = $('#freeModelsNote'); if (note) note.textContent = 'Could not load the model list; using the saved model.'; });
  else if (freeSel) fetchFreeModels().then(list => {
    settings.ai.freeModels = list.map(m => m.id); saveSettings();
    const cur = aiConfig().model;
    if (!list.some(m => m.id === cur)) list.unshift({ id: cur, name: `${cur} (not in current free list)`, context: 0 });
    freeSel.innerHTML = list.map(m => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.name)}${m.context ? ` · ${Math.round(m.context / 1000)}K context` : ''}</option>`).join('');
    const note = $('#freeModelsNote'); if (note) note.textContent = `${list.length} free models available right now. The list changes over time.`;
  }).catch(() => { const note = $('#freeModelsNote'); if (note) note.textContent = 'Could not load the free model list; using the saved model.'; });
  if ($('#gpuStatus') && hasWebGPU()) gpuStatus().then(g => {
    const el = $('#gpuStatus'); if (!el) return;
    el.textContent = `${g.ok ? '✅' : '⚠️'} ${g.message}`; el.classList.toggle('danger-text', !g.ok);
  });
  const chatEl = $('.chat');
  if (chatEl && aiBusy) chatEl.scrollTop = chatEl.scrollHeight;
}

function refreshCacheFlags() {
  $$('.cache-flag').forEach(async el => {
    const id = el.dataset.cache;
    const ok = loadedModel() === id || await isModelCached(id);
    el.textContent = ok ? ' ✅ downloaded' : '';
  });
}

// Live download/load progress for the built-in AI (updates the DOM directly so it doesn't re-render the page).
onLocalProgress(r => {
  const el = $('#aiProgress');
  if (!el) return;
  el.hidden = false;
  el.querySelector('i').style.width = `${Math.round((r.progress || 0) * 100)}%`;
  el.querySelector('span').textContent = r.text || '';
});

// =====================================================================
// Actions
// =====================================================================
function setView(v) { state.view = v; persist(); render(); window.scrollTo(0, 0); }

function setRequest(key, value) {
  const r = state.plan.request;
  r[key] = value;
  if (key === 'people' || key === 'transport') {
    const lim = limitsFor(r.transport, r.people);
    if (lim) { r.maxWeightKg = lim.kg; r.maxVolumeL = lim.l; }
  }
  commit({ dirty: false, render: false });
}

function runAutopack() {
  if (!state.items.length) { toast('Your inventory is empty. Add items or load the sample gear first.', 'warn'); return false; }
  const res = autoPack(state.plan.request);
  state.plan.containers = res.containers;
  state.plan.packed = res.packed;
  commit({ dirty: false });
  const s = planStats();
  toast(`Packed ${s.count} items into ${res.containers.length} containers · ${W(s.totalKg)}`, s.weightPct > 1 ? 'warn' : 'ok');
  return true;
}

function addToPlan(itemId, container, qty) {
  const it = itemById(itemId);
  if (!it) return;
  if (isContainer(it) && container === undefined) { state.plan.containers.push({ uid: uid('C'), itemId }); return; }
  if (container === undefined) {
    // pick the first container with room, else loose
    const s = planStats();
    const target = isWorn(it) ? null : state.plan.containers.find(c => {
      const pc = s.perContainer[c.uid]; return pc.cap - pc.usedL >= itemVolume(it) && (!pc.load || pc.load - pc.usedKg >= it.weightKg);
    });
    container = target?.uid ?? null;
  }
  const already = state.plan.packed.some(p => p.itemId === itemId);
  qty ??= already ? 1 : suggestedQty(it, state.plan.request);
  const ex = state.plan.packed.find(p => p.itemId === itemId && p.container === container);
  if (ex) ex.qty += qty; else state.plan.packed.push({ itemId, qty, container });
}

function movePacked(itemId, from, to) {
  const fromKey = from === 'loose' ? null : from;
  const toKey = to === 'loose' ? null : to;
  const src = state.plan.packed.find(p => p.itemId === itemId && (p.container ?? null) === fromKey);
  if (!src || fromKey === toKey) return;
  state.plan.packed = state.plan.packed.filter(p => p !== src);
  if (to === 'shelf') return;
  const ex = state.plan.packed.find(p => p.itemId === itemId && (p.container ?? null) === toKey);
  if (ex) ex.qty += src.qty; else state.plan.packed.push({ ...src, container: toKey });
}

function tripRecord() {
  const p = state.plan, r = p.request, s = planStats(p);
  const analysis = p.ai.messages.filter(m => m.role === 'assistant').map(m => m.content).join('\n\n---\n\n');
  const prev = state.trips.find(t => t.id === p.id);
  return {
    id: p.id, created: prev?.created || new Date().toISOString(), status: prev?.status || 'planned',
    name: r.name, destination: r.destination, startDate: r.startDate, days: r.days, people: r.people,
    environments: r.environments, activities: r.activities, transport: r.transport,
    maxWeightKg: round(r.maxWeightKg, 2), maxVolumeL: round(r.maxVolumeL, 1), mustHaves: r.mustHaves, notes: r.notes,
    totalWeightKg: round(s.totalKg, 2), totalVolumeL: round(s.transportL, 1),
    packingSummary: packingSummary(p),
    packingList: { containers: p.containers, packed: p.packed },
    aiProvider: p.ai.provider || '', aiModel: p.ai.model || '', aiAnalysis: analysis,
  };
}

function planFromTrip(t, asNew = false) {
  const plan = emptyPlan();
  if (!asNew) plan.id = t.id;
  plan.request = { ...defaultRequest(), name: asNew ? `${t.name} (copy)` : t.name, destination: t.destination, startDate: asNew ? '' : t.startDate,
    days: t.days || 1, people: t.people || 1, environments: t.environments || [], activities: t.activities || [], transport: t.transport || 'custom',
    maxWeightKg: t.maxWeightKg || 0, maxVolumeL: t.maxVolumeL || 0, mustHaves: t.mustHaves || '', notes: t.notes || '' };
  plan.containers = t.packingList?.containers || [];
  plan.packed = t.packingList?.packed || [];
  if (t.aiAnalysis && !asNew) {
    plan.ai = { messages: [{ role: 'user', content: '(trip brief from history)' }, { role: 'assistant', content: t.aiAnalysis }],
      provider: t.aiProvider, model: t.aiModel, suggestion: parseSuggestion(t.aiAnalysis) };
  }
  return plan;
}

// ---------- AI ----------
async function confirmLocalDownload(model) {
  if (loadedModel() === model || await isModelCached(model)) return true;
  const m = LOCAL_MODELS.find(x => x.id === model) || { label: model, size: 'a large download', vram: '' };
  return confirmDialog(`The free built-in AI (${m.label}) runs entirely on this computer. The first time, your browser downloads the model (${m.size}${m.vram ? `, needs ${m.vram}` : ''}). After that it's cached and works offline. Download it now?`, 'Download & analyze');
}

async function aiAnalyze() {
  if (!aiReady()) { setView('settings'); toast(isLocal() ? 'The built-in AI needs Chrome or Edge with WebGPU.' : 'Connect an AI provider first.', 'warn'); return; }
  const c = aiConfig();
  if (isLocal()) {
    const gpu = await gpuStatus();
    if (!gpu.ok) { toast(gpu.message, 'bad', 10000); return; }
    if (!(await confirmLocalDownload(c.model))) return;
  }
  const brief = buildTripBrief(undefined, { compact: isLocal() });
  state.plan.ai = { messages: [{ role: 'user', content: brief }], suggestion: null, provider: c.provider, model: c.model };
  await aiRun();
}

async function aiFollowup(q) {
  state.plan.ai.messages.push({ role: 'user', content: q });
  await aiRun();
}

async function aiRun() {
  aiBusy = true; commit({ dirty: false });
  try {
    const msgs = state.plan.ai.messages.map(m => ({ role: m.role, content: m.content }));
    if (msgs[0]?.content === '(trip brief from history)') msgs[0].content = buildTripBrief(undefined, { compact: isLocal() });
    const reply = await chat(systemPrompt(), msgs);
    state.plan.ai.messages.push({ role: 'assistant', content: reply });
    const sug = parseSuggestion(reply);
    if (sug) state.plan.ai.suggestion = sug;
    toast(sug ? 'AI plan ready. Review it and click Apply.' : 'AI replied.', 'ok');
  } catch (e) {
    console.error(e);
    state.plan.ai.messages.pop();
    toast(`AI error: ${e.message}`, 'bad', 8000);
  } finally { aiBusy = false; commit({ dirty: false }); }
}

function aiApply() {
  const sug = state.plan.ai.suggestion;
  if (!sug) return;
  const containers = sug.containers.map(c => ({ uid: uid('C'), itemId: c.itemId }));
  const packed = [];
  sug.items.forEach(x => {
    const container = x.container == null ? null : containers[x.container]?.uid ?? null;
    const ex = packed.find(p => p.itemId === x.id && p.container === container);
    if (ex) ex.qty += x.qty; else packed.push({ itemId: x.id, qty: x.qty, container });
  });
  state.plan.containers = containers; state.plan.packed = packed;
  commit({ dirty: false });
  toast('Applied the AI packing plan ✨', 'ok');
  $$('.tile').forEach((t, i) => { t.style.animationDelay = `${i * 25}ms`; t.classList.add('pop'); });
}

// ---------- Inventory ----------
function startIntake(initial = '') {
  openIntake({
    initial,
    goSettings: () => setView('settings'),
    // The intake window can't open a second dialog, so just verify the GPU here;
    // the intake itself shows the one-time download notice.
    confirmLocal: async () => {
      const g = await gpuStatus();
      if (!g.ok) { toast(g.message, 'bad', 10000); return false; }
      return true;
    },
    onAdd: items => {
      items.forEach(it => upsertItem({ ...it, id: nextItemId(it.category) }));
      toast(`Added ${items.length} item${items.length > 1 ? 's' : ''} to inventory 🎉`, 'ok');
    },
  });
}

function upsertItem(item) {
  item.updated = new Date().toISOString().slice(0, 10);
  const i = state.items.findIndex(x => x.id === item.id);
  const base = { lengthCm: 0, widthCm: 0, heightCm: 0, volumeL: 0, qtyOwned: 1, useCases: [], environments: ['all'], perPerson: false,
    consumable: false, perPersonDay: 0, capacityL: 0, maxLoadKg: 0, notes: '', icon: '', weightKg: 0 };
  if (i >= 0) state.items[i] = { ...state.items[i], ...item }; else state.items.push({ ...base, ...item });
  commit();
}

function itemModal(existing, prefill = {}) {
  const it = existing || { id: '', name: '', category: 'Other', icon: '', weightKg: 0, qtyOwned: 1, useCases: [], environments: ['all'], ...prefill };
  const tagPool = [...new Set([...ACTIVITIES, ...(settings.customActivities || []), 'rain', 'cold', 'hot', 'sun', 'emergency', 'navigation', 'electronics', 'repair', 'worn',
    ...state.items.flatMap(i => splitList(i.useCases))])];
  openModal(`
    <h2>${existing ? 'Edit item' : 'New inventory item'}</h2>
    <form id="itemForm" class="item-form">
      <div class="icon-pick">
        <div class="icon-col"><input name="icon" maxlength="8" value="${esc(it.icon || '')}" class="big-icon" aria-label="Icon">
          <small class="muted">Pick, search, or paste any emoji</small></div>
        ${pickerHtml()}
      </div>
      <div class="grid2">
        <label>Name<input name="name" required value="${esc(it.name)}"></label>
        <label>Category<select name="category">${Object.keys(CATEGORIES).map(c => `<option ${it.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Weight each (${weightUnit(U())})<input name="weight" type="number" step="any" min="0" value="${weightToDisplay(it.weightKg || 0, U())}"></label>
        <label>Qty owned<input name="qtyOwned" type="number" min="0" value="${it.qtyOwned ?? 1}"></label>
      </div>
      <fieldset><legend>Size</legend><div class="grid4">
        <label>Length (${lenUnit(U())})<input name="lengthCm" type="number" step="any" min="0" value="${it.lengthCm ? lenToDisplay(it.lengthCm, U()) : ''}"></label>
        <label>Width (${lenUnit(U())})<input name="widthCm" type="number" step="any" min="0" value="${it.widthCm ? lenToDisplay(it.widthCm, U()) : ''}"></label>
        <label>Height (${lenUnit(U())})<input name="heightCm" type="number" step="any" min="0" value="${it.heightCm ? lenToDisplay(it.heightCm, U()) : ''}"></label>
        <label>Packed vol (${volSmallUnit(U())})<input name="volumeL" type="number" step="any" min="0" value="${it.volumeL ? volSmallToDisplay(it.volumeL, U()) : ''}" placeholder="auto"></label>
      </div></fieldset>
      <fieldset class="container-only"><legend>🎒 Container specs</legend><div class="grid2">
        <label>Capacity (${volSmallUnit(U())})<input name="capacityL" type="number" step="any" min="0" value="${it.capacityL ? volSmallToDisplay(it.capacityL, U()) : ''}"></label>
        <label>Max load (${weightUnit(U())})<input name="maxLoadKg" type="number" step="any" min="0" value="${it.maxLoadKg ? weightToDisplay(it.maxLoadKg, U()) : ''}"></label>
      </div></fieldset>
      <fieldset><legend>Planning rules</legend>
        <label class="check"><input type="checkbox" name="perPerson" ${it.perPerson ? 'checked' : ''}> One per person</label>
        <label class="check"><input type="checkbox" name="consumable" ${it.consumable ? 'checked' : ''}> Consumable, used at
          <input name="perPersonDay" type="number" step="any" min="0" value="${it.perPersonDay || ''}" class="mini"> per person per day</label>
      </fieldset>
      <label>Use cases <small class="muted">(comma separated; tap to add)</small><input name="useCases" value="${esc(splitList(it.useCases).join(', '))}"></label>
      <div class="chips small-chips">${tagPool.slice(0, 60).map(t => `<button type="button" class="chip" data-addtag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <label>Environments</label>
      <div class="chips small-chips">${['all', ...ENVIRONMENTS].map(e => `<button type="button" class="chip ${splitList(it.environments).includes(e) ? 'on' : ''}" data-envtoggle="${e}">${ENV_ICONS[e] || '🌐'} ${e}</button>`).join('')}</div>
      <label>Notes / details<textarea name="notes" rows="2">${esc(it.notes || '')}</textarea></label>
      <div class="row end">
        ${existing ? '<button type="button" class="btn ghost danger-text" id="delItem">Delete</button><span class="grow"></span>' : ''}
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button class="btn primary">${existing ? 'Save changes' : 'Add to inventory'}</button>
      </div>
    </form>`, {
    wide: true,
    onMount: (m, close) => {
      const form = $('#itemForm', m);
      const envs = new Set(splitList(it.environments));
      const syncContainer = () => m.querySelector('.container-only').hidden = form.category.value !== 'Container';
      form.category.onchange = () => { syncContainer(); if (!form.icon.value) form.icon.placeholder = catInfo(form.category.value).icon; };
      syncContainer();
      form.icon.placeholder = catInfo(form.category.value).icon;
      // Suggest an icon from the name until the user picks one themselves.
      let iconTouched = !!it.icon;
      const suggest = () => { if (!iconTouched) form.icon.value = suggestIcon(form.name.value, ''); };
      form.name.addEventListener('input', suggest);
      form.icon.addEventListener('input', () => { iconTouched = true; });
      if (!existing && it.name && !it.icon) suggest();
      wirePicker(m.querySelector('.emoji-picker'), e => { form.icon.value = e; iconTouched = true; });
      m.addEventListener('click', e => {
        const t = e.target.closest('[data-addtag]');
        if (t) { const cur = splitList(form.useCases.value); if (!cur.includes(t.dataset.addtag)) form.useCases.value = [...cur, t.dataset.addtag].join(', '); }
        const ev = e.target.closest('[data-envtoggle]');
        if (ev) { const k = ev.dataset.envtoggle; envs.has(k) ? envs.delete(k) : envs.add(k); ev.classList.toggle('on', envs.has(k)); }
      });
      const del = $('#delItem', m);
      if (del) del.onclick = async () => {
        close();
        if (await confirmDialog(`Delete "${it.name}" from the inventory?`, 'Delete')) {
          state.items = state.items.filter(x => x.id !== it.id);
          state.plan.packed = state.plan.packed.filter(p => p.itemId !== it.id);
          state.plan.containers = state.plan.containers.filter(c => c.itemId !== it.id);
          commit(); toast('Item deleted');
        }
      };
      form.onsubmit = e => {
        e.preventDefault();
        const f = new FormData(form);
        const category = f.get('category');
        const keep = (field, orig, toDisp, fromDisp, digits) => {
          const raw = String(f.get(field) ?? '').trim();
          if (orig && raw !== '' && num(raw) === num(toDisp(orig, U()))) return orig;
          return raw === '' ? 0 : round(fromDisp(raw, U()), digits);
        };
        upsertItem({
          id: existing?.id || nextItemId(category), name: String(f.get('name')).trim(), category,
          icon: String(f.get('icon')).trim() || catInfo(category).icon,
          // Unchanged fields keep their stored value exactly (no drift from unit rounding).
          weightKg: keep('weight', it.weightKg, weightToDisplay, weightFromDisplay, 4), qtyOwned: num(f.get('qtyOwned'), 1),
          lengthCm: keep('lengthCm', it.lengthCm, lenToDisplay, lenFromDisplay, 2), widthCm: keep('widthCm', it.widthCm, lenToDisplay, lenFromDisplay, 2),
          heightCm: keep('heightCm', it.heightCm, lenToDisplay, lenFromDisplay, 2), volumeL: keep('volumeL', it.volumeL, volSmallToDisplay, volSmallFromDisplay, 3),
          capacityL: category === 'Container' ? keep('capacityL', it.capacityL, volSmallToDisplay, volSmallFromDisplay, 2) : 0,
          maxLoadKg: category === 'Container' ? keep('maxLoadKg', it.maxLoadKg, weightToDisplay, weightFromDisplay, 3) : 0,
          perPerson: !!f.get('perPerson'), consumable: !!f.get('consumable'), perPersonDay: num(f.get('perPersonDay')),
          useCases: splitList(f.get('useCases')), environments: [...envs], notes: String(f.get('notes')).trim(),
        });
        close(); toast(existing ? 'Saved' : 'Added to inventory', 'ok');
      };
    },
  });
}

// ---------- Workbook ----------
function wbOpenChooser() {
  openModal(`<h2>Open a workbook</h2>
    <div class="welcome-actions">
      <button class="btn primary big" data-src="local">💻 From this computer</button>
      <button class="btn accent big" data-src="cloud">☁️ From Excel Online (Microsoft sign-in)</button>
    </div>
    <p class="muted small" style="margin-top:.8rem">Tip: a file in your <b>OneDrive folder</b> on this computer is an Excel Online file too. Open it "from this computer" and the OneDrive app syncs every save; no Microsoft sign-in setup needed.</p>`, { onMount: (m, close) => m.addEventListener('click', e => {
      const src = e.target.closest('[data-src]')?.dataset.src; if (!src) return;
      close(); src === 'local' ? wbOpen() : cloudBrowse();
    }) });
}

/** Make sure we're signed in to Microsoft (popup if needed). Returns false if not configured. */
async function cloudEnsureSignedIn() {
  if (!cloud.cloudConfigured()) {
    setView('settings');
    setTimeout(() => $('#cloudCard')?.scrollIntoView({ behavior: 'smooth' }), 50);
    toast('One-time setup: add your Microsoft app Client ID to connect Excel Online.', 'warn', 7000);
    return false;
  }
  if (!(await cloud.currentAccount())) await cloud.signIn();
  return true;
}

async function cloudOpen(f) {
  try {
    toast(`Opening ${f.name} from Excel Online…`);
    const res = await excel.openCloudWorkbook(f);
    pendingCloud = null;
    await loadWorkbookData(res);
  } catch (e) {
    if (e.needsSignIn) { pendingCloud = f; render(); }
    toast(`Could not open ${f.name}: ${e.message}`, 'bad', 8000);
  }
}

async function cloudBrowse() {
  try { if (!(await cloudEnsureSignedIn())) return; } catch (e) { return toast(`Microsoft sign-in failed: ${e.message}`, 'bad', 8000); }
  let files = [];
  const close = openModal(`<h2>☁️ Open from Excel Online</h2>
    <p class="muted small">Your recent and OneDrive workbooks. For a file in a SharePoint/Teams site you haven't opened recently, paste its share link.</p>
    <div class="row wrap"><input id="cloudFilter" class="grow" placeholder="Filter by name…">
      <button class="btn" data-cloud-link>🔗 Open from a link</button><button class="btn" data-cloud-new>✨ New in OneDrive</button></div>
    <div id="cloudList" class="cloud-list"><div class="msg assistant thinking"><span></span><span></span><span></span> Loading your workbooks…</div></div>`, {
    wide: true,
    onMount: m => m.addEventListener('click', e => {
      const b = e.target.closest('[data-cloud-file],[data-cloud-link],[data-cloud-new]'); if (!b) return;
      if (b.dataset.cloudFile !== undefined) { close(); cloudOpen(files[+b.dataset.cloudFile]); }
      if (b.hasAttribute('data-cloud-link')) { close(); cloudOpenLink(); }
      if (b.hasAttribute('data-cloud-new')) { close(); cloudNew(); }
    }),
  });
  const draw = q => {
    const el = $('#cloudList'); if (!el) return;
    const list = files.map((f, i) => ({ f, i })).filter(({ f }) => !q || f.name.toLowerCase().includes(q.toLowerCase()));
    el.innerHTML = list.map(({ f, i }) => `<button class="cloud-file" data-cloud-file="${i}"><span>📗</span><b>${esc(f.name)}</b>
      <small class="muted">${esc(f.where || '')}${f.modified ? ` · modified ${esc(new Date(f.modified).toLocaleString())}` : ''}</small></button>`).join('')
      || '<p class="muted">No workbooks found. Use “Open from a link” or create a new one.</p>';
  };
  try {
    files = await cloud.listWorkbooks();
    draw('');
    const fi = $('#cloudFilter'); if (fi) fi.oninput = () => draw(fi.value);
  } catch (e) { const el = $('#cloudList'); if (el) el.innerHTML = `<p class="danger-text">${esc(e.message)}</p>`; }
}

function cloudOpenLink() {
  openModal(`<h2>🔗 Open from a share link</h2>
    <p class="muted small">In Excel Online (or OneDrive/SharePoint/Teams), click <b>Share → Copy link</b> on the workbook and paste it here.</p>
    <form id="linkForm" class="intake-form"><input name="url" placeholder="https://…sharepoint.com/… or https://1drv.ms/…" required>
      <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Open</button></div></form>`, {
    onMount: (m, close) => { m.querySelector('#linkForm').onsubmit = async e => {
      e.preventDefault(); const url = e.target.url.value.trim(); close();
      try { if (!(await cloudEnsureSignedIn())) return; cloudOpen(await cloud.resolveShareLink(url)); }
      catch (err) { toast(`Could not open that link: ${err.message}`, 'bad', 8000); }
    }; },
  });
}

async function cloudNew() {
  try {
    if (!(await cloudEnsureSignedIn())) return;
    if (!state.items.length) state.items = structuredClone(SAMPLE_ITEMS);
    const f = await excel.createCloudWorkbook(state.items, state.trips);
    Object.assign(state.workbook, { name: f.name, connected: true, cloud: true, webUrl: f.webUrl, dirty: false, lastSaved: new Date().toISOString() });
    pendingHandle = null; pendingCloud = null;
    commit({ dirty: false });
    toast(`Created ${f.name} in your OneDrive (FieldPack folder) ☁️`, 'ok');
  } catch (e) { toast(`Could not create the workbook: ${e.message}`, 'bad', 8000); }
}

async function wbOpen() {
  try {
    const res = await excel.openWorkbook();
    if (!res) return;
    loadWorkbookData(res);
  } catch (e) { toast(`Could not open workbook: ${e.message}`, 'bad', 7000); }
}

async function loadWorkbookData(res) {
  state.items = res.items; state.trips = res.trips;
  Object.assign(state.workbook, { name: res.name, connected: true, cloud: !!res.cloud, webUrl: res.webUrl || '', dirty: false, lastSaved: new Date().toISOString() });
  pendingHandle = null;
  if (!res.cloud) { pendingCloud = null; cloud.rememberFile(null); }
  commit({ dirty: false });
  toast(`Loaded ${res.items.length} items and ${res.trips.length} trips from ${res.name}`, 'ok');
  if (!res.items.length && await confirmDialog('This workbook has no items yet. Add the sample field gear to get started?', 'Add sample gear')) {
    state.items = structuredClone(SAMPLE_ITEMS); commit(); wbSave();
  }
}

async function wbNew() {
  try {
    if (!state.items.length) state.items = structuredClone(SAMPLE_ITEMS);
    const name = await excel.createWorkbook(state.items, state.trips);
    if (!name) return;
    Object.assign(state.workbook, { name, connected: excel.canSaveInPlace, cloud: false, webUrl: '', dirty: false, lastSaved: new Date().toISOString() });
    pendingCloud = null; cloud.rememberFile(null);
    commit({ dirty: false });
    toast(excel.canSaveInPlace ? `Created ${name}` : `Downloaded ${name}. Open it later to keep working.`, 'ok');
  } catch (e) { toast(`Could not create workbook: ${e.message}`, 'bad', 7000); }
}

let saving = false;
async function wbSave({ quiet = false, force = false } = {}) {
  if (saving) return; saving = true;
  try {
    if (!excel.canAutosave() && !quiet && excel.canSaveInPlace && !state.workbook.connected) { saving = false; return wbNew(); }
    const how = await excel.saveWorkbook(state.items, state.trips, state.workbook.name || 'fieldpack-database.xlsx', { force });
    state.workbook.dirty = false; state.workbook.lastSaved = new Date().toISOString();
    commit({ dirty: false });
    if (!quiet) toast({ saved: `Saved to ${state.workbook.name} 📗`, 'saved-cloud': `Saved to ${state.workbook.name} in Excel Online ☁️` }[how] || 'Downloaded updated workbook', 'ok');
  } catch (e) {
    saving = false;
    if (e.status === 412) {
      const ok = await confirmDialog(`${state.workbook.name} was changed in Excel Online since you opened it (maybe by a teammate). Overwrite it with your version? Choose Cancel to keep theirs; then reopen the workbook to get the latest.`, 'Overwrite');
      if (ok) return wbSave({ quiet, force: true });
      return;
    }
    if (e.needsSignIn || e.status === 401) { toast('Sign in to Microsoft again to keep saving (Settings → Excel Online).', 'bad', 8000); return; }
    toast(e.message, 'bad', 8000);
  } finally { saving = false; }
}
const autosave = debounce(() => {
  if (settings.autosave && state.workbook.connected && state.workbook.dirty && excel.canAutosave()) wbSave({ quiet: true });
}, 3000);

function welcome() {
  openModal(`<div class="welcome">
    <div class="big-emoji">🏝️🏺⛏️</div>
    <h2>Welcome to FieldPack</h2>
    <p>From a day of survey to a season of excavation, plan field trips from your real kit. Your inventory and trip history live in an Excel workbook, and your AI of choice does the heavy analysis.</p>
    <div class="welcome-actions">
      <button class="btn primary big" data-w="open">📂 Open my Excel database (this computer)</button>
      <button class="btn big" data-w="cloud">☁️ Open from Excel Online (OneDrive / SharePoint)</button>
      <p class="muted small">Your Excel file lives in OneDrive? If the OneDrive app is on this computer, just use the first button and pick it from your OneDrive folder; saves sync automatically.</p>
      <button class="btn accent big" data-w="new">✨ Create a new database (with sample gear)</button>
      <button class="btn ghost" data-w="try">Just explore with sample data</button>
    </div></div>`, {
    onMount: (m, close) => m.addEventListener('click', e => {
      const w = e.target.closest('[data-w]')?.dataset.w; if (!w) return;
      close();
      if (w === 'open') wbOpen();
      if (w === 'cloud') { state.items = state.items.length ? state.items : structuredClone(SAMPLE_ITEMS); commit({ dirty: false }); cloudBrowse(); }
      if (w === 'new') { state.items = structuredClone(SAMPLE_ITEMS); wbNew(); }
      if (w === 'try') { state.items = structuredClone(SAMPLE_ITEMS); commit(); toast('Loaded sample gear. Try the Quick Planner!', 'ok'); }
    }),
  });
}

// =====================================================================
// Event delegation
// =====================================================================
function onClick(e) {
  const t = e.target.closest('button, [data-action], .pill.clickable, .inv-card');
  if (!t) return;
  const d = t.dataset;

  if (t.id === 'wbStatus' && pendingCloud) {
    cloud.signIn().then(() => cloudOpen(pendingCloud)).catch(err => toast(err.message, 'bad', 8000));
    return;
  }
  if (t.id === 'wbStatus' && pendingHandle) {
    excel.reconnect(pendingHandle).then(loadWorkbookData).catch(err => toast(err.message, 'bad'));
    return;
  }
  if (d.view) return setView(d.view);
  if (d.chip) {
    const arr = state.plan.request[d.chip];
    const i = arr.indexOf(d.val); i >= 0 ? arr.splice(i, 1) : arr.push(d.val);
    t.classList.toggle('on', i < 0);
    commit({ dirty: false, render: false }); $('#tripPreview').innerHTML = tripPreview(); return;
  }
  if (d.step) {
    const r = state.plan.request; setRequest(d.step, Math.max(1, Math.min(d.step === 'days' ? 999 : 99, r[d.step] + num(d.d))));
    return render();
  }
  if (d.transport) { setRequest('transport', d.transport); return render(); }
  if (d.days) { setRequest('days', +d.days); return render(); }
  if (d.delAct) {
    settings.customActivities = (settings.customActivities || []).filter(a => a !== d.delAct); saveSettings();
    state.plan.request.activities = state.plan.request.activities.filter(a => a !== d.delAct);
    return commit({ dirty: false });
  }
  if (d.shelfAdd) { addToPlan(d.shelfAdd); return commit({ dirty: false }); }
  if (d.tile) {
    const el = t.closest('.tile'); const id = el.dataset.item, from = el.dataset.from === 'loose' ? null : el.dataset.from;
    const p = state.plan.packed.find(x => x.itemId === id && (x.container ?? null) === from);
    if (!p) return;
    if (d.tile === 'inc') p.qty++;
    if (d.tile === 'dec') p.qty--;
    if (d.tile === 'rm' || p.qty <= 0) state.plan.packed = state.plan.packed.filter(x => x !== p);
    return commit({ dirty: false });
  }
  if (d.removeContainer) {
    state.plan.containers = state.plan.containers.filter(c => c.uid !== d.removeContainer);
    state.plan.packed.forEach(p => { if (p.container === d.removeContainer) p.container = null; });
    return commit({ dirty: false });
  }
  if (d.edit) return itemModal(itemById(d.edit));
  if (d.invcat !== undefined) { state.invFilter = { ...(state.invFilter || {}), cat: d.invcat }; return render(); }
  if (d.provider) {
    settings.ai.keys ||= {};
    settings.ai.provider = d.provider; settings.ai.model = ''; saveSettings(); return render();
  }
  if (d.missing !== undefined) {
    const m = state.plan.ai.suggestion.missing[+d.missing];
    return startIntake(`Add: ${m.name}${m.estWeightKg ? ` (about ${W(num(m.estWeightKg))})` : ''}. ${m.reason || ''}`.trim());
  }
  if (d.loadTrip || d.dupTrip) {
    const tr = state.trips.find(x => x.id === (d.loadTrip || d.dupTrip));
    state.plan = planFromTrip(tr, !!d.dupTrip); state.view = d.dupTrip ? 'planner' : 'board';
    commit({ dirty: false }); return toast(d.dupTrip ? 'Duplicated. Adjust the requirements.' : `Opened ${tr.name}`, 'ok');
  }
  if (d.viewAi) {
    const tr = state.trips.find(x => x.id === d.viewAi);
    return openModal(`<h2>🤖 ${esc(tr.name)}</h2><p class="muted small">${esc(tr.aiProvider)} · ${esc(tr.aiModel)}</p><div class="md">${markdown(stripJson(tr.aiAnalysis))}</div>`, { wide: true });
  }
  if (d.delTrip) {
    confirmDialog('Delete this trip from history? (It will be removed from the Trips sheet on next save.)', 'Delete').then(ok => {
      if (ok) { state.trips = state.trips.filter(x => x.id !== d.delTrip); commit(); }
    });
    return;
  }

  switch (d.action) {
    case 'go-board': return setView('board');
    case 'go-planner': return setView('planner');
    case 'go-settings': return setView('settings');
    case 'autopack': if (runAutopack()) setView('board'); return;
    case 'autopack-ai': if (runAutopack()) { setView('board'); aiAnalyze(); } return;
    case 'repack': state.plan = binPack(state.plan); commit({ dirty: false }); return toast('Re-distributed items across containers', 'ok');
    case 'clear-board': return confirmDialog('Remove all containers and items from the board?', 'Clear').then(ok => {
      if (ok) { state.plan.containers = []; state.plan.packed = []; commit({ dirty: false }); }
    });
    case 'new-trip': return confirmDialog('Start a new trip? The current board will be cleared (saved trips stay in history).', 'New trip').then(ok => {
      if (ok) { state.plan = emptyPlan(); commit({ dirty: false }); }
    });
    case 'copy-list': {
      const r = state.plan.request, s = planStats();
      const text = `${r.name || 'Trip'}: ${r.destination} (${r.days} days, ${r.people} people)\nTotal: ${W(s.totalKg)}\n\n${packingSummary().split('\n').map(l => `☐ ${l}`).join('\n')}`;
      navigator.clipboard?.writeText(text).then(() => toast('Checklist copied to clipboard 📋', 'ok'), () => toast('Clipboard unavailable', 'warn'));
      return;
    }
    case 'save-trip': {
      const rec = tripRecord();
      const i = state.trips.findIndex(x => x.id === rec.id);
      if (i >= 0) state.trips[i] = rec; else state.trips.push(rec);
      commit();
      toast(`Trip saved to history${state.workbook.connected ? ' and the Trips sheet' : ''}`, 'ok');
      if (state.workbook.connected) wbSave({ quiet: true });
      return;
    }
    case 'ai-analyze': return aiAnalyze();
    case 'ai-apply': return aiApply();
    case 'new-item': return itemModal(null);
    case 'ai-intake': return startIntake();
    case 'ai-save': case 'ai-test': {
      settings.ai.keys ||= {};
      if (isLocal()) {
        settings.ai.model = $('input[name=localModel]:checked')?.value || '';
      } else {
        settings.ai.model = $('#aiModel').value.trim();
        settings.ai.keys[settings.ai.provider] = $('#aiKey').value.trim();
        if ($('#aiBase')) settings.ai.baseUrl = $('#aiBase').value.trim();
      }
      saveSettings();
      if (d.action === 'ai-save') return toast('AI settings saved', 'ok');
      if (isLocal()) {
        const model = aiConfig().model;
        gpuStatus().then(g => g.ok ? confirmLocalDownload(model) : (toast(g.message, 'bad', 10000), false)).then(async ok => {
          if (!ok) return;
          const out = $('#aiTestOut'); if (out) out.textContent = 'Downloading and loading the model…';
          const bar = $('#aiProgress'); if (bar) bar.hidden = false;
          try { await loadLocalModel(model); const o = $('#aiTestOut'); if (o) o.textContent = '✅ Built-in AI is ready'; refreshCacheFlags(); toast('Built-in AI is ready 🏕️', 'ok'); }
          catch (err) { const o = $('#aiTestOut'); if (o) o.textContent = `❌ ${err.message}`; }
        });
        return;
      }
      const out = $('#aiTestOut'); out.textContent = 'Testing…';
      testConnection().then(r => { out.textContent = `✅ Connected: "${r.trim().slice(0, 40)}"`; })
        .catch(err => { out.textContent = `❌ ${err.message}`; });
      return;
    }
    case 'cloud-save-id': {
      const id = $('#cloudClientId').value.trim();
      if (id && !/^[0-9a-f-]{36}$/i.test(id)) return toast('That doesn\'t look like a Client ID (it should be a GUID like 1234abcd-…).', 'warn', 6000);
      cloud.cloudSettings().clientId = id; saveSettings(); cloud.resetClient();
      toast(id ? 'Client ID saved. Now sign in with Microsoft.' : 'Client ID cleared', 'ok'); return render();
    }
    case 'cloud-signin': return cloud.signIn().then(a => { toast(`Signed in as ${a.username}`, 'ok'); render(); }).catch(err => toast(`Microsoft sign-in failed: ${err.message}`, 'bad', 8000));
    case 'wb-open-local': return wbOpen();
    case 'spec-save': case 'spec-test': {
      settings.ai.specMode = $('input[name=specMode]:checked')?.value || 'auto';
      settings.ai.keys ||= {};
      const gk = $('#specGeminiKey').value.trim();
      if (gk) settings.ai.keys.gemini = gk; else delete settings.ai.keys.gemini;
      settings.search = { provider: $('#searchProv').value, key: $('#searchKey').value.trim() };
      saveSettings();
      if (d.action === 'spec-save') return toast('Spec lookup settings saved', 'ok');
      const out = $('#specTestOut'); out.textContent = 'Searching…';
      searchWeb('Pelican 1450 case specifications weight').then(r => { out.textContent = r.length ? `✅ ${r.length} results, e.g. ${r[0].title.slice(0, 60)}` : '⚠️ No results (search busy or key invalid)'; });
      return;
    }
    case 'cloud-browse': return cloudBrowse();
    case 'cloud-link': return cloudOpenLink();
    case 'cloud-new': return cloudNew();
    case 'cloud-signout': return cloud.signOut().then(() => {
      if (state.workbook.cloud) { excel.disconnect(); Object.assign(state.workbook, { connected: false, cloud: false }); }
      pendingCloud = null; commit({ dirty: false }); toast('Signed out of Microsoft');
    }).catch(err => toast(err.message, 'bad'));
    case 'wb-open': return wbOpenChooser();
    case 'wb-new': return wbNew();
    case 'wb-save': return wbSave();
    case 'wb-disconnect': excel.disconnect(); pendingCloud = null; Object.assign(state.workbook, { connected: false, cloud: false }); return commit({ dirty: false });
    case 'load-sample': {
      const ids = new Set(state.items.map(i => i.id));
      const add = SAMPLE_ITEMS.filter(i => !ids.has(i.id));
      state.items.push(...structuredClone(add)); commit(); return toast(`Added ${add.length} sample items`, 'ok');
    }
    case 'recover-trip': state.plan = emptyPlan(); state.view = 'planner'; return commit({ dirty: false });
    case 'reset-all': return confirmDialog('Clear all data stored in this browser? Your Excel file is not touched.', 'Reset').then(ok => {
      if (ok) { localStorage.clear(); excel.disconnect(); location.reload(); }
    });
  }
}

function onInput(e) {
  const el = e.target;
  const key = el.dataset.req;
  if (!key) return;
  let v = el.value;
  if (['days', 'maxVolumeL', 'resupplyDays'].includes(key)) v = Math.max(0, num(v));
  if (key === 'days') v = Math.max(1, Math.min(999, Math.round(v) || 1));
  if (key === 'maxWeightKg') v = weightFromDisplay(v, U());
  if (key === 'maxVolumeL') v = volBigFromDisplay(v, U());
  state.plan.request[key] = v;
  commit({ dirty: false, render: false });
  $('#tripPreview').innerHTML = tripPreview();
  if (key === 'days' || key === 'startDate') { const e = endDate(state.plan.request); const el = $('#endDate'); if (el) el.innerHTML = e ? `Ends <b>${e}</b>` : ''; }
}

// ---------- Drag & drop ----------
let drag = null;
function onDragStart(e) {
  const el = e.target.closest('[data-drag]');
  if (!el) return;
  drag = { kind: el.dataset.drag, item: el.dataset.item, from: el.dataset.from };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.item);
  el.classList.add('dragging');
  document.body.classList.add('is-dragging');
}
function onDragOver(e) {
  const z = e.target.closest('[data-drop]');
  if (!z || !drag) return;
  e.preventDefault();
  $$('.drop-over').forEach(x => x !== z && x.classList.remove('drop-over'));
  z.classList.add('drop-over');
}
function onDrop(e) {
  const z = e.target.closest('[data-drop]');
  document.body.classList.remove('is-dragging');
  $$('.drop-over').forEach(x => x.classList.remove('drop-over'));
  if (!z || !drag) return;
  e.preventDefault();
  const to = z.dataset.drop;
  if (drag.kind === 'shelf') { if (to !== 'shelf') addToPlan(drag.item, to === 'loose' ? null : to); }
  else movePacked(drag.item, drag.from, to);
  drag = null;
  commit({ dirty: false });
}
function onDragEnd() { drag = null; document.body.classList.remove('is-dragging'); $$('.dragging,.drop-over').forEach(x => x.classList.remove('dragging', 'drop-over')); }

// =====================================================================
// Boot
// =====================================================================
async function boot() {
  window.__fieldpackStarted = true;
  const had = restore();
  subscribe(render);
  subscribe(autosave);
  document.addEventListener('click', onClick);
  $('#view').addEventListener('input', onInput);
  $('#view').addEventListener('dragstart', onDragStart);
  $('#view').addEventListener('dragover', onDragOver);
  $('#view').addEventListener('drop', onDrop);
  $('#view').addEventListener('dragend', onDragEnd);
  $('#btnOpen').onclick = () => wbOpenChooser();
  $('#btnNew').onclick = wbNew;
  $('#btnSave').onclick = () => wbSave();
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); wbSave(); } });
  window.addEventListener('beforeunload', e => { if (state.workbook.dirty && state.workbook.connected) { e.preventDefault(); e.returnValue = ''; } });

  if (typeof XLSX === 'undefined') toast('Excel library failed to load. Check your internet connection.', 'bad', 10000);
  const lastCloud = cloud.cloudSettings().last;
  if (lastCloud && cloud.cloudConfigured()) {
    pendingCloud = lastCloud;
    cloud.currentAccount().then(a => { if (a) cloudOpen(lastCloud); else render(); });
  }
  pendingHandle = lastCloud ? null : await excel.storedHandle();
  if (pendingHandle && (await pendingHandle.queryPermission?.({ mode: 'readwrite' })) === 'granted') {
    try { loadWorkbookData(await excel.reconnect(pendingHandle)); } catch { /* user can click to reconnect */ }
  }
  render();
  if (!had && !state.items.length) welcome();
}

boot();
