// The PdfCraft viewer page: downloads the document, hosts the bundled PdfCraft web app in a
// same-origin iframe and talks to it through PdfCraft's `?host=parent` postMessage bridge
// (apps/pdfcraft-web/src/main.rs upstream):
//   pdfcraft:ready  (from PdfCraft)  the app listens; files can be sent
//   pdfcraft:open   (to PdfCraft)    { name, bytes } opens a document in a tab
//   pdfcraft:save   (from PdfCraft)  { name, saveAs, bytes } the user saved; we download it
//   pdfcraft:dirty  (from PdfCraft)  { dirty } unsaved work appeared or went away
//   pdfcraft:failed (from PdfCraft)  { error } the app couldn't start (no WebGL, for example)

import {
  documentUrlFromViewer,
  modeFromViewer,
  filenameFromDisposition,
  filenameFromUrl,
  formatBytes,
  hasPdfSignature,
  pdfFilename,
} from '../lib/pdf.js';
import { prepareWorkspace } from '../lib/workspace.js';
import { localize, t } from '../ui/i18n.js';
import { applyTheme } from '../ui/theme.js';

const READY_TIMEOUT_MS = 60_000;

const $ = (id) => document.getElementById(id);
const frame = $('pdfcraft');
const state = {
  ...documentSource(),
  name: null,
  original: null, // Uint8Array of the downloaded document, for "Download"
  dirty: false,
};

let resolveReady;
let rejectReady;
const pdfcraftReady = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});

applyTheme();
localize();

if (window.top !== window) {
  // Pages may frame this (it is web-accessible so PDF redirects can reach it). Never fetch with
  // the extension's access on another page's behalf.
  showError(t('viewerFramedTitle'), t('viewerFramedDetail'), {});
} else {
  start();
}

/**
 * The document (and workspace) this tab opens. Redirects and the popup pass it in the address
 * (`?mode=…&file=…`). It then moves into history.state: PdfCraft can hold several documents in its
 * own tabs, so the address bar shows just the PdfCraft page, while a reload or Back/Forward still
 * reopens the same document.
 */
function documentSource() {
  if (window.top !== window) return { url: null, mode: null };
  const url = documentUrlFromViewer(location.href);
  const mode = modeFromViewer(location.href);
  if (url || mode) {
    history.replaceState({ ...history.state, pdfcraftSource: { url, mode } }, '', location.pathname);
    return { url, mode };
  }
  const saved = history.state?.pdfcraftSource;
  return { url: saved?.url ?? null, mode: saved?.mode ?? null };
}

async function start() {
  wireChrome();
  prepareWorkspace(state.mode);
  frame.src = 'pdfcraft/index.html?host=parent';
  const timer = setTimeout(() => rejectReady(new Error(t('viewerStartTimeout'))), READY_TIMEOUT_MS);
  pdfcraftReady.finally(() => clearTimeout(timer)).catch(() => {});

  if (!state.url) {
    // Opened from the popup's "Select a file" or a workspace row: ask for a file. A popup can't
    // keep a file chooser open, so choosing happens here. "Continue" shows PdfCraft's home page.
    setTitle(t('viewerNoDocument'), '');
    showLanding();
    pdfcraftReady.catch(showStartError);
    return;
  }

  const fallbackName = pdfFilename(filenameFromUrl(state.url));
  setTitle(fallbackName, hostLabel(state.url));
  $('menu-source').hidden = false;
  $('menu-native').hidden = !/^https?:/.test(state.url);
  showStatus(t('viewerDownloading'), hostLabel(state.url), { spinner: true, progress: 0 });

  let download;
  try {
    download = await fetchDocument(state.url, (loaded, total) => {
      $('status-detail').textContent = total ? `${formatBytes(loaded)} / ${formatBytes(total)}` : formatBytes(loaded);
      setProgress(total ? loaded / total : null);
    });
  } catch (error) {
    showFetchError(error);
    return;
  }

  if (!hasPdfSignature(download.bytes)) {
    showError(t('viewerNotPdfTitle'), t('viewerNotPdfDetail', [download.type || t('viewerUnknownType')]), {
      native: /^https?:/.test(state.url),
      pick: true,
    });
    return;
  }

  setOriginal(pdfFilename(download.name, fallbackName), download.bytes);
  setTitle(state.name, `${hostLabel(state.url)} · ${formatBytes(download.bytes.length)}`);
  showStatus(t('viewerStarting'), '', { spinner: true });
  try {
    await pdfcraftReady;
  } catch (error) {
    showStartError(error);
    return;
  }
  sendToPdfCraft(state.name, download.bytes.slice());
  hideStatus();
}

