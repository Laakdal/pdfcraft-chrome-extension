// End-to-end: PDF navigations, MIME variants, errors, downloads and saving, in Chromium with the
// built extension. Run `npm run build` first, then `npm run test:e2e`.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { launch, viewerSource, waitForViewerReady } from './harness.mjs';

let env;
before(async () => {
  env = await launch();
});
after(async () => {
  await env?.close();
});

const viewerPage = () => `${env.base}viewer/viewer.html`;
const viewerPrefix = () => `${viewerPage()}?file=`;

async function open(path) {
  const page = await env.context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(env.fixtures.origin + path).catch(() => {});
  return { page, errors };
}

async function statusOf(page) {
  return page.evaluate(() => ({
    hidden: document.getElementById('status').hidden,
    title: document.getElementById('status-title').textContent,
    detail: document.getElementById('status-detail').textContent,
    name: document.getElementById('doc-name').textContent,
    meta: document.getElementById('doc-meta').textContent,
  }));
}

/** The finished download is a PDF; with PdfCraft's CLI installed (PDFCRAFT_CLI), also a valid one. */
async function assertSavedPdf(item) {
  for (let i = 0; i < 50 && !existsSync(item.filename); i++) await new Promise((r) => setTimeout(r, 100));
  const bytes = readFileSync(item.filename);
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const cli = process.env.PDFCRAFT_CLI ?? (process.platform === 'win32' ? 'C:/Program Files/PdfCraft/pdfcraft-cli.exe' : '');
  if (!cli || !existsSync(cli)) return null;
  const copy = join(tmpdir(), `pdfcraft-e2e-${Date.now()}.pdf`);
  writeFileSync(copy, bytes);
  try {
    const info = JSON.parse(execFileSync(cli, ['info', copy], { encoding: 'utf8' }));
    assert.deepEqual(info.warnings, []);
    return info;
  } finally {
    rmSync(copy, { force: true });
  }
}

async function downloads() {
  // Oldest first. (Playwright keeps downloads under GUID file names, so names come from the toast.)
  return env.worker.evaluate(() =>
    chrome.downloads.search({ orderBy: ['startTime'] }).then((items) => items.map((d) => ({ url: d.url, filename: d.filename, state: d.state, mime: d.mime }))),
  );
}

test('a direct PDF link opens in the PdfCraft viewer', async () => {
  const { page, errors } = await open('/doc.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  assert.equal((await viewerSource(page)).url, `${env.fixtures.origin}/doc.pdf`);
  await waitForViewerReady(page);
  const s = await statusOf(page);
  assert.equal(s.name, 'doc.pdf');
  assert.match(s.meta, /127\.0\.0\.1:\d+ · 1 KB/);
  // PdfCraft can show other documents in its own tabs, so once it runs neither the address bar
  // nor the top bar names this one.
  assert.equal(page.url(), viewerPage());
  assert.equal(await page.title(), 'PdfCraft');
  assert.ok(await page.isHidden('#doc-title'));
  assert.equal(await page.getAttribute('#btn-download', 'title'), 'Download doc.pdf as it was opened');
  await page.click('#btn-more');
  assert.equal(await page.textContent('#menu-label'), 'Original: doc.pdf');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.pdfcraftVersion), '0.8.0');
  assert.deepEqual(errors, []);
  await page.close();
});

test('clicking a PDF link and a target=_blank link both open the viewer', async () => {
  const { page } = await open('/');
  await page.click('#direct');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await page.goBack().catch(() => {});
  await page.waitForURL(`${env.fixtures.origin}/`);
  const [popup] = await Promise.all([env.context.waitForEvent('page'), page.click('#blank')]);
  await popup.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(popup);
  await popup.close();
  await page.close();
});

