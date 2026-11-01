// "Add gear with AI": describe items in plain words; the AI drafts inventory
// records and asks short follow-up questions when details that matter for
// planning (quantity, weight, size, capacity) are missing or ambiguous.
import { state, settings, CATEGORIES, ACTIVITIES, ENVIRONMENTS, catInfo } from './store.js?v=20261101b';
import { chat, aiReady, aiConfig, isLocal } from './ai.js?v=20261101b';
import { $, esc, num, round, openModal, toast, splitList, weightToDisplay, weightFromDisplay, weightUnit } from './utils.js?v=20261101b';
import { loadedModel } from './local-ai.js?v=20261101b';

const SYSTEM = () => `You are FieldPack's inventory assistant for an archaeology and field-research team. Turn the user's plain-language description of gear into inventory records for a trip-planning database.

Rules:
- Categories (use exactly one): ${Object.keys(CATEGORIES).join(', ')}.
- Use metric units: weightKg per single unit, dimensions in cm, volumes/capacities in liters.
- For common items, estimate typical weight and size and say "est." in notes. Do not ask about things you can reasonably estimate.
- Ask a short follow-up question only when an answer would materially change planning: quantity owned when unclear, which size/model when weight varies a lot, capacity/max load for bags and containers, whether a supply is consumed per person per day. Ask at most 3 questions at a time.
- useCases: pick from these tags when relevant (you may add others): ${[...ACTIVITIES, ...(settings.customActivities || []), 'rain', 'cold', 'hot', 'sun', 'emergency', 'navigation', 'electronics', 'repair', 'worn'].join(', ')}.
- environments: any of ${['all', ...ENVIRONMENTS].join(', ')}.
- perPerson=true when each crew member needs one; consumable=true with perPersonDay for supplies used up daily.
- Containers (bags, totes, cases, buckets used as containers): category "Container" with capacityL and maxLoadKg.
- icon: one fitting emoji.
- If something already exists in the inventory list below, say so in "message" instead of duplicating it (unless the user clearly has more units, then explain).

Existing inventory (names): ${state.items.map(i => i.name).join('; ') || '(empty)'}

Reply with ONLY a JSON object, no other text:
{"message":"one or two friendly sentences","questions":["..."],"items":[{"name":"","category":"","icon":"","weightKg":0,"lengthCm":0,"widthCm":0,"heightCm":0,"volumeL":0,"qtyOwned":1,"useCases":[],"environments":["all"],"perPerson":false,"consumable":false,"perPersonDay":0,"capacityL":0,"maxLoadKg":0,"notes":""}]}
Always include your best current draft in "items", even while asking questions. When nothing important is missing, return "questions": [].`;

function extractJson(text) {
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/g, '');
  const fenced = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  const candidates = [...fenced.reverse(), t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)];
  for (const c of candidates) { try { const j = JSON.parse(c); if (j && typeof j === 'object') return j; } catch { /* next */ } }
  return null;
}

function clean(it) {
  const category = CATEGORIES[it.category] ? it.category : 'Other';
  return {
    name: String(it.name || '').trim().slice(0, 80), category, icon: String(it.icon || '').trim().slice(0, 4) || catInfo(category).icon,
    weightKg: Math.max(0, num(it.weightKg)), lengthCm: num(it.lengthCm), widthCm: num(it.widthCm), heightCm: num(it.heightCm), volumeL: num(it.volumeL),
    qtyOwned: Math.max(0, Math.round(num(it.qtyOwned, 1))), useCases: splitList(it.useCases), environments: splitList(it.environments).length ? splitList(it.environments) : ['all'],
    perPerson: !!it.perPerson, consumable: !!it.consumable, perPersonDay: num(it.perPersonDay),
    capacityL: category === 'Container' ? num(it.capacityL) : 0, maxLoadKg: category === 'Container' ? num(it.maxLoadKg) : 0,
    notes: String(it.notes || '').trim(),
  };
}

