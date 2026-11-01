// Web lookup used to verify gear specs when the AI doing the check has no
// built-in web search. Layers, best first:
//  1. A free search API key, if the user added one (Tavily, Serper = Google results, or Jina Search)
//  2. Marginalia Search public API (keyless, but often busy)
//  3. The manufacturer's own site search (domain suggested by the AI)
// Pages are read as text via Jina Reader (keyless). When a page has no specs but
// links to the product (search results, category pages), the best-matching links
// are followed one hop.
import { CONFIG } from './config.js?v=202611012337';
import { settings } from './store.js?v=202611012337';

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

// The site's relay (config.js) can search with its own secret Serper/Tavily key.
let relaySearchOff = false;
export const relaySearchAvailable = () => !!(CONFIG.specProxyUrl || '').trim() && !relaySearchOff;
async function relaySearch(query, count) {
  const res = await fetchWithTimeout(new URL('search', CONFIG.specProxyUrl).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, count }) }, 25000);
  const d = await res.json().catch(() => ({}));
  if (res.status === 501 || res.status === 404) { relaySearchOff = true; return null; } // relay has no search set up
  if (!res.ok) throw new Error(d.error || `relay search HTTP ${res.status}`);
  return (d.results || []).map(r => ({ url: r.url, title: r.title || r.url, snippet: r.snippet || '', content: r.content || '' }));
}

/** Search the web. Returns [{url, title, snippet, content?}] or [] if nothing is available. */
export async function searchWeb(query, count = 5) {
  const key = searchKey(), prov = searchProvider();
  if (!key && relaySearchAvailable()) {
    try { const r = await relaySearch(query, count); if (r) return r; } catch (e) { console.warn('relay search failed, falling back', e); }
  }
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

// Social media, video and forum pages aren't reliable spec sources.
const LOW_QUALITY = /(^|\.)(facebook|instagram|tiktok|pinterest|quora|youtube|youtu|twitter|x|reddit|threads)\.(com|be)$/i;
export const isLowQuality = url => { try { return LOW_QUALITY.test(new URL(url).hostname); } catch { return true; } };
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
export const onDomain = (url, domain) => !!domain && hostOf(url).endsWith(String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''));