test('a redirect to a PDF opens the final URL', async () => {
  const { page } = await open('/redirect.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  assert.equal((await viewerSource(page)).url, `${env.fixtures.origin}/doc.pdf`);
  await waitForViewerReady(page);
  await page.close();
});

test('reloading the viewer reopens the same document from a clean address', async () => {
  const { page, errors } = await open('/doc.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(page);
  await page.reload();
  await waitForViewerReady(page);
  assert.equal(page.url(), viewerPage());
  assert.equal((await viewerSource(page)).url, `${env.fixtures.origin}/doc.pdf`);
  assert.equal((await statusOf(page)).name, 'doc.pdf');
  assert.equal(await page.isDisabled('#btn-download'), false);
  assert.deepEqual(errors, []);
  await page.close();
});

test('a PDF without .pdf in its path is recognised by Content-Type', async () => {
  const { page } = await open('/no-extension');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(page);
  assert.equal((await statusOf(page)).name, 'no-extension.pdf');
  await page.close();
});

/** Changes settings and waits until the service worker has applied the rules for them. */
async function setSettings(settings, ruleCount) {
  await env.worker.evaluate((s) => chrome.storage.local.set({ settings: s }), settings);
  for (let i = 0; i < 50; i++) {
    if ((await env.worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length))) === ruleCount) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('rules not updated');
}

test('a .pdf sent as application/octet-stream downloads by default, like Acrobat', async () => {
  const before = (await downloads()).length;
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/octet.pdf`).catch(() => {});
  await page.waitForTimeout(2000);
  assert.ok(!page.url().startsWith(viewerPage()), `unexpected viewer: ${page.url()}`);
  assert.equal((await downloads()).length, before + 1);
  await page.close();
});

test('with "Also open mislabelled PDFs" on, an octet-stream .pdf opens in the viewer', async () => {
  await setSettings({ openOctetStreamPdfs: true }, 2);
  try {
    const { page } = await open('/octet.pdf');
    await page.waitForURL((u) => u.href.startsWith(viewerPage()));
    await waitForViewerReady(page);
    await page.close();
  } finally {
    await setSettings({}, 1);
  }
});

test('query strings and fragments survive the redirect', async () => {
  const { page } = await open('/query.pdf?a=1&b=two#page=2');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  const docUrl = (await viewerSource(page)).url;
  assert.equal(docUrl, `${env.fixtures.origin}/query.pdf?a=1&b=two#page=2`);
  await waitForViewerReady(page);
  assert.equal((await statusOf(page)).name, 'query.pdf');
  await page.close();
});

test('a PDF sent as text/plain is left to Chrome', async () => {
  const { page } = await open('/plain.pdf');
  await page.waitForTimeout(1500);
  assert.equal(page.url(), `${env.fixtures.origin}/plain.pdf`);
  await page.close();
});

test('a PDF sent as an attachment downloads instead of opening', async () => {
  const before = (await downloads()).length;
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/attachment.pdf`).catch(() => {});
  await page.waitForTimeout(2000);
  assert.ok(!page.url().startsWith(viewerPage()), `unexpected viewer: ${page.url()}`);
  const after = await downloads();
  assert.equal(after.length, before + 1);
  assert.match(after.at(-1).url, /attachment\.pdf$/);
  await page.close();
});

test('a 404 at a .pdf address shows the site’s own error page', async () => {
  const { page } = await open('/missing.pdf');
  await page.waitForTimeout(1500);
  assert.equal(page.url(), `${env.fixtures.origin}/missing.pdf`);
  assert.match(await page.textContent('h1'), /Not found/);
  await page.close();
});

test('a file that claims to be a PDF but isn’t gets a clear error', async () => {
  const { page } = await open('/malformed.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await page.waitForSelector('#status.is-error');
  const s = await statusOf(page);
  assert.equal(s.title, "This isn't a PDF");
  assert.match(s.detail, /application\/pdf/);
  assert.ok(await page.isVisible('#btn-native'));
  assert.ok(await page.isVisible('#btn-pick'));
  assert.ok(await page.isHidden('#btn-continue'));
  assert.ok(await page.isVisible('#status-icon'));
  assert.ok(await page.isHidden('#status-spinner'));
  await page.close();
});

test('HTTP errors met by the viewer itself are explained', async () => {
  const page = await env.context.newPage();
  await page.goto(`${viewerPrefix()}${encodeURIComponent(`${env.fixtures.origin}/gone.pdf`)}`);
  await page.waitForSelector('#status.is-error');
  let s = await statusOf(page);
  assert.equal(s.title, "Couldn't open the document");
  assert.match(s.detail, /isn't there any more \(HTTP 404\)/);
  await page.goto(`${viewerPrefix()}${encodeURIComponent(`${env.fixtures.origin}/protected.pdf`)}`);
  await page.waitForSelector('#status.is-error');
  s = await statusOf(page);
  assert.match(s.detail, /refused access \(HTTP 401\)/);
  assert.ok(await page.isVisible('#btn-retry'));
  await page.close();
});

test('an unreachable server is reported as a network error', async () => {
  const page = await env.context.newPage();
  await page.goto(`${viewerPrefix()}${encodeURIComponent('http://127.0.0.1:9/nothing.pdf')}`);
  await page.waitForSelector('#status.is-error');
  assert.match((await statusOf(page)).detail, /couldn't be reached/);
  await page.close();
});

test('a large PDF (about 24 MB, 200 pages) opens', async () => {
  const { page } = await open('/large.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(page, { timeout: 120_000 });
  assert.match((await statusOf(page)).meta, /24\.\d MB/);
  await page.close();
});

test('the viewer refuses to run inside another site’s frame', async () => {
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/`);
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.id = 'framed';
    f.src = src;
    document.body.append(f);
  }, `${viewerPrefix()}${encodeURIComponent(`${env.fixtures.origin}/doc.pdf`)}`);
  await page.waitForTimeout(2000);
  const frame = page.frames().find((f) => f.url().startsWith(viewerPrefix()));
  if (frame) {
    // Chrome may block the frame outright (frame-ancestors); if it loads, the page must refuse.
    const s = await frame.evaluate(() => document.getElementById('status-title')?.textContent ?? '').catch(() => '');
    assert.ok(s === '' || s === 'Open this document in its own tab', `framed viewer showed: ${s}`);
    const fetched = await frame.evaluate(() => document.documentElement.dataset.pdfcraftVersion).catch(() => undefined);
    assert.equal(fetched, undefined);
  }
  await page.close();
});

