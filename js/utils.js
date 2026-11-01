// Small shared helpers: escaping, ids, units, toasts, modals, markdown.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const uid = (prefix = 'x') => `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const num = (v, d = 0) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : d;
};

export const round = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

// ----- Units (storage is always metric) -----
export const KG_PER_LB = 0.45359237;
export function fmtWeight(kg, units = 'metric') {
  if (units === 'imperial') return `${round(kg / KG_PER_LB, 1)} lb`;
  return kg < 1 && kg > 0 ? `${Math.round(kg * 1000)} g` : `${round(kg, 2)} kg`;
}
export function fmtVolume(l, units = 'metric') {
  if (units === 'imperial') return `${round(l * 61.0237 / 1000, 2)} ft³`;
  return `${round(l, 1)} L`;
}
export const weightToDisplay = (kg, units) => units === 'imperial' ? round(kg / KG_PER_LB, 2) : round(kg, 3);
export const weightFromDisplay = (v, units) => units === 'imperial' ? num(v) * KG_PER_LB : num(v);
export const weightUnit = units => units === 'imperial' ? 'lb' : 'kg';

export const splitList = v => Array.isArray(v) ? v : String(v ?? '').split(/[;,|\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);

// ----- Toasts -----
export function toast(msg, type = 'info', ms = 3200) {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild.remove();
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// ----- Modal -----
export function openModal(html, { onMount, onClose, wide = false } = {}) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button class="modal-x" data-close aria-label="Close">✕</button>${html}</div></div>`;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    root.innerHTML = ''; document.removeEventListener('keydown', onKey); onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-backdrop').addEventListener('mousedown', e => {
    if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) close();
  });
  onMount?.(root.querySelector('.modal'), close);
  return close;
}

export function confirmDialog(message, okLabel = 'Yes') {
  return new Promise(resolve => {
    let ok = false;
    openModal(`<h3>Are you sure?</h3><p>${esc(message)}</p>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" id="cfOk">${esc(okLabel)}</button></div>`, {
      onMount: (m, close) => { m.querySelector('#cfOk').onclick = () => { ok = true; close(); }; },
      onClose: () => resolve(ok),
    });
  });
}

// ----- Tiny markdown renderer (headings, lists, tables, code, bold/italic) -----
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
export function markdown(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) { const lvl = Math.min(h[1].length + 2, 6); html += `<h${lvl}>${inline(h[2])}</h${lvl}>`; i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:-]+\|/.test(lines[i + 1] || '')) {
      const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(line); i += 2;
      let t = `<div class="table-wrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) t += `<tr>${row(lines[i++]).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`;
      html += t + '</tbody></table></div>';
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      let l = `<${ordered ? 'ol' : 'ul'}>`;
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        l += `<li>${inline(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '').replace(/^\[( |x)\]\s*/i, m => m.includes('x') || m.includes('X') ? '✅ ' : '⬜ '))}</li>`; i++;
      }
      html += l + `</${ordered ? 'ol' : 'ul'}>`;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    if (!line.trim()) { i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+\.)\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    if (para.length) html += `<p>${inline(para.join(' '))}</p>`;
    else { html += `<p>${inline(line)}</p>`; i++; }
  }
  return html;
}

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
