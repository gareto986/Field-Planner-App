// FieldPack spec-lookup relay (Cloudflare Worker, free plan is enough).
//
// Lets every visitor of your FieldPack site verify gear specs with Gemini +
// Google Search, using ONE Gemini API key that stays secret on Cloudflare.
// The browser never sees the key. The relay only does spec checks (fixed
// prompt, small inputs), so it can't be used as a general-purpose AI proxy.
//
// Two features (use either or both):
//   POST /        spec check with Gemini + Google Search grounding (needs billing on
//                 the Google project: grounding isn't part of Gemini's free tier)
//   POST /search  web search for FieldPack's free lookup, using a Serper (Google
//                 results) or Tavily key, both of which have free tiers
//
// Settings (Cloudflare dashboard → your Worker → Settings → Variables and Secrets):
//   GEMINI_API_KEY   (Secret, optional) your Gemini API key from https://aistudio.google.com/apikey
//   SERPER_API_KEY   (Secret, optional) from https://serper.dev  (or TAVILY_API_KEY from https://app.tavily.com)
//   ALLOWED_ORIGINS  (Text)    comma-separated sites allowed to use it, e.g. https://gareto986.github.io
//   GEMINI_MODEL     (Text, optional) pin a model; by default the newest available Gemini Flash is used

const MAX_ITEMS = 8;
const clip = (v, n) => String(v ?? '').slice(0, n);
const num = v => (Number.isFinite(+v) ? +v : 0);

function prompt(units) {
  return `You check gear specifications for a field-research inventory. For each item, search the web for the manufacturer's published specs (prefer the manufacturer's page, then major retailers; avoid forums and guesses). Match the exact model and size; if a source is for a different variant, don't use it.
Report numbers per single unit in metric: weightKg (convert from lb/oz/g), external dimensions lengthCm, widthCm, heightCm (convert from inches), and capacityL for bags/containers (convert from cubic inches or gallons). Use 0 for anything you could not find.
Put the page you used in "source". Generic items (e.g. "artifact bags", "duct tape") may have no single spec; then set verified=false and say so briefly.
Write each "note" in ${units === 'metric' ? 'kg and cm' : 'pounds/ounces and inches'}.
Reply with ONLY JSON: {"items":[{"index":0,"verified":true,"weightKg":0,"lengthCm":0,"widthCm":0,"heightCm":0,"capacityL":0,"source":"https://...","note":"..."}]}`;
}