/**
 * Open the AI intake window.
 * @param {{ initial?: string, onAdd: (items: object[]) => void, goSettings: () => void }} opts
 */
export function openIntake({ initial = '', onAdd, goSettings, confirmLocal }) {
  const units = settings.units;
  let messages = [];
  let draft = [];
  let questions = [];
  let busy = false;

  const close = openModal(`
    <h2>🤖 Add gear with AI</h2>
    <p class="muted small">Describe what you want to add in plain words. The AI fills in the details, estimates weights and sizes, and asks if something important is unclear.</p>
    <div id="intakeBody"></div>`, { wide: true, onMount: m => { m.addEventListener('click', onClick); m.addEventListener('submit', onSubmit); } });

  function view() {
    const body = $('#intakeBody');
    if (!body) return;
    if (!aiReady()) {
      body.innerHTML = `<div class="empty"><p>${isLocal() ? 'The built-in AI needs Chrome or Edge with WebGPU.' : 'Connect an AI in Settings first.'}</p><button class="btn accent" data-go-settings>AI settings</button></div>`;
      return;
    }
    const lastAi = [...messages].reverse().find(x => x.role === 'assistant');
    body.innerHTML = `
      ${messages.length ? `<div class="intake-chat">${messages.map(x => x.role === 'user'
        ? `<div class="msg user">${esc(x.shown || x.content)}</div>`
        : `<div class="msg assistant">${esc(x.display || '')}</div>`).join('')}
        ${busy ? `<div class="msg assistant thinking"><span></span><span></span><span></span> ${isLocal() ? 'the built-in AI is working (the first run can take a minute or two)…' : 'working it out…'}</div>
          ${isLocal() && loadedModel() !== aiConfig().model ? '<div class="ai-progress" id="aiProgress"><div class="minibar"><i style="width:0%;background:var(--teal)"></i></div><span class="small muted">Starting the built-in AI…</span></div>' : ''}` : ''}</div>` : ''}
      ${questions.length && !busy ? `<div class="questions"><b>A few quick questions</b><ol>${questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol></div>` : ''}
      ${isLocal() && loadedModel() !== aiConfig().model && !messages.length ? '<p class="small muted">🏕️ Using the free built-in AI. If it hasn\'t been used on this computer yet, the first request downloads the model once (≈1–2 GB) and shows progress here.</p>' : ''}
      <form id="intakeForm" class="intake-form">
        <textarea name="q" rows="${messages.length ? 2 : 4}" placeholder="${messages.length ? 'Answer the questions, add more items, or say “use your best estimates”…' : 'e.g. two 1/8 inch shaker screens, a Pelican-style case for the total station, 500 artifact bags, and 6 waterproof clipboards'}" ${busy ? 'disabled' : ''}>${messages.length ? '' : esc(initial)}</textarea>
        <div class="row wrap"><button class="btn accent" ${busy ? 'disabled' : ''}>${messages.length ? 'Send' : '✨ Draft items'}</button>
          ${questions.length && !busy ? '<button type="button" class="btn ghost" data-skip>Skip questions, use estimates</button>' : ''}
          <span class="muted small">${esc(aiConfig().provider === 'local' ? 'Using the free built-in AI' : aiConfig().provider === 'ovh' ? `Using free ${aiConfig().model} (OVHcloud)` : `Using ${aiConfig().model}`)}</span></div>
      </form>
      ${draft.length ? `<h3 class="draft-h">Draft items <small class="muted">(edit anything, then add)</small></h3>
      <div class="table-wrap"><table class="draft-table"><thead><tr><th></th><th>Name</th><th>Category</th><th>Weight (${weightUnit(units)})</th><th>Qty</th><th>Size (cm)</th><th>Tags / notes</th><th></th></tr></thead><tbody>
        ${draft.map((d, i) => `<tr data-row="${i}">
          <td class="d-icon">${esc(d.icon)}</td>
          <td><input data-f="name" value="${esc(d.name)}"></td>
          <td><select data-f="category">${Object.keys(CATEGORIES).map(c => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
          <td><input data-f="weight" type="number" step="any" min="0" value="${weightToDisplay(d.weightKg, units)}"></td>
          <td><input data-f="qtyOwned" type="number" min="0" value="${d.qtyOwned}"></td>
          <td class="small">${[d.lengthCm, d.widthCm, d.heightCm].some(Boolean) ? `${round(d.lengthCm, 0)}×${round(d.widthCm, 0)}×${round(d.heightCm, 0)}` : '–'}${d.capacityL ? `<br>holds ${round(d.capacityL, 0)} L` : ''}</td>
          <td class="small">${d.useCases.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${d.perPerson ? '<span class="tag alt">per person</span>' : ''}${d.consumable ? `<span class="tag alt">${d.perPersonDay}/person/day</span>` : ''}<br><span class="muted">${esc(d.notes)}</span></td>
          <td><button type="button" class="icon-btn" data-delrow="${i}" title="Remove">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="button" class="btn primary" data-add ${busy ? 'disabled' : ''}>＋ Add ${draft.length} item${draft.length > 1 ? 's' : ''} to inventory</button></div>` : ''}`;
    const chatEl = body.querySelector('.intake-chat'); if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    body.querySelector('textarea')?.focus();
  }

  function syncEdits() {
    document.querySelectorAll('.draft-table tr[data-row]').forEach(tr => {
      const d = draft[+tr.dataset.row];
      if (!d) return;
      d.name = tr.querySelector('[data-f=name]').value.trim();
      d.category = tr.querySelector('[data-f=category]').value;
      d.weightKg = weightFromDisplay(tr.querySelector('[data-f=weight]').value, units);
      d.qtyOwned = Math.max(0, Math.round(num(tr.querySelector('[data-f=qtyOwned]').value, 1)));
    });
  }

  async function send(text) {
    syncEdits();
    // First use of the built-in AI: ask before the one-time model download.
    if (isLocal() && confirmLocal && !(await confirmLocal())) return;
    const content = draft.length && messages.length
      ? `${text}\n\n(Current draft, keep my edits: ${JSON.stringify(draft.map(({ name, category, weightKg, qtyOwned }) => ({ name, category, weightKg: round(weightKg, 3), qtyOwned })))})`
      : text;
    messages.push({ role: 'user', content, shown: text });
    busy = true; view();
    try {
      const history = messages.map(x => ({ role: x.role, content: x.content }));
      const reply = await chat(SYSTEM(), history);
      const j = extractJson(reply);
      if (!j) throw new Error('The AI did not return item data. Try rephrasing, or use the detailed item form.');
      if (Array.isArray(j.items) && j.items.length) draft = j.items.map(clean).filter(d => d.name);
      questions = Array.isArray(j.questions) ? j.questions.filter(Boolean).slice(0, 3) : [];
      messages.push({ role: 'assistant', content: reply, display: j.message || (questions.length ? 'Almost there. A couple of details first:' : 'Here is the draft. Review and add.') });
    } catch (e) {
      messages.pop();
      toast(`AI error: ${e.message}`, 'bad', 8000);
    } finally { busy = false; view(); }
  }

  function onSubmit(e) {
    if (e.target.id !== 'intakeForm') return;
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q && !busy) send(q);
  }

  function onClick(e) {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.hasAttribute('data-go-settings')) { close(); goSettings(); }
    if (t.hasAttribute('data-skip')) send('Use your best estimates for anything I did not answer, and finalize the items.');
    if (t.dataset.delrow !== undefined) { syncEdits(); draft.splice(+t.dataset.delrow, 1); view(); }
    if (t.hasAttribute('data-add')) {
      syncEdits();
      const items = draft.filter(d => d.name);
      if (!items.length) return;
      onAdd(items);
      close();
    }
  }

  view();
}
