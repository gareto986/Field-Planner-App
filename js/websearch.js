// Web lookup used to verify gear specs when the AI doing the check has no
// built-in web search. Layers, best first:
//  1. A free search API key, if the user added one (Tavily, Serper = Google results, or Jina Search)
//  2. Marginalia Search public API (keyless, but often busy)
//  3. The manufacturer's own site search (domain suggested by the AI)
// Pages are read as text via Jina Reader (keyless). When a page has no specs but
// links to the product (search results, category pages), the best-matching links
// are followed one hop.
import { settings } from './store.js?v=202611012301';

const TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

export const SEARCH_PROVIDERS = {
  tavily: { label: 'Tavily', keyUrl: 'https://app.tavily.com/', hint: 'tvly-…' },
  serper: { label: 'Serper (Google results)', keyUrl: 'https://serper.dev/', hint: 'your Serper API key' },
  jina:   { label: 'Jina Search', keyUrl: 'https://jina.ai/api-dashboard/', hint: 'jina_…' },
};
export const searchKey = () => (settings.search?.key || '').trim();
export const searchProvider = () => (searchKey() ? settings.search?.provider || 'tavily' : '');

/** Search the web. Returns [{url, title, snippet, content?}] or [] if nothing is available. */
export async function searchWeb(query, count = 5) {
  const key = searchKey(), prov = searchProvider();
  try {
    if (prov === 'tavily') {
      const res = await fetchWithTimeout('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: count, include_raw_content: true }) });
      if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
      const d = await res.json();
      return (d.results || []).map(r => ({ url: r.url, title: r.title || r.url, snippet: r.content || '', content: r.raw_content || '' }));
    }
    if (prov === 'serper') {
      const res = await fetchWithTimeout('https://google.serper.dev/search', { method: 'POST', headers: { 'content-type': 'application/json', 'X-API-KEY': key }, body: JSON.stringify({ q: query, num: count }) });
      if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
      const d = await res.json();
      return (d.organic || []).map(r => ({ url: r.link, title: r.title || r.link, snippet: r.snippet || '' }));
    }
    if (prov === 'jina') {
      const res = await fetchWithTimeout(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${key}` } }, 30000);
      if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
      const d = await res.json();
      return (d.data || []).slice(0, count).map(r => ({ url: r.url, title: r.title || r.url, snippet: r.description || '', content: r.content || '' }));
    }
  } catch (e) { console.warn('search key lookup failed, falling back', e); }
  // Marginalia's shared free key is often busy; after a failure, skip it for 10 minutes.
  if (Date.now() < marginaliaDownUntil) return [];
  try {
    const res = await fetchWithTimeout(`https://api.marginalia.nu/public/search/${encodeURIComponent(query)}?count=${count}`, {}, 8000);
    const d = res.ok ? await res.json().catch(() => null) : null;
    const results = (d?.results || []).map(r => ({ url: r.url, title: r.title || r.url, snippet: r.description || '' }));
    if (!results.length) marginaliaDownUntil = Date.now() + 10 * 60 * 1000;
    return results;
  } catch { marginaliaDownUntil = Date.now() + 10 * 60 * 1000; return []; }
}
let marginaliaDownUntil = 0;

/** Read a web page as text via Jina Reader. Returns {url, title, text} or null. */
export async function readPage(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const d = (await res.json()).data || {};
    const text = String(d.content || '');
    if (text.length < 200 || /\b(404|not found|access denied|forbidden|just a moment)\b/i.test(d.title || '')) return null;
    return { url: d.url || url, title: d.title || url, text };
  } catch { return null; }
}

const SPEC_RE = /(weigh|weight|mass|dimension|size|measure|length|width|height|depth|capacity|volume|liter|litre|\bL\b|\blbs?\b|\boz\b|\bkg\b|\bg\b|inch|\bin\.|\bcm\b|\bmm\b|cu\.? ?in|cubic|"|″)/i;
const NUM_UNIT_RE = /\d[\d.,/ ]*\s?(lbs?|oz|kg|g|in|inch|inches|cm|mm|"|″|l|liters?|litres?|cu\.? ?in)\b/i;
const STOP = new Set(['the', 'and', 'for', 'with', 'set', 'kit', 'pack', 'new', 'inch', 'inches']);

/** Tokens that identify a product; model numbers (contain digits) count most. */
export function productTokens(it) {
  const raw = `${it.brand || ''} ${it.model || ''} ${it.name || ''}`.toLowerCase();
  const toks = [...new Set(raw.split(/[^a-z0-9.]+/).map(t => t.replace(/^\.+|\.+$/g, '')).filter(t => t.length > 1 && !STOP.has(t)))];
  return { all: toks, models: toks.filter(t => /\d/.test(t) && /[a-z]|\d{3,}/.test(t)) };
}

function matchScore(text, tokens) {
  const t = String(text).toLowerCase();
  let s = 0;
  tokens.all.forEach(k => { if (t.includes(k)) s += 1; });
  tokens.models.forEach(k => { if (t.includes(k)) s += 4; });
  return s;
}

/** Keep only spec-related lines, to fit small context windows. */
export function specSnippets(text, maxChars = 2500) {
  const lines = String(text).split(/\n+/).map(l => l.replace(/!\[[^\]]*]\([^)]*\)/g, '').replace(/\[([^\]]*)]\([^)]*\)/g, '$1').trim()).filter(Boolean);
  const out = [];
  let size = 0;
  for (let i = 0; i < lines.length && size < maxChars; i++) {
    if (!SPEC_RE.test(lines[i]) || lines[i].length > 400) continue;
    const chunk = [lines[i - 1], lines[i], lines[i + 1]].filter(l => l && l.length < 400).join(' · ');
    out.push(chunk); size += chunk.length;
  }
  return out.join('\n').slice(0, maxChars);
}