// Google retires older Gemini models over time, so pick the newest available
// "gemini-X.Y-flash" automatically (cached for the life of the Worker instance).
let cachedModel = null;
async function newestFlash(key) {
  if (cachedModel) return cachedModel;
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
  const d = await res.json().catch(() => ({}));
  const best = (d.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({ id: m.name.replace(/^models\//, ''), v: (m.name.match(/^models\/gemini-(\d+(?:\.\d+)?)-flash$/) || [])[1] }))
    .filter(m => m.v)
    .sort((a, b) => parseFloat(b.v) - parseFloat(a.v))[0];
  cachedModel = best ? best.id : 'gemini-flash-latest';
  return cachedModel;
}

async function callGemini(model, key, payload) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(payload),
  });
  return { res, d: await res.json().catch(() => ({})) };
}

/** Web search via the relay's own Serper or Tavily key (keys stay on Cloudflare). */
async function search(env, query, count) {
  if (!query) return [400, { error: 'No query' }];
  if (env.SERPER_API_KEY) {
    const res = await fetch('https://google.serper.dev/search', { method: 'POST', headers: { 'content-type': 'application/json', 'X-API-KEY': env.SERPER_API_KEY }, body: JSON.stringify({ q: query, num: count }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return [502, { error: d.message || `Serper error ${res.status}` }];
    return [200, { provider: 'serper', results: (d.organic || []).slice(0, count).map(r => ({ url: r.link, title: r.title || r.link, snippet: r.snippet || '' })) }];
  }
  if (env.TAVILY_API_KEY) {
    const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${env.TAVILY_API_KEY}` }, body: JSON.stringify({ query, max_results: count, include_raw_content: true }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return [502, { error: d.detail?.error || d.message || `Tavily error ${res.status}` }];
    return [200, { provider: 'tavily', results: (d.results || []).slice(0, count).map(r => ({ url: r.url, title: r.title || r.url, snippet: r.content || '', content: String(r.raw_content || '').slice(0, 60000) })) }];
  }
  return [501, { error: 'Search is not set up on this relay.', code: 'no_search' }];
}

function cors(origin, allowed) {
  const ok = allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const headers = { ...cors(origin, allowed), 'content-type': 'application/json' };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!allowed.includes(origin)) return reply(403, { error: 'This site is not allowed to use this relay (check ALLOWED_ORIGINS).' });
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (request.method === 'GET' && path === '/status') {
      return reply(200, { verify: !!env.GEMINI_API_KEY, search: !!(env.SERPER_API_KEY || env.TAVILY_API_KEY) });
    }
    if (request.method !== 'POST') return reply(405, { error: 'POST only' });

    let body;
    try { body = await request.json(); } catch { return reply(400, { error: 'Invalid JSON' }); }

    if (path === '/search') return reply(...await search(env, clip(body.query, 200), Math.min(5, Math.max(1, num(body.count) || 5))));

    if (!env.GEMINI_API_KEY) return reply(501, { error: 'Google Search spec checks are not set up on this relay.', code: 'no_verify' });
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS).map((it, i) => ({
      index: i, name: clip(it.name, 120), brand: clip(it.brand, 60), model: clip(it.model, 60), category: clip(it.category, 30),
      weightKg: num(it.weightKg), lengthCm: num(it.lengthCm), widthCm: num(it.widthCm), heightCm: num(it.heightCm), capacityL: num(it.capacityL),
    })).filter(it => it.name);
    if (!items.length) return reply(400, { error: 'No items' });

    const listing = items.map(it => `${it.index}. ${it.name}${it.brand || it.model ? ` [brand: ${it.brand || '?'}, model: ${it.model || '?'}]` : ''} (${it.category}; current estimate ${it.weightKg} kg, ${it.lengthCm}x${it.widthCm}x${it.heightCm} cm${it.capacityL ? `, ${it.capacityL} L` : ''})`).join('\n');
    const payload = {
      systemInstruction: { parts: [{ text: prompt(body.units) }] },
      tools: [{ google_search: {} }],
      contents: [{ role: 'user', parts: [{ text: `Verify the specs for these items:\n${listing}` }] }],
    };
    let model = env.GEMINI_MODEL || await newestFlash(env.GEMINI_API_KEY);
    let { res, d } = await callGemini(model, env.GEMINI_API_KEY, payload);
    if (!res.ok && [400, 404].includes(res.status) && /no longer available|not found|not supported/i.test(d.error?.message || '')) {
      cachedModel = null; // model retired: look up the newest one and retry once
      model = await newestFlash(env.GEMINI_API_KEY);
      ({ res, d } = await callGemini(model, env.GEMINI_API_KEY, payload));
    }
    if (!res.ok) {
      const msg = d.error?.message || `Gemini error ${res.status}`;
      const quota = res.status === 429 || /quota|billing/i.test(msg);
      return reply(quota ? 429 : 502, quota
        ? { error: 'Google Search spec checks need billing enabled on the Gemini API project (grounding is not in the free tier), or the quota is used up.', code: 'quota', detail: msg }
        : { error: msg });
    }
    const cand = d.candidates?.[0] || {};
    const text = (cand.content?.parts || []).map(p => p.text || '').join('');
    const sources = (cand.groundingMetadata?.groundingChunks || []).map(g => g.web).filter(Boolean).map(w => ({ url: w.uri, title: w.title || w.uri }));
    return reply(200, { text, sources, model });
  },
};