// Jina Reader's free tier allows ~20 reads/minute: keep at most 3 in flight and retry once when throttled.
let active = 0;
const waiting = [];
async function paced(fn) {
  if (active >= 3) await new Promise(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

// Set when the free page reader refuses us (rate limit), so the UI can say "busy" instead of "not found".
export const readerStatus = { busy: false };
let relayReadOff = false;

/** Read a web page as text: via the site's relay if it has one, else Jina Reader. Returns {url, title, text} or null. */
export async function readPage(url) {
  if (!/^https?:\/\//i.test(url || '') || isLowQuality(url)) return null;
  if (relaySearchAvailable() && !relayReadOff) {
    try {
      const res = await paced(() => fetchWithTimeout(new URL('read', CONFIG.specProxyUrl).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }, 30000));
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.text) return { url: d.url || url, title: d.title || url, text: d.text };
      if (res.status === 429) { readerStatus.busy = true; return null; }
      if (d.code === 'unreadable') return null;
      relayReadOff = true; // relay without /read (older code): use the browser reader from now on
    } catch { /* fall back to Jina from the browser */ }
  }
  try {
    let res = await paced(() => fetchWithTimeout(`https://r.jina.ai/${url}`, { headers: { Accept: 'application/json' } }));
    if (res.status === 429 || res.status >= 500) {
      await new Promise(r => setTimeout(r, 3000));
      res = await paced(() => fetchWithTimeout(`https://r.jina.ai/${url}`, { headers: { Accept: 'application/json' } }));
    }
    if (res.status === 429) { readerStatus.busy = true; return null; }
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

/**
 * Does this page actually talk about THIS product (not a menu, cookie banner or a sibling product)?
 * The page title/URL must carry the product's identity: its model number, or most of the
 * distinctive words of its model/name (e.g. "big river" for a Big River dry bag).
 */
function isAboutProduct(page, tokens, it) {
  const id = `${page.title} ${decodeURIComponent(page.url).replace(/[-_/]+/g, ' ')}`.toLowerCase();
  const brand = String(it?.brand || '').toLowerCase().split(/\s+/);
  const words = String(it?.model || it?.name || '').toLowerCase().split(/[^a-z0-9.]+/)
    .filter(t => t.length > 1 && !STOP.has(t) && !brand.includes(t));
  const numeric = words.filter(t => /\d/.test(t) && (/[a-z]/.test(t) || t.length >= 3));
  if (numeric.some(m => id.includes(m))) {
    // model number matches; also require the non-numeric model words if any (e.g. "aether" in "aether 65")
    const alpha = words.filter(t => !/\d/.test(t));
    return !alpha.length || alpha.filter(t => id.includes(t)).length / alpha.length >= 0.7;
  }
  const hits = words.filter(t => id.includes(t)).length;
  return words.length ? hits / words.length >= 0.6 : tokens.all.filter(t => id.includes(t)).length >= 2;
}

/** Score a page as evidence: must be about the product AND have labeled spec lines. */
function evidenceScore(page, tokens, it) {
  if (!isAboutProduct(page, tokens, it)) return 0;
  const n = labeledSpecLines(page.text).length;
  return n ? 5 + Math.min(n, 8) + matchScore(`${page.title} ${page.url}`, tokens) + (onDomain(page.url, it?.domain) ? 8 : 0) : 0;
}

/**
 * Gather evidence for each item, reading as few pages as possible:
 * manufacturer pages first, Google snippets that already contain specs, then other
 * results, the manufacturer's site search and one hop of product links, stopping as
 * soon as solid specs are found.
 * items: [{ name, brand?, model?, domain?, specUrl? }] → [{ index, sources: [{url, title, excerpt}], tried: [string] }]
 */
export async function gatherEvidence(items, { pagesPerItem = 2, charsPerPage = 2500, maxReads = 5 } = {}) {
  readerStatus.busy = false;
  return Promise.all(items.map(async (it, index) => {
    const tokens = productTokens(it);
    const tried = [];
    const pages = [];
    const seen = new Set();
    let reads = 0;
    const short = url => url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70);
    const solid = () => pages.some(p => p.score >= 9 || (p.score >= 7 && onDomain(p.url, it.domain)));
    const consider = p => {
      if (!p) return;
      const score = evidenceScore(p, tokens, it);
      pages.push({ ...p, score });
      if (!score) tried.push('   ↳ no specs for this product on that page');
    };
    const read = async url => {
      if (!url || seen.has(url) || reads >= maxReads || solid()) return null;
      seen.add(url); reads++;
      const p = await readPage(url);
      tried.push(`${p ? '✓' : '✗'} ${short(url)}${!p && readerStatus.busy ? ' (page reader busy)' : ''}`);
      consider(p);
      return p;
    };

    // 1) web search (relay / search key / Marginalia)
    const q = [it.brand, it.model || it.name, 'specifications weight dimensions'].filter(Boolean).join(' ');
    const results = (await searchWeb(q)).filter(r => !isLowQuality(r.url));
    tried.push(`${results.length ? '✓' : '✗'} search: "${q}" (${results.length} results${searchProvider() ? `, ${SEARCH_PROVIDERS[searchProvider()].label}` : relaySearchAvailable() ? ', site search relay' : ''})`);

    // 2) search results that already carry full page content (Tavily) or spec-bearing snippets
    for (const r of results) {
      if (r.content && r.content.length > 300) consider({ url: r.url, title: r.title, text: r.content });
      else if (r.snippet && labeledSpecLines(r.snippet.replace(/[·;]\s*/g, '\n')).length) {
        const snip = { url: r.url, title: r.title, text: r.snippet.replace(/[·;]\s*/g, '\n') };
        if (evidenceScore(snip, tokens, it)) { consider(snip); tried.push(`✓ ${short(r.url)} (Google snippet)`); }
      }
    }

    // 3) read pages in priority order: manufacturer results, AI-suggested page, other results
    const ranked = results.map(r => ({ ...r, s: matchScore(`${r.title} ${r.url} ${r.snippet}`, tokens) + (onDomain(r.url, it.domain) ? 6 : 0) })).sort((a, b) => b.s - a.s);
    const order = [...ranked.filter(r => onDomain(r.url, it.domain)).map(r => r.url), it.specUrl, ...ranked.map(r => r.url)].filter(Boolean);
    for (const url of order.slice(0, 4)) { if (solid()) break; await read(url); }

    // 4) manufacturer's own site search
    if (!solid() && it.domain) for (const mk of siteSearchUrls(it.domain)) { if (await read(mk(it.model || it.name))) break; }

    // 5) one hop of matching product links from pages that didn't have the specs
    if (!solid()) {
      const hop = pages.filter(p => p.score < 7 && p.text).flatMap(p => productLinks(p, tokens)).filter((u, i, a) => a.indexOf(u) === i);
      for (const url of hop.slice(0, 2)) { if (solid()) break; await read(url); }
    }

    const sources = pages.filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, pagesPerItem)
      .map(p => ({ url: p.url, title: p.title, excerpt: [`Page title: ${p.title}`, ...labeledSpecLines(p.text)].join('\n').slice(0, charsPerPage) }))
      .filter(s => s.excerpt.length > 40);
    return { index, sources, tried };
  }));
}
