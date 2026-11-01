// Free, keyless web lookup used to verify gear specs when the chosen AI has no
// built-in web search. Uses only official, browser-friendly free services:
//  - Marginalia Search public API (independent search engine; shared free key,
//    so it is often busy; treated as best effort)
//  - Jina Reader (turns any web page into plain text)
// The AI also suggests the manufacturer's product page, which we read the same way.

const TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

/** Search the web (best effort). Returns [{url, title, snippet}] or [] if unavailable. */
export async function searchWeb(query, count = 4) {
  try {
    const res = await fetchWithTimeout(`https://api.marginalia.nu/public/search/${encodeURIComponent(query)}?count=${count}`, {}, 10000);
    if (!res.ok) return [];
    const d = await res.json();
    return (d.results || []).map(r => ({ url: r.url, title: r.title || r.url, snippet: r.description || '' }));
  } catch { return []; }
}

/** Read a web page as text via Jina Reader. Returns {url, title, text} or null. */
export async function readPage(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const d = (await res.json()).data || {};
    const text = String(d.content || '');
    if (text.length < 200 || /404|page not found|access denied/i.test(d.title || '')) return null;
    return { url: d.url || url, title: d.title || url, text };
  } catch { return null; }
}

const SPEC_RE = /(weigh|weight|mass|dimension|size|measure|length|width|height|depth|capacity|volume|liter|litre|\bL\b|\blbs?\b|\boz\b|\bkg\b|\bg\b|inch|\bin\.|\bcm\b|\bmm\b|cu\.? ?in|cubic)/i;

/** Keep only the parts of a page that talk about specs, to fit small context windows. */
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

/**
 * Gather evidence for each item: the AI-suggested product page(s) plus best-effort search results.
 * items: [{ name, specUrl? }] → [{ index, sources: [{url, title, excerpt}] }]
 */
export async function gatherEvidence(items, { pagesPerItem = 2, charsPerPage = 2500 } = {}) {
  return Promise.all(items.map(async (it, index) => {
    const candidates = [];
    if (it.specUrl) candidates.push(it.specUrl);
    const found = await searchWeb(`${it.name} specifications weight dimensions`);
    found.forEach(r => candidates.push(r.url));
    const unique = [...new Set(candidates)].slice(0, pagesPerItem + 1);
    const pages = (await Promise.all(unique.map(readPage))).filter(Boolean);
    const sources = pages.map(p => ({ url: p.url, title: p.title, excerpt: specSnippets(p.text, charsPerPage) }))
      .filter(s => s.excerpt.length > 40).slice(0, pagesPerItem);
    return { index, sources };
  }));
}
