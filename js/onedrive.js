// Excel Online: open and save workbooks stored in OneDrive or SharePoint via
// Microsoft Graph. Sign-in uses MSAL (popup) with the user's own Azure app
// registration (a free, one-time setup that gives a Client ID).
import { settings, saveSettings } from './store.js';
import { CONFIG } from './config.js';

const MSAL_URL = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@5.25.1/lib/msal-browser.min.js';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['User.Read', 'Files.ReadWrite.All'];
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let pca = null;
let account = null;

export const cloudSettings = () => (settings.cloud ||= { clientId: '', last: null });
export const siteClientId = () => (CONFIG.msClientId || '').trim();
/** The user's own Client ID wins; otherwise the site-wide one from config.js. */
export const clientIdInUse = () => cloudSettings().clientId || siteClientId();
export const cloudConfigured = () => !!clientIdInUse();
export const redirectUri = () => new URL('auth-redirect.html', location.href).href.split('?')[0];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error('Could not load the Microsoft sign-in library. Check your internet connection.')) });
    document.head.appendChild(s);
  });
}

async function client() {
  if (pca) return pca;
  const clientId = clientIdInUse();
  if (!clientId) throw new Error('Add your Microsoft app Client ID in Settings → Excel Online first.');
  if (!window.msal) await loadScript(MSAL_URL);
  const config = {
    auth: { clientId, authority: 'https://login.microsoftonline.com/common', redirectUri: redirectUri() },
    cache: { cacheLocation: 'localStorage' },
  };
  pca = msal.createStandardPublicClientApplication
    ? await msal.createStandardPublicClientApplication(config)
    : await (async () => { const p = new msal.PublicClientApplication(config); await p.initialize(); return p; })();
  account = pca.getActiveAccount() || pca.getAllAccounts()[0] || null;
  if (account) pca.setActiveAccount(account);
  return pca;
}

/** Forget the client (e.g. after the Client ID changes). */
export function resetClient() { pca = null; account = null; }

export async function currentAccount() {
  if (!cloudConfigured()) return null;
  try { await client(); return account; } catch { return null; }
}

export async function signIn() {
  const c = await client();
  const r = await c.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
  account = r.account; c.setActiveAccount(account);
  return account;
}

export async function signOut() {
  const c = await client();
  await c.clearCache({ account });
  account = null;
  cloudSettings().last = null; saveSettings();
}

async function accessToken() {
  const c = await client();
  if (!account) throw Object.assign(new Error('Sign in to Microsoft first.'), { needsSignIn: true });
  try {
    return (await c.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch {
    return (await c.acquireTokenPopup({ scopes: SCOPES, account })).accessToken;
  }
}

async function graph(path, opts = {}) {
  const token = await accessToken();
  const res = await fetch(path.startsWith('http') ? path : GRAPH + path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error?.message || ''; } catch { /* ignore */ }
    const hint = { 401: 'Your Microsoft sign-in expired. Sign in again.', 403: "You don't have permission to this file.", 404: 'The workbook was not found (moved, renamed or deleted?).',
      412: 'The workbook changed in Excel Online since you opened it.', 423: 'The workbook is locked (it may be checked out or being edited). Try again in a moment.' }[res.status];
    throw Object.assign(new Error(hint || msg || `Microsoft Graph error ${res.status}`), { status: res.status, detail: msg });
  }
  return res;
}

const meta = it => ({
  driveId: it.parentReference?.driveId, id: it.id, name: it.name, webUrl: it.webUrl, eTag: it.eTag,
  modified: it.lastModifiedDateTime, where: it.parentReference?.path?.replace(/^\/drive\/root:?/, '') || it.parentReference?.name || '',
});

/** Recent + searched .xlsx files the user can open (own drive, shared, SharePoint they've used). */
export async function listWorkbooks() {
  const sel = '$select=id,name,webUrl,eTag,lastModifiedDateTime,parentReference,remoteItem,file';
  const [recent, search] = await Promise.allSettled([
    graph(`/me/drive/recent?$top=100`).then(r => r.json()),
    graph(`/me/drive/root/search(q='xlsx')?$top=100&${sel}`).then(r => r.json()),
  ]);
  const out = new Map();
  for (const res of [recent, search]) {
    if (res.status !== 'fulfilled') continue;
    for (const raw of res.value.value || []) {
      const it = raw.remoteItem ? { ...raw.remoteItem, name: raw.name || raw.remoteItem.name } : raw;
      if (!/\.xlsx$/i.test(it.name || '') || !it.parentReference?.driveId) continue;
      const m = meta(it);
      out.set(`${m.driveId}/${m.id}`, m);
    }
  }
  if (!out.size && recent.status === 'rejected' && search.status === 'rejected') throw recent.reason;
  return [...out.values()].sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
}

/** Resolve an Excel Online / OneDrive / SharePoint share link to a file. */
export async function resolveShareLink(url) {
  const b64 = btoa(unescape(encodeURIComponent(url.trim()))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  const r = await graph(`/shares/u!${b64}/driveItem`);
  return meta(await r.json());
}

/** Download the workbook bytes plus fresh metadata (eTag for safe saving). */
export async function downloadWorkbook(f) {
  const r = await graph(`/drives/${f.driveId}/items/${f.id}`);
  const it = await r.json();
  const url = it['@microsoft.graph.downloadUrl'];
  if (!url) throw new Error('Microsoft did not return a download link for this file.');
  const file = await fetch(url); // pre-authenticated URL, no token needed
  if (!file.ok) throw new Error(`Download failed (HTTP ${file.status}).`);
  return { buf: await file.arrayBuffer(), meta: meta(it) };
}

/** Upload the workbook. Uses If-Match so we never silently overwrite someone else's newer edits. */
export async function uploadWorkbook(f, data, { force = false } = {}) {
  const r = await graph(`/drives/${f.driveId}/items/${f.id}/content`, {
    method: 'PUT', body: new Blob([data], { type: XLSX_MIME }),
    headers: { 'Content-Type': XLSX_MIME, ...(force || !f.eTag ? {} : { 'If-Match': f.eTag }) },
  });
  return meta(await r.json());
}

/** Create a new workbook in the user's OneDrive (FieldPack folder). */
export async function createInOneDrive(name, data) {
  const path = `/me/drive/root:/FieldPack/${encodeURIComponent(name)}:/content?@microsoft.graph.conflictBehavior=rename`;
  const r = await graph(path, { method: 'PUT', body: new Blob([data], { type: XLSX_MIME }), headers: { 'Content-Type': XLSX_MIME } });
  return meta(await r.json());
}

export function rememberFile(f) { cloudSettings().last = f ? { driveId: f.driveId, id: f.id, name: f.name, webUrl: f.webUrl } : null; saveSettings(); }
