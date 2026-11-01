// Bring-your-own-AI connector. Calls the provider straight from the browser
// with the user's own key (stored only in this browser's localStorage).
import { state, settings, itemById, catInfo } from './store.js';
import { itemVolume, planStats, packingSummary } from './planner.js';
import { round } from './utils.js';

export const PROVIDERS = {
  anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-opus-5-5', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai:    { label: 'OpenAI', defaultModel: 'gpt-4o', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini:    { label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
  compatible:{ label: 'OpenAI-compatible (Ollama, LM Studio, OpenRouter, Groq…)', defaultModel: 'llama3.1', keyHint: 'optional', baseUrl: 'http://localhost:11434/v1' },
};

export const aiConfig = () => {
  const a = settings.ai, p = PROVIDERS[a.provider] || PROVIDERS.anthropic;
  return { provider: a.provider, model: a.model || p.defaultModel, apiKey: a.keys?.[a.provider] ?? a.apiKey ?? '', baseUrl: a.baseUrl || p.baseUrl || '' };
};
export const aiReady = () => { const c = aiConfig(); return !!(c.apiKey || c.provider === 'compatible'); };

// Claude models that accept output_config.effort + server-side refusal fallbacks.
const MODERN_CLAUDE = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

async function postJSON(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || text.slice(0, 300);
    throw new Error(`${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

/** Send a conversation; returns assistant text. messages: [{role:'user'|'assistant', content}] */
export async function chat(system, messages) {
  const c = aiConfig();
  if (c.provider === 'anthropic') {
    const modern = MODERN_CLAUDE.test(c.model);
    const headers = {
      'x-api-key': c.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = { model: c.model, max_tokens: 16000, system, messages };
    if (modern) {
      body.output_config = { effort: 'medium' };
      // If a safety classifier declines, let the API retry on a suitable model.
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    const d = await postJSON('https://api.anthropic.com/v1/messages', headers, body);
    if (d.stop_reason === 'refusal') throw new Error(`The model declined this request${d.stop_details?.explanation ? `: ${d.stop_details.explanation}` : '.'}`);
    const text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return d.stop_reason === 'max_tokens' ? text + '\n\n_(response was cut off at the token limit)_' : text;
  }
  if (c.provider === 'gemini') {
    const d = await postJSON(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`,
      { 'x-goog-api-key': c.apiKey },
      { systemInstruction: { parts: [{ text: system }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) });
    return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('') || '(empty response)';
  }
  const base = c.provider === 'openai' ? 'https://api.openai.com/v1' : c.baseUrl.replace(/\/+$/, '');
  const d = await postJSON(`${base}/chat/completions`, c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {},
    { model: c.model, messages: [{ role: 'system', content: system }, ...messages] });
  return d.choices?.[0]?.message?.content || '(empty response)';
}

export async function testConnection() {
  return chat('You are a connectivity check. Reply with exactly: READY', [{ role: 'user', content: 'ping' }]);
}

// ---------------- Prompt construction ----------------
export const SYSTEM_PROMPT = `You are FieldPack AI, an expert field-logistics planner for research fieldwork, surveys, hiking, camping and expeditions.
You plan from the user's actual inventory (listed by ID), respect weight and volume limits, distribute load sensibly across containers (heavy and dense items low and close to the back in packs, fragile electronics in hard cases, wet-weather items in dry bags), flag safety gaps, and explain trade-offs concisely.
Use kilograms and liters. Be practical and specific. If you mention seasonal weather or hazards for the destination, say they are typical conditions and should be checked against a current forecast.`;

const fmtList = a => (Array.isArray(a) ? a : []).join(', ') || '-';

export function buildTripBrief(plan = state.plan) {
  const r = plan.request, s = planStats(plan);
  const inv = state.items.map(i => [
    i.id, i.name, i.category, round(i.weightKg, 3), round(itemVolume(i), 2), i.qtyOwned || 0,
    i.perPerson ? 'Y' : '', i.consumable ? `${i.perPersonDay || 0}/person/day` : '',
    i.capacityL || '', i.maxLoadKg || '', fmtList(i.useCases), fmtList(i.environments), (i.notes || '').replace(/\|/g, '/'),
  ].join(' | ')).join('\n');

  const draft = plan.packed.length || plan.containers.length
    ? `${packingSummary(plan)}\nTotals: ${round(s.totalKg, 2)} kg total (${round(s.containerKg, 2)} kg containers), ${round(s.gearL, 1)} L of gear in ${round(s.capacityL, 1)} L of container capacity.`
    : '(no draft yet: build the plan from scratch)';

  return `## Trip request
- Trip: ${r.name || '(unnamed)'}
- Destination: ${r.destination || '(not given)'}
- Start date: ${r.startDate || '(not given)'}; duration: ${r.days} day(s); party size: ${r.people}
- Environments: ${fmtList(r.environments)}
- Activities: ${fmtList(r.activities)}
- Transport: ${r.transport}; max total weight ${r.maxWeightKg} kg; max total volume ${r.maxVolumeL} L
- Must-haves: ${r.mustHaves || '-'}
- Other requirements / notes: ${r.notes || '-'}

## Inventory (only these items exist, so reference them by ID)
ID | Name | Category | kg each | L each | Owned | Per person | Consumption | Capacity L | Max load kg | Use cases | Environments | Notes
${inv}

## Current draft packing plan
${draft}

## What I need
1. Check the draft (or build one) against the requirements, limits and party size.
2. Give an optimized packing plan that uses my containers, with item quantities, and say what goes in which container.
3. Run a weight and space check per container and overall, including kg per person.
4. List risks and gaps: missing items I should buy or borrow, hazards for this environment and season, and redundancy.
5. Give a consumables plan for food, water, fuel and batteries.

Respond in Markdown with these sections: **Summary**, **Packing Plan** (a table), **Weight & Space Check**, **Risks & Gaps**, **Consumables**, **Field Tips**.
Then end your reply with one fenced \`\`\`json block in exactly this shape, using only IDs from my inventory:
{"containers":[{"itemId":"CT-001"}],"items":[{"id":"SF-001","qty":1,"container":0}],"missing":[{"name":"...","reason":"...","estWeightKg":0.2}],"warnings":["..."]}
"container" is the index into the "containers" array, or null for items that are worn or carried loose. Do not use more units of an item than I own.`;
}

/** Extract and validate the trailing JSON plan from an AI reply. */
export function parseSuggestion(text) {
  const blocks = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1]);
  for (const raw of blocks.reverse()) {
    try {
      const j = JSON.parse(raw);
      if (!j || !Array.isArray(j.items)) continue;
      const containers = (j.containers || []).filter(c => itemById(c.itemId));
      const idxMap = new Map();
      (j.containers || []).forEach((c, i) => { const k = containers.indexOf(c); if (k >= 0) idxMap.set(i, k); });
      const items = j.items.filter(x => itemById(x.id) && x.qty > 0)
        .map(x => ({ id: x.id, qty: Math.round(x.qty), container: Number.isInteger(x.container) && idxMap.has(x.container) ? idxMap.get(x.container) : null }));
      return { containers, items, missing: j.missing || [], warnings: j.warnings || [] };
    } catch { /* try next */ }
  }
  return null;
}

/** Remove the machine-readable JSON block from text shown to the user. */
export const stripJson = text => String(text).replace(/```json[\s\S]*?```\s*$/i, '').trim();

export const iconFor = id => { const it = itemById(id); return it?.icon || catInfo(it?.category).icon; };
