// "Add gear with AI": describe items in plain words; the AI drafts inventory
// records and asks short follow-up questions when details that matter for
// planning (quantity, weight, size, capacity) are missing or ambiguous.
import { state, settings, CATEGORIES, ACTIVITIES, ENVIRONMENTS, catInfo } from './store.js?v=202611012314';
import { chat, chatWithWebSearch, nativeVerifier, PROVIDERS, aiReady, aiConfig, isLocal } from './ai.js?v=202611012314';
import { $, esc, num, round, openModal, toast, splitList, weightToDisplay, weightFromDisplay, weightUnit, fmtDims, fmtVolSmall, lenToDisplay, lenUnit } from './utils.js?v=202611012314';
import { gatherEvidence, searchProvider, SEARCH_PROVIDERS } from './websearch.js?v=202611012314';
import { CONFIG } from './config.js?v=202611012314';
import { saveSettings } from './store.js?v=202611012314';
import { loadedModel } from './local-ai.js?v=202611012314';

const SYSTEM = () => `You are FieldPack's inventory assistant for an archaeology and field-research team. Turn the user's plain-language description of gear into inventory records for a trip-planning database.

Rules:
- Categories (use exactly one): ${Object.keys(CATEGORIES).join(', ')}.
- In the JSON, always use metric numbers: weightKg per single unit, dimensions in cm, volumes/capacities in liters (the app converts them).${settings.units === 'imperial' ? '\n- The user works in US/imperial units: read sizes they give in lb/oz/inches correctly, and write your "message" and "questions" in pounds, ounces and inches.' : ''}
- For common items, estimate typical weight and size and say "est." in notes. Do not ask about things you can reasonably estimate.
- Ask a short follow-up question only when an answer would materially change planning: quantity owned when unclear, which size/model when weight varies a lot, capacity/max load for bags and containers, whether a supply is consumed per person per day. Ask at most 3 questions at a time.
- useCases: pick from these tags when relevant (you may add others): ${[...ACTIVITIES, ...(settings.customActivities || []), 'rain', 'cold', 'hot', 'sun', 'emergency', 'navigation', 'electronics', 'repair', 'worn'].join(', ')}.
- environments: any of ${['all', ...ENVIRONMENTS].join(', ')}.
- perPerson=true when each crew member needs one; consumable=true with perPersonDay for supplies used up daily.
- Containers (bags, totes, cases, buckets used as containers): category "Container" with capacityL and maxLoadKg.
- icon: one fitting emoji.
- brand, model, domain: the manufacturer (e.g. "Pelican"), the exact model/part number (e.g. "1450", "45 4-1/2"), and the manufacturer's website domain (e.g. "pelican.com"). Fill these whenever the user names a brand or you can tell it; they are used to look up official specs.
- specUrl: the manufacturer's product page for that exact model if you are confident of the URL (else "").
- If something already exists in the inventory list below, say so in "message" instead of duplicating it (unless the user clearly has more units, then explain).

Existing inventory (names): ${state.items.map(i => i.name).join('; ') || '(empty)'}

Reply with ONLY a JSON object, no other text:
{"message":"one or two friendly sentences","questions":["..."],"items":[{"name":"","category":"","icon":"","weightKg":0,"lengthCm":0,"widthCm":0,"heightCm":0,"volumeL":0,"qtyOwned":1,"useCases":[],"environments":["all"],"perPerson":false,"consumable":false,"perPersonDay":0,"capacityL":0,"maxLoadKg":0,"notes":"","brand":"","model":"","domain":"","specUrl":""}]}
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
    specUrl: /^https?:\/\//.test(it.specUrl || '') ? String(it.specUrl) : '',
    brand: String(it.brand || '').trim().slice(0, 60), model: String(it.model || '').trim().slice(0, 60), domain: String(it.domain || '').trim().slice(0, 80),
  };
}

let relayVerifyOffUntil = 0;

const VERIFY_SYSTEM = native => `You check gear specifications for a field-research inventory. For each item, find the manufacturer's published specs (prefer the manufacturer's page, then major retailers; avoid forums and guesses). Match the exact model and size; if a source is for a different variant, don't use it.
Report numbers per single unit in metric: weightKg (convert from lb/oz/g), external dimensions lengthCm, widthCm, heightCm (convert from inches), and capacityL for bags/containers (convert from cubic inches or gallons). Use 0 for anything you could not find.
${native ? 'Search the web as needed, and put the page you used in "source".' : 'Use ONLY the web evidence excerpts provided below, and put the URL of the excerpt you used in "source". Never invent numbers or URLs. If the evidence does not contain specs for an item, set "verified": false.'}
Generic items (e.g. "artifact bags", "duct tape") may have no single spec; then set verified=false and say so briefly.
Write each "note" in ${settings.units === 'imperial' ? 'pounds/ounces and inches' : 'kg and cm'}, e.g. "Manufacturer spec: 2 lb 6 oz, 16 x 13 x 7 in".
Reply with ONLY JSON: {"items":[{"index":0,"verified":true,"weightKg":0,"lengthCm":0,"widthCm":0,"heightCm":0,"capacityL":0,"source":"https://...","note":"..."}]}`;


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
  let verifying = '';
  const autoVerify = () => settings.ai.verifySpecs !== false;

  const close = openModal(`
    <h2>🤖 Add gear with AI</h2>
    <p class="muted small">Describe what you want to add in plain words. The AI fills in the details, asks if something important is unclear, then checks weights and sizes against manufacturer specs on the web.</p>
    <div id="intakeBody"></div>`, { wide: true, onMount: m => { m.addEventListener('click', onClick); m.addEventListener('submit', onSubmit); m.addEventListener('change', onChange); } });

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
      <div class="row wrap verify-bar">
        <button type="button" class="btn small" data-verify ${busy || verifying ? 'disabled' : ''}>🔎 ${draft.some(d => d.check) ? 'Re-check' : 'Check'} specs on the web</button>
        <label class="check small"><input type="checkbox" data-autoverify ${autoVerify() ? 'checked' : ''}> Check automatically after drafting</label>
        <span class="muted small">${verifying ? `<span class="spin">🔎</span> ${esc(verifying)}` : !nativeVerifier() && CONFIG.specProxyUrl && settings.ai.specMode !== 'free' ? 'Uses Google Search (provided by this site).' : nativeVerifier() ? `Uses ${nativeVerifier().provider === 'gemini' ? 'Gemini with Google Search' : 'Claude web search'}.` : searchProvider() ? `Free lookup with ${SEARCH_PROVIDERS[searchProvider()].label} search.` : 'Free lookup (add a free search key or Gemini key in Settings for better matches).'}</span>
      </div>
      <div class="table-wrap"><table class="draft-table"><thead><tr><th></th><th>Name</th><th>Category</th><th>Weight (${weightUnit(units)})</th><th>Qty</th><th>Size</th><th>Specs</th><th>Tags / notes</th><th></th></tr></thead><tbody>
        ${draft.map((d, i) => `<tr data-row="${i}">
          <td class="d-icon">${esc(d.icon)}</td>
          <td><input data-f="name" value="${esc(d.name)}">
            <div class="bm"><input data-f="brand" value="${esc(d.brand || '')}" placeholder="brand" title="Manufacturer (used to look up specs)"><input data-f="model" value="${esc(d.model || '')}" placeholder="model / part #" title="Exact model or part number (used to look up specs)"></div></td>
          <td><select data-f="category">${Object.keys(CATEGORIES).map(c => `<option ${c === d.category ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
          <td><input data-f="weight" type="number" step="any" min="0" value="${weightToDisplay(d.weightKg, units)}"></td>
          <td><input data-f="qtyOwned" type="number" min="0" value="${d.qtyOwned}"></td>
          <td class="small">${[d.lengthCm, d.widthCm, d.heightCm].every(Boolean) ? fmtDims(d.lengthCm, d.widthCm, d.heightCm, units) : d.lengthCm ? `length ${lenToDisplay(d.lengthCm, units)} ${lenUnit(units)}` : '–'}${d.capacityL ? `<br>holds ${fmtVolSmall(d.capacityL, units)}` : ''}</td>
          <td class="small spec-cell">${specBadge(d)}</td>
          <td class="small">${d.useCases.slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${d.perPerson ? '<span class="tag alt">per person</span>' : ''}${d.consumable ? `<span class="tag alt">${d.perPersonDay}/person/day</span>` : ''}<br><span class="muted">${esc(d.notes)}</span></td>
          <td><button type="button" class="icon-btn" data-delrow="${i}" title="Remove">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row end"><button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="button" class="btn primary" data-add ${busy || verifying ? "disabled" : ""}>＋ Add ${draft.length} item${draft.length > 1 ? 's' : ''} to inventory</button></div>` : ''}`;
    const chatEl = body.querySelector('.intake-chat'); if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    body.querySelector('textarea')?.focus();
  }

  function specBadge(d) {
    if (!d.check) return '<span class="muted">not checked</span>';
    if (d.check.verified) {
      let host = d.check.source; try { host = new URL(d.check.source).hostname.replace(/^www\./, ''); } catch { /* keep */ }
      return `<span class="badge ok">✅ verified${d.check.partial ? ` (${d.check.partial})` : ''}</span><br>${d.check.changed ? `<span class="muted">${esc(d.check.changed)}</span><br>` : ''}${d.check.source ? `<a href="${esc(d.check.source)}" target="_blank" rel="noopener">${esc(host)} ↗</a>` : ''}`;
    }
    return `<span class="badge est">≈ estimate</span><br><span class="muted">${esc(d.check.note || 'No published specs found')}</span>${d.check.tried?.length ? `<details class="tried"><summary>what was checked</summary>${d.check.tried.map(t => `<div>${esc(t)}</div>`).join('')}</details>` : ''}`;
  }

  async function verify() {
    syncEdits();
    const local = isLocal();
    const targets = draft.map((d, i) => ({ d, i })).filter(({ d }) => d.name).slice(0, local ? 3 : 8);
    if (!targets.length) return;
    const listing = targets.map(({ d, i }) => `${i}. ${d.name}${d.brand || d.model ? ` [brand: ${d.brand || '?'}, model: ${d.model || '?'}]` : ''} (${d.category}; current estimate ${round(d.weightKg, 3)} kg, ${round(d.lengthCm, 1)}x${round(d.widthCm, 1)}x${round(d.heightCm, 1)} cm${d.capacityL ? `, ${round(d.capacityL, 1)} L` : ''})${d.specUrl ? ` [suggested page: ${d.specUrl}]` : ''}`).join('\n');
    try {
      let text, allowed = null;
      const nv = nativeVerifier();
      const relay = !nv && settings.ai.specMode !== 'free' && Date.now() > relayVerifyOffUntil && (CONFIG.specProxyUrl || '').trim();
      let native = false;
      if (relay) {
        verifying = 'Searching Google for manufacturer specs…'; view();
        try {
          const res = await fetch(relay, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ units, items: targets.map(({ d }) => ({ name: d.name, brand: d.brand, model: d.model, category: d.category, weightKg: d.weightKg, lengthCm: d.lengthCm, widthCm: d.widthCm, heightCm: d.heightCm, capacityL: d.capacityL })) }) });
          const out = await res.json().catch(() => ({}));
          if (!res.ok) {
            // Not set up, or Google quota/billing: stop asking for a while and use the free lookup quietly.
            if (out.code === 'no_verify' || out.code === 'quota' || res.status === 501 || res.status === 429) relayVerifyOffUntil = Date.now() + 30 * 60 * 1000;
            throw Object.assign(new Error(out.error || `relay HTTP ${res.status}`), { quiet: out.code === 'no_verify' });
          }
          // The relay numbers items 0..n in the order sent; map back to draft rows.
          const j0 = extractJson(out.text);
          if (j0?.items) j0.items.forEach(r => { r.index = targets[+r.index]?.i ?? -1; });
          text = JSON.stringify(j0 || {});
          native = true;
        } catch (e) { console.warn('spec relay failed, using free lookup', e); if (!e.quiet) toast('Google spec search is unavailable right now; using the free lookup instead.', 'warn', 5000); }
      }
      if (nv) {
        verifying = `Searching the web with ${nv.provider === 'gemini' ? 'Gemini (Google Search)' : 'Claude web search'}…`; view();
        try {
          ({ text } = await chatWithWebSearch(VERIFY_SYSTEM(true), [{ role: 'user', content: `Verify the specs for these items:\n${listing}` }], nv));
          native = true;
        } catch (e) { console.warn('native web search failed, using free lookup', e); toast(`${nv.provider === 'gemini' ? 'Gemini' : 'Claude'} web search failed (${e.message}); trying the free lookup.`, 'warn', 6000); }
      }
      if (!native) {
        verifying = 'Reading product pages on the web…'; view();
        const ev = await gatherEvidence(targets.map(({ d }) => d), local ? { pagesPerItem: 1, charsPerPage: 1200 } : {});
        allowed = new Set(ev.flatMap(e => e.sources.map(s => s.url)));
        ev.forEach((e, k) => { targets[k].d.tried = e.tried; });
        const evidence = ev.map((e, k) => `### Item ${targets[k].i}: ${targets[k].d.name}\n${e.sources.length ? e.sources.map(s => `Source: ${s.url}\n${s.excerpt}`).join('\n\n') : '(no pages found)'}`).join('\n\n');
        if (!allowed.size) {
          targets.forEach(({ d }) => { d.check = { verified: false, note: 'No product pages with specs could be read; kept the estimate.', tried: d.tried }; });
          verifying = ''; view(); toast('Could not find spec pages for these items; kept the AI estimates.', 'warn', 6000);
          return;
        }
        verifying = 'Comparing the specs…'; view();
        text = await chat(VERIFY_SYSTEM(false), [{ role: 'user', content: `Items:\n${listing}\n\nWeb evidence:\n${evidence}` }]);
      }
      const j = extractJson(text);
      if (!j || !Array.isArray(j.items)) throw new Error('The AI did not return spec results.');
      let ok = 0;
      for (const r of j.items) {
        const d = draft[+r.index];
        if (!d) continue;
        const sourceOk = r.source && (!allowed || allowed.has(r.source));
        const hasWeight = num(r.weightKg) > 0, hasDims = ['lengthCm', 'widthCm', 'heightCm'].some(k => num(r[k]) > 0);
        if (r.verified && sourceOk && (hasWeight || hasDims)) {
          const prev = { w: d.weightKg };
          const changes = [];
          if (num(r.weightKg) > 0) d.weightKg = num(r.weightKg);
          ['lengthCm', 'widthCm', 'heightCm'].forEach(k => { if (num(r[k]) > 0) d[k] = num(r[k]); });
          if (d.category === 'Container' && num(r.capacityL) > 0) d.capacityL = num(r.capacityL);
          if (Math.abs(prev.w - d.weightKg) / Math.max(prev.w, 0.001) > 0.05) changes.push(`was ${weightToDisplay(prev.w, units)} ${weightUnit(units)}`);
          d.check = { verified: true, partial: !(hasWeight && hasDims) ? (hasWeight ? 'weight only' : 'size only') : '', source: r.source, note: r.note || '', changed: changes.join(', ') };
          ok++;
        } else {
          d.check = { verified: false, tried: d.tried, note: r.verified && !sourceOk ? 'Source could not be confirmed; kept the estimate.' : (r.note || 'No published specs found; kept the estimate.') };
        }
      }
      toast(`Checked ${targets.length} item${targets.length > 1 ? 's' : ''}: ${ok} verified from the web, ${targets.length - ok} kept as estimates.`, ok ? 'ok' : 'warn', 6000);
    } catch (e) {
      toast(`Spec check failed: ${e.message}`, 'bad', 8000);
    } finally { verifying = ''; view(); }
  }

  function syncEdits() {
    document.querySelectorAll('.draft-table tr[data-row]').forEach(tr => {
      const d = draft[+tr.dataset.row];
      if (!d) return;
      d.name = tr.querySelector('[data-f=name]').value.trim();
      d.category = tr.querySelector('[data-f=category]').value;
      const b = tr.querySelector('[data-f=brand]').value.trim(), mo = tr.querySelector('[data-f=model]').value.trim();
      if (b !== (d.brand || '') || mo !== (d.model || '')) { d.brand = b; d.model = mo; d.specUrl = ''; if (b !== (d.brand || '')) d.domain = ''; }
      const w = tr.querySelector('[data-f=weight]').value;
      // only convert if the user changed it (avoids drift from rounded display values)
      if (num(w) !== num(weightToDisplay(d.weightKg, units))) d.weightKg = weightFromDisplay(w, units);
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
      busy = false; view(); return;
    }
    busy = false; view();
    if (!questions.length && draft.length && autoVerify()) await verify();
  }

  function onChange(e) {
    if (e.target.matches('[data-autoverify]')) { settings.ai.verifySpecs = e.target.checked; saveSettings(); }
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
    if (t.hasAttribute('data-verify') && !busy && !verifying) verify();
    if (t.hasAttribute('data-skip')) send('Use your best estimates for anything I did not answer, and finalize the items.');
    if (t.dataset.delrow !== undefined) { syncEdits(); draft.splice(+t.dataset.delrow, 1); view(); }
    if (t.hasAttribute('data-add')) {
      syncEdits();
      const items = draft.filter(d => d.name).map(({ check, specUrl, tried, domain, ...d }) => ({
        ...d, notes: [d.notes, check?.verified ? `Specs verified: ${check.source}` : ''].filter(Boolean).join(' · '),
      }));
      if (!items.length) return;
      onAdd(items);
      close();
    }
  }

  view();
}
