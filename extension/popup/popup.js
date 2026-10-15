// The toolbar popup. Every action opens PdfCraft in a tab: a popup closes as soon as it loses
// focus, so it can't host a file chooser or the PdfCraft app itself.

import { documentUrlFromViewer, filenameFromUrl, isOpenableUrl, looksLikePdfUrl, pdfFilename, VIEWER_PATH } from '../lib/pdf.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { localize, t } from '../ui/i18n.js';
import { applyTheme } from '../ui/theme.js';

const MAX_LISTED = 3;

applyTheme();
localize();

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const viewerBase = chrome.runtime.getURL(VIEWER_PATH);
/** The PDF the active tab shows, if any: a document URL PdfCraft can open again. */
let currentPdf = null;

function send(message) {
  return chrome.runtime.sendMessage({ ...message, tabId: tab?.id, tabIndex: tab?.index }).finally(() => window.close());
}

document.getElementById('btn-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
document.getElementById('btn-select').addEventListener('click', () => send({ type: 'open-viewer' }));
for (const row of document.querySelectorAll('.row[data-mode]')) {
  row.addEventListener('click', () => {
    const mode = row.dataset.mode;
    // A row works on the PDF in this tab when there is one, otherwise it asks for a file.
    send(currentPdf ? { type: 'open-url', url: currentPdf, mode } : { type: 'open-viewer', mode });
  });
}

const toggle = document.getElementById('toggle-web');
toggle.checked = (await loadSettings()).openWebPdfs;
toggle.addEventListener('change', () => saveSettings({ openWebPdfs: toggle.checked }));

await describeTab();

async function describeTab() {
  const url = tab?.url ?? '';
  if (url.startsWith(viewerBase) || !url) {
    // Already in PdfCraft (a tab URL we can't read is our own viewer, or a page we may not see):
    // the rows open this document in another workspace.
    const answer = await askViewer(tab?.id);
    currentPdf = answer?.url ?? (url ? documentUrlFromViewer(url) : null);
    if (currentPdf) showInPdfCraft(answer?.name ?? pdfFilename(filenameFromUrl(currentPdf)));
    return;
  }
  if (!/^(https?|file):/.test(url)) return; // chrome://, the Web Store and so on: nothing to read.

  let page = null;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: inspectPage, args: [MAX_LISTED * 10] });
    page = result?.result ?? null;
  } catch {
    // Pages extensions may not script (policy, error pages). Fall back to the address alone.
  }

  if ((page?.contentType === 'application/pdf' || (!page && looksLikePdfUrl(url))) && isOpenableUrl(url)) {
    currentPdf = url;
    showThisPdf(url);
  } else if (page?.pdfs.length) {
    showPagePdfs(page.pdfs);
  }
}

/** The document a PdfCraft viewer in `tabId` shows, or null when that tab isn't a viewer. */
function askViewer(tabId) {
  if (tabId == null) return Promise.resolve(null);
  const answer = chrome.runtime.sendMessage({ type: 'viewer-document', tabId }).catch(() => null);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 500));
  return Promise.race([answer, timeout]);
}

/** Runs in the page: is it a PDF (Chrome's viewer), and which PDFs does it link to or embed? */
function inspectPage(limit) {
  const found = new Map();
  const add = (raw, label) => {
    try {
      const u = new URL(raw, document.baseURI);
      if ((u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') && /\.pdf$/i.test(u.pathname) && !found.has(u.href)) {
        found.set(u.href, (label || '').trim().replace(/\s+/g, ' ').slice(0, 120));
      }
    } catch {
      // not a URL
    }
  };
  if (document.contentType !== 'application/pdf') {
    for (const el of document.querySelectorAll('embed[src], iframe[src], object[data]')) add(el.getAttribute('src') ?? el.getAttribute('data'), '');
    for (const a of document.querySelectorAll('a[href]')) {
      if (found.size >= limit) break;
      add(a.getAttribute('href'), a.textContent);
    }
  }
  return { contentType: document.contentType, pdfs: [...found].map(([url, text]) => ({ url, text })) };
}

function spriteIcon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `../icons/ui.svg#${id}`);
  svg.append(use);
  return svg;
}

function showThisPdf(url) {
  const card = document.getElementById('context');
  const title = document.createElement('p');
  title.className = 'ctx-title';
  title.textContent = t('popupThisPdf');
  const detail = document.createElement('p');
  detail.className = 'ctx-detail';
  detail.textContent = pdfFilename(filenameFromUrl(url));
  const actions = document.createElement('div');
  actions.className = 'ctx-actions';
  const open = document.createElement('button');
  open.className = 'pill';
  open.type = 'button';
  open.id = 'btn-open-this';
  open.textContent = t('popupOpenThis');
  open.addEventListener('click', () => send({ type: 'open-url', url, replace: true }));
  actions.append(open);
  card.replaceChildren(title, detail, actions);
  card.hidden = false;
}

function showInPdfCraft(name) {
  const card = document.getElementById('context');
  const title = document.createElement('p');
  title.className = 'ctx-title';
  title.textContent = t('popupInPdfCraft');
  const detail = document.createElement('p');
  detail.className = 'ctx-detail ctx-detail-last';
  detail.textContent = t('popupInPdfCraftDetail', [name]);
  card.replaceChildren(title, detail);
  card.hidden = false;
}

function showPagePdfs(pdfs) {
  const card = document.getElementById('context');
  const title = document.createElement('p');
  title.className = 'ctx-title';
  title.textContent = t(pdfs.length === 1 ? 'popupPagePdfsOne' : 'popupPagePdfs', [String(pdfs.length)]);
  const list = document.createElement('ul');
  list.className = 'ctx-list';
  for (const { url, text } of pdfs.slice(0, MAX_LISTED)) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.className = 'ctx-item';
    button.type = 'button';
    button.title = url;
    button.append(spriteIcon('file'));
    const label = document.createElement('span');
    label.textContent = pdfFilename(filenameFromUrl(url)) + (text && !/\.pdf$/i.test(text) ? ` · ${text}` : '');
    button.append(label);
    button.addEventListener('click', () => send({ type: 'open-url', url }));
    item.append(button);
    list.append(item);
  }
  card.replaceChildren(title, list);
  if (pdfs.length > MAX_LISTED) {
    const more = document.createElement('p');
    more.className = 'ctx-more';
    more.textContent = t('popupPagePdfsMore', [String(pdfs.length - MAX_LISTED)]);
    card.append(more);
  }
  card.hidden = false;
}
