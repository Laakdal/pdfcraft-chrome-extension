// PdfCraft for Chrome: background service worker.
//
// - Keeps the declarativeNetRequest redirect rules in step with the settings (lib/rules.js).
// - Sends file:// PDFs to the viewer (declarativeNetRequest doesn't see file URLs).
// - "Open in Chrome's viewer": a per-tab session allow rule for the next top-level load.
// - Context menu items and messages from the popup, viewer and content script.

import { isOpenableUrl, looksLikePdfUrl, viewerUrl } from './lib/pdf.js';
import { BYPASS_RULE_BASE, bypassRule, redirectRules } from './lib/rules.js';
import { loadSettings } from './lib/settings.js';

const BASE = chrome.runtime.getURL('');
const MENU_OPEN_LINK = 'pdfcraft-open-link';
const MENU_OPEN_FRAME = 'pdfcraft-open-frame';
const MENU_OPEN_PAGE = 'pdfcraft-open-page';

async function applyRules() {
  const settings = await loadSettings();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = settings.openWebPdfs ? redirectRules(BASE, { octetStream: settings.openOctetStreamPdfs }) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules,
  });
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_OPEN_LINK,
      title: chrome.i18n.getMessage('menuOpenLink'),
      contexts: ['link'],
      targetUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
    });
    chrome.contextMenus.create({
      id: MENU_OPEN_FRAME,
      title: chrome.i18n.getMessage('menuOpenFrame'),
      contexts: ['frame'],
    });
    chrome.contextMenus.create({
      id: MENU_OPEN_PAGE,
      title: chrome.i18n.getMessage('menuOpenPage'),
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*.pdf', 'https://*/*.pdf', 'http://*/*.PDF', 'https://*/*.PDF', 'file:///*'],
    });
  });
}

/** Open `url` (or the file chooser) in the viewer, in a PdfCraft workspace if `mode` is given:
 *  in `tab` (replacing it) or in a new tab next to it. */
async function openInViewer(url, { tab, replace = false, mode } = {}) {
  const target = viewerUrl(BASE, url, { mode });
  if (replace && tab?.id != null) {
    await chrome.tabs.update(tab.id, { url: target });
  } else {
    await chrome.tabs.create({ url: target, index: tab ? tab.index + 1 : undefined, openerTabId: tab?.id });
  }
}

// "Open in Chrome's PDF viewer": a session allow rule for the tab, for its next top-level load.
// The rule itself is the state (the worker may be suspended between the two navigation events),
// and it ends however that load ends: committed, failed, turned into a download, or tab closed.

async function bypassViewer(tabId, url) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [BYPASS_RULE_BASE + tabId], addRules: [bypassRule(tabId)] });
  await chrome.tabs.update(tabId, { url });
}

async function hasBypass(tabId) {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.some((rule) => rule.id === BYPASS_RULE_BASE + tabId);
}

async function endBypass(tabId) {
  if (await hasBypass(tabId)) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [BYPASS_RULE_BASE + tabId] });
}

chrome.runtime.onInstalled.addListener(() => {
  applyRules();
  createMenus();
});
chrome.runtime.onStartup.addListener(applyRules);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) applyRules();
});

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0 && !url.startsWith(BASE)) endBypass(tabId);
});
// A load that fails, or becomes a download (Chrome reports net::ERR_ABORTED), ends it too.
chrome.webNavigation.onErrorOccurred.addListener(({ tabId, frameId }) => {
  if (frameId === 0) endBypass(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => endBypass(tabId));

// Local files: declarativeNetRequest doesn't apply to file:// URLs, so watch top-level navigations.
// Chrome only reports these when the user has turned on "Allow access to file URLs".
/** tabId -> file URL being redirected; Chrome can report the same navigation twice. */
const redirecting = new Map();
chrome.webNavigation.onBeforeNavigate.addListener(
  async ({ tabId, frameId, url }) => {
    if (frameId !== 0 || !looksLikePdfUrl(url) || redirecting.get(tabId) === url) return;
    redirecting.set(tabId, url);
    setTimeout(() => redirecting.get(tabId) === url && redirecting.delete(tabId), 3000);
    const settings = await loadSettings();
    if (settings.openLocalPdfs) chrome.tabs.update(tabId, { url: viewerUrl(BASE, url) });
  },
  { url: [{ schemes: ['file'], pathSuffix: '.pdf' }, { schemes: ['file'], pathSuffix: '.PDF' }] },
);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === MENU_OPEN_LINK ? info.linkUrl : info.menuItemId === MENU_OPEN_FRAME ? info.frameUrl : info.pageUrl;
  if (url && isOpenableUrl(url)) openInViewer(url, { tab, replace: info.menuItemId === MENU_OPEN_PAGE });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tab = sender.tab;
  switch (message?.type) {
    case 'open-url':
      // From the popup (no sender tab: it names the tab) or the embedded-PDF button (sender tab).
      if (isOpenableUrl(message.url)) {
        const replace = Boolean(message.replace);
        const target = message.tabId != null ? { id: message.tabId, index: message.tabIndex ?? 0 } : tab;
        openInViewer(message.url, { tab: target, replace, mode: message.mode }).then(() => sendResponse({ ok: true }));
        return true;
      }
      sendResponse({ ok: false, error: 'unsupported-url' });
      return false;
    case 'open-viewer':
      openInViewer(null, { tab: message.tabId != null ? { id: message.tabId, index: message.tabIndex ?? 0 } : tab, mode: message.mode }).then(() =>
        sendResponse({ ok: true }),
      );
      return true;
    case 'bypass':
      // From the viewer: show this document in Chrome's own viewer, in the same tab.
      if (tab?.id != null && /^https?:/.test(message.url ?? '')) {
        bypassViewer(tab.id, message.url).then(() => sendResponse({ ok: true }));
        return true;
      }
      sendResponse({ ok: false });
      return false;
    case 'file-access':
      chrome.extension.isAllowedFileSchemeAccess().then((allowed) => sendResponse({ allowed }));
      return true;
    default:
      return false;
  }
});