/** Product-looking links on a page, best match first. */
function productLinks(page, tokens, limit = 2) {
  const seen = new Set();
  const out = [];
  for (const m of page.text.matchAll(/\[([^\]]{2,160})]\((https?:\/\/[^)\s]+)\)/g)) {
    const [, label, url] = m;
    if (seen.has(url) || /#|\.(jpg|png|webp|gif|svg|pdf)(\?|$)/i.test(url) || url === page.url) continue;
    seen.add(url);
    const score = matchScore(`${label} ${url}`, tokens);
    if (score >= (tokens.models.length ? 4 : 2)) out.push({ url, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.url);
}

const siteSearchUrls = domain => {
  const d = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return [];
  return [q => `https://www.${d.replace(/^www\./, '')}/search?q=${encodeURIComponent(q)}`, q => `https://www.${d.replace(/^www\./, '')}/?s=${encodeURIComponent(q)}`];
};

// A labeled spec line, e.g. "Weight: 6.30 lbs", "Exterior Dimensions 16 x 13 x 6.87 in", "Capacity (L) 65".
const LABEL_RE = /\b(weight|weighs|mass|dimensions?|measurements?|size|length|width|height|depth|capacity|volume)\b[^\n]{0,60}?\d/i;
export function labeledSpecLines(text) {
  return String(text).split(/\n+/).map(l => l.replace(/!\[[^\]]*]\([^)]*\)/g, '').replace(/\[([^\]]*)]\([^)]*\)/g, '$1').trim())
    .filter(l => l.length < 300 && LABEL_RE.test(l) && NUM_UNIT_RE.test(l));
}

/** Does this page actually talk about this product (not a menu, cookie banner or a different product)? */
function isAboutProduct(page, tokens) {
  const head = `${page.title} ${page.url} ${page.text.slice(0, 3000)}`.toLowerCase();
  if (tokens.models.length) return tokens.models.some(m => head.includes(m) || page.text.toLowerCase().includes(m));
  const words = tokens.all.filter(t => t.length > 2);
  return words.length ? words.filter(t => head.includes(t)).length / words.length >= 0.6 : false;
}

/** Score a page as evidence: must be about the product AND have labeled spec lines. */
function evidenceScore(page, tokens) {
  if (!isAboutProduct(page, tokens)) return 0;
  const n = labeledSpecLines(page.text).length;
  return n ? 5 + n + matchScore(`${page.title} ${page.url}`, tokens) : 0;
}

/**
 * Gather evidence for each item.
 * items: [{ name, brand?, model?, domain?, specUrl? }] → [{ index, sources: [{url, title, excerpt}], tried: [string] }]
 */
export async function gatherEvidence(items, { pagesPerItem = 2, charsPerPage = 2500 } = {}) {
  return Promise.all(items.map(async (it, index) => {
    const tokens = productTokens(it);
    const tried = [];
    const pages = [];
    const read = async url => {
      const p = await readPage(url);
      tried.push(`${p ? '✓' : '✗'} ${url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}`);
      return p;
    };
    const consider = (p, fromSearch = false) => {
      if (!p) return;
      const score = evidenceScore(p, tokens);
      pages.push({ ...p, score, fromSearch });
      if (!score) tried.push(`   ↳ no specs for this product on that page`);
    };

    // 1) AI-suggested product page
    if (it.specUrl) consider(await read(it.specUrl));

    // 2) web search (search key, else Marginalia)
    const q = [it.brand, it.model || it.name, 'specifications weight dimensions'].filter(Boolean).join(' ');
    const results = await searchWeb(q);
    tried.push(`${results.length ? '✓' : '✗'} search: "${q}" (${results.length} results${searchProvider() ? `, ${SEARCH_PROVIDERS[searchProvider()].label}` : ''})`);
    const ranked = results.map(r => ({ ...r, s: matchScore(`${r.title} ${r.url} ${r.snippet}`, tokens) })).sort((a, b) => b.s - a.s).slice(0, 3);
    await Promise.all(ranked.map(async r => {
      if (r.content && r.content.length > 300) { tried.push(`✓ ${r.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)} (from search)`); consider({ url: r.url, title: r.title, text: r.content }, true); }
      else consider(await read(r.url), true);
    }));

    // 3) manufacturer's own site search, if we still have nothing good
    if (!pages.some(p => p.score >= 7) && it.domain) {
      for (const mk of siteSearchUrls(it.domain)) {
        const p = await read(mk(it.model || it.name));
        if (p) { consider(p); break; }
      }
    }

    // 4) follow product links one hop from pages without good specs
    const hop = pages.filter(p => p.score < 7).flatMap(p => productLinks(p, tokens)).filter((u, i, a) => a.indexOf(u) === i && !pages.some(p => p.url === u)).slice(0, 3);
    (await Promise.all(hop.map(read))).forEach(p => consider(p));

    const sources = pages.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, pagesPerItem)
      .map(p => ({ url: p.url, title: p.title, excerpt: [`Page title: ${p.title}`, ...labeledSpecLines(p.text)].join('\n').slice(0, charsPerPage) }))
      .filter(s => s.excerpt.length > 40);
    return { index, sources, tried };
  }));
}