/** Downloads `url` with the extension's host access (no CORS) and the user's cookies. */
async function fetchDocument(url, onProgress) {
  if (url.startsWith('file:')) return fetchLocalFile(url, onProgress);
  let response;
  try {
    response = await fetch(url, { credentials: 'include', cache: 'default', redirect: 'follow' });
  } catch (cause) {
    throw Object.assign(new Error(navigator.onLine ? 'network' : 'offline'), { cause });
  }
  if (!response.ok) throw Object.assign(new Error('http'), { status: response.status });
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return {
    bytes,
    type: response.headers.get('content-type') ?? '',
    name: filenameFromDisposition(response.headers.get('content-disposition')) ?? filenameFromUrl(response.url),
  };
}

/** fetch() can't read file:// URLs; XMLHttpRequest can once the user allows file access. */
function fetchLocalFile(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : 0);
    xhr.onload = () => {
      if (xhr.response && xhr.response.byteLength > 0) {
        resolve({ bytes: new Uint8Array(xhr.response), type: '', name: filenameFromUrl(url) });
      } else {
        reject(Object.assign(new Error('file'), { status: xhr.status }));
      }
    };
    xhr.onerror = () => reject(new Error('file'));
    xhr.send();
  });
}

function sendToPdfCraft(name, bytes) {
  frame.contentWindow.postMessage({ type: 'pdfcraft:open', name, bytes: bytes.buffer }, location.origin, [bytes.buffer]);
}

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data ?? {};
  switch (data.type) {
    case 'pdfcraft:ready':
      document.documentElement.dataset.pdfcraftVersion = data.version ?? '';
      resolveReady();
      break;
    case 'pdfcraft:failed':
      rejectReady(new Error(data.error || 'failed'));
      break;
    case 'pdfcraft:dirty':
      state.dirty = Boolean(data.dirty);
      $('unsaved').hidden = !state.dirty;
      break;
    case 'pdfcraft:save':
      saveBytes(data.name, data.bytes, Boolean(data.saveAs));
      break;
  }
});

// PdfCraft (same origin, in the iframe) saved its settings: follow a theme change.
window.addEventListener('storage', (event) => {
  if (event.key === 'pdfcraft') applyTheme();
});

// The popup asks which document this tab shows (it can't read our own tab's URL).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'viewer-document') return false;
  chrome.tabs.getCurrent().then((tab) => {
    if (tab?.id === message.tabId) sendResponse({ url: state.url, name: state.name });
  });
  return true;
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirty) event.preventDefault();
});

async function saveBytes(name, buffer, saveAs) {
  const filename = pdfFilename(name, state.name);
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
  try {
    // saveAs only when PdfCraft asked for "Save As"; otherwise Chrome's "Ask where to save" setting decides.
    await chrome.downloads.download({ url, filename, saveAs: saveAs || undefined, conflictAction: 'uniquify' });
    toast(t('viewerSaved', [filename]));
  } catch (error) {
    toast(t('viewerSaveFailed', [String(error.message ?? error)]));
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Opens PDFs chosen or dropped by the user, each in its own PdfCraft tab. */
async function openLocalFiles(files) {
  if (!files.length) return;
  showStatus(t('viewerStarting'), '', { spinner: true });
  try {
    await pdfcraftReady;
  } catch (error) {
    showStartError(error);
    return;
  }
  let opened = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasPdfSignature(bytes)) {
      toast(t('viewerLocalNotPdf', [file.name]));
      continue;
    }
    if (!state.original) {
      setOriginal(pdfFilename(file.name), bytes.slice());
      setTitle(state.name, `${t('viewerLocalFile')} · ${formatBytes(bytes.length)}`);
    }
    sendToPdfCraft(pdfFilename(file.name), bytes);
    opened++;
  }
  if (opened || state.original) hideStatus();
  else showLanding();
}

function showLanding() {
  const key = state.mode ? `landing_${state.mode}` : 'landing';
  showStatus(t(`${key}Title`), t('landingDetail'));
  $('status-card').classList.add('is-landing');
  $('landing-icon').hidden = false;
  $('status-actions').hidden = false;
  $('btn-pick').hidden = false;
  $('btn-pick').classList.replace('btn-secondary', 'btn-primary');
  $('btn-continue').hidden = false;
}