test('"Download" saves the original bytes through chrome.downloads', async () => {
  const { page } = await open('/doc.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(page);
  const before = (await downloads()).length;
  await page.click('#btn-download');
  await page.waitForFunction(() => !document.getElementById('toast').hidden);
  assert.match(await page.textContent('#toast'), /Saved doc\.pdf/);
  const list = await downloads();
  assert.equal(list.length, before + 1);
  assert.match(list.at(-1).url, /^blob:chrome-extension:/);
  const info = await assertSavedPdf(list.at(-1));
  if (info) assert.equal(info.pages, 3);
  await page.close();
});

test('saving in PdfCraft (Ctrl+S) reaches the extension and downloads the PDF', async () => {
  const { page } = await open('/doc.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(page);
  const before = (await downloads()).length;
  const canvas = page.frameLocator('#pdfcraft').locator('canvas');
  await canvas.click({ position: { x: 700, y: 500 } });
  await page.keyboard.press('Control+S');
  await page.waitForFunction(() => /Saved/.test(document.getElementById('toast').textContent), null, { timeout: 15_000 });
  assert.match(await page.textContent('#toast'), /Saved doc\.pdf/);
  const list = await downloads();
  assert.equal(list.length, before + 1);
  assert.match(list.at(-1).url, /^blob:chrome-extension:/);
  const info = await assertSavedPdf(list.at(-1));
  if (info) assert.equal(info.pages, 3);
  await page.close();
});

test('"Open in Chrome\'s PDF viewer" bypasses the redirect for that load', async () => {
  const { page } = await open('/doc.pdf');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(page);
  await page.click('#btn-more');
  await page.click('#menu-native');
  await page.waitForURL(`${env.fixtures.origin}/doc.pdf`);
  await page.waitForTimeout(1000);
  assert.equal(page.url(), `${env.fixtures.origin}/doc.pdf`);
  // The bypass was for one load: the next navigation is redirected again.
  await page.goto(`${env.fixtures.origin}/no-extension`).catch(() => {});
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await page.close();
});

test('"Copy document link" copies the original URL', async () => {
  const { page } = await open('/query.pdf?a=1&b=two#page=2');
  await page.waitForURL((u) => u.href.startsWith(viewerPage()));
  await waitForViewerReady(page);
  // Reading the clipboard back would wait on a permission prompt; record what is written instead.
  await page.evaluate(() => {
    navigator.clipboard.writeText = async (text) => {
      window.__copied = text;
    };
  });
  await page.click('#btn-more');
  await page.click('#menu-source');
  await page.waitForFunction(() => !document.getElementById('toast').hidden);
  assert.equal(await page.textContent('#toast'), 'Link copied');
  assert.equal(await page.evaluate(() => window.__copied), `${env.fixtures.origin}/query.pdf?a=1&b=two#page=2`);
  await page.close();
});

test('a bypassed load that becomes a download doesn’t leave the tab bypassed', async () => {
  const page = await env.context.newPage();
  // The viewer can open an attachment-served PDF (it fetches the bytes itself).
  await page.goto(`${viewerPrefix()}${encodeURIComponent(`${env.fixtures.origin}/attachment.pdf`)}`);
  await waitForViewerReady(page);
  const before = (await downloads()).length;
  await page.click('#btn-more');
  await page.click('#menu-native');
  // Chrome downloads it instead of navigating, so the tab stays on the viewer.
  for (let i = 0; i < 50 && (await downloads()).length === before; i++) await page.waitForTimeout(100);
  assert.equal((await downloads()).length, before + 1);
  for (let i = 0; i < 50 && (await env.worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length; i++) await page.waitForTimeout(100);
  assert.deepEqual(await env.worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules()), []);
  await page.goto(`${env.fixtures.origin}/doc.pdf`).catch(() => {});
  for (let i = 0; i < 100 && !page.url().startsWith(viewerPage()); i++) await page.waitForTimeout(100);
  assert.ok(page.url().startsWith(viewerPage()), `not redirected: ${page.url()}`);
  await page.close();
});

test('turning the setting off leaves PDFs to Chrome', async () => {
  await env.worker.evaluate(() => chrome.storage.local.set({ settings: { openWebPdfs: false } }));
  await env.worker.evaluate(async () => {
    for (let i = 0; i < 50 && (await chrome.declarativeNetRequest.getDynamicRules()).length; i++) await new Promise((r) => setTimeout(r, 100));
  });
  const { page } = await open('/doc.pdf');
  await page.waitForTimeout(1500);
  assert.equal(page.url(), `${env.fixtures.origin}/doc.pdf`);
  await page.close();
  await env.worker.evaluate(() => chrome.storage.local.set({ settings: { openWebPdfs: true } }));
  await env.worker.evaluate(async () => {
    for (let i = 0; i < 50 && !(await chrome.declarativeNetRequest.getDynamicRules()).length; i++) await new Promise((r) => setTimeout(r, 100));
  });
});