function wireChrome() {
  const input = $('file-input');
  const pick = () => input.click();
  $('btn-open').addEventListener('click', pick);
  $('btn-pick').addEventListener('click', pick);
  $('btn-continue').addEventListener('click', async () => {
    showStatus(t('viewerStarting'), '', { spinner: true });
    try {
      await pdfcraftReady;
      hideStatus();
    } catch (error) {
      showStartError(error);
    }
  });
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    openLocalFiles(files);
  });

  // Files dropped anywhere on the page. (PdfCraft takes drops on its own canvas too.)
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      document.body.classList.remove('is-dragging');
    }
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    openLocalFiles([...e.dataTransfer.files]);
  });

  $('btn-download').addEventListener('click', () => {
    if (state.original) saveBytes(state.name, state.original.slice().buffer, false);
  });

  const more = $('btn-more');
  const menu = $('menu-more');
  const setMenu = (open) => {
    menu.hidden = !open;
    more.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.menu-item:not([hidden])')?.focus();
  };
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(menu.hidden);
  });
  document.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      setMenu(false);
      more.focus();
    }
  });
  frame.addEventListener('focus', () => setMenu(false));

  const native = () => chrome.runtime.sendMessage({ type: 'bypass', url: state.url });
  $('menu-native').addEventListener('click', native);
  $('btn-native').addEventListener('click', native);
  $('menu-source').addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.url);
    toast(t('viewerLinkCopied'));
  });
  $('menu-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-retry').addEventListener('click', () => location.reload());
}

/** The document this tab was opened with: "Download original" and the ⋮ menu act on it. */
function setOriginal(name, bytes) {
  state.name = name;
  state.original = bytes;
  $('btn-download').disabled = false;
  $('btn-download').title = t('viewerDownloadTipNamed', [name]);
  $('menu-label').textContent = t('viewerOriginalLabel', [name]);
  $('menu-label').hidden = false;
}

/** Names the document in the top bar while it loads or fails; see hideStatus. */
function setTitle(name, meta) {
  $('doc-name').textContent = name;
  $('doc-meta').textContent = meta;
  document.title = state.url || state.original ? `${name} – PdfCraft` : 'PdfCraft';
}

/** The top bar names a document only while the status card shows; PdfCraft's tabs name the rest. */
function showDocTitle(shown) {
  $('doc-title').hidden = !shown;
  $('doc-divider').hidden = !shown;
}

function hostLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' ? t('viewerLocalFile') : parsed.host;
  } catch {
    return '';
  }
}

/** Puts the overlay back to its plain state: no landing extras, no buttons. */
function resetStatus() {
  $('status').hidden = false;
  showDocTitle(true);
  $('status').classList.remove('is-error');
  $('status-card').classList.remove('is-landing');
  $('landing-icon').hidden = true;
  $('btn-pick').classList.replace('btn-primary', 'btn-secondary');
  for (const id of ['btn-retry', 'btn-native', 'btn-pick', 'btn-continue']) $(id).hidden = true;
}

function showStatus(title, detail, { spinner = false, progress = null } = {}) {
  resetStatus();
  $('status-spinner').hidden = !spinner;
  $('status-icon').toggleAttribute('hidden', true); // an <svg>: no .hidden property
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('status-actions').hidden = true;
  $('progress').hidden = progress == null;
  if (progress != null) setProgress(progress);
}

function setProgress(fraction) {
  const bar = $('progress-bar');
  $('progress').hidden = false;
  bar.classList.toggle('is-indeterminate', fraction == null);
  if (fraction != null) bar.style.width = `${Math.round(fraction * 100)}%`;
}

/**
 * PdfCraft takes over: it may show other documents in its own tabs (its "+ Open", drops) and
 * doesn't tell the host which one is active, so the bar and the browser tab stop naming one.
 */
function hideStatus() {
  $('status').hidden = true;
  showDocTitle(false);
  document.title = 'PdfCraft';
}

function showError(title, detail, { retry = false, native = false, pick = false }) {
  resetStatus();
  $('status').classList.add('is-error');
  $('status-spinner').hidden = true;
  $('status-icon').toggleAttribute('hidden', false);
  $('status-title').textContent = title;
  $('status-detail').textContent = detail;
  $('progress').hidden = true;
  $('btn-retry').hidden = !retry;
  $('btn-native').hidden = !native;
  $('btn-pick').hidden = !pick;
  $('status-actions').hidden = !(retry || native || pick);
  document.title = `${title} – PdfCraft`;
}

function showFetchError(error) {
  const http = /^https?:/.test(state.url);
  if (error.message === 'offline') {
    showError(t('viewerOfflineTitle'), t('viewerOfflineDetail'), { retry: true, pick: true });
  } else if (error.message === 'http') {
    const key = error.status === 401 || error.status === 403 ? 'viewerDeniedDetail' : error.status === 404 || error.status === 410 ? 'viewerMissingDetail' : 'viewerHttpDetail';
    showError(t('viewerFetchTitle'), t(key, [String(error.status)]), { retry: true, native: http, pick: true });
  } else if (error.message === 'file') {
    showError(t('viewerFileTitle'), t('viewerFileDetail'), { retry: true, pick: true });
  } else {
    showError(t('viewerFetchTitle'), t('viewerNetworkDetail'), { retry: true, native: http, pick: true });
  }
}

function showStartError(error) {
  showError(t('viewerStartFailedTitle'), t('viewerStartFailedDetail', [String(error.message ?? error)]), { retry: true, native: /^https?:/.test(state.url ?? '') });
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}
