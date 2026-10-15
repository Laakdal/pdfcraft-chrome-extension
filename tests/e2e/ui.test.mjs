// End-to-end: the toolbar popup, workspaces, the file chooser page, the embedded-PDF button,
// local files and offline use. Run `npm run build` first, then `npm run test:e2e`.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { makePdf } from '../fixtures/make-pdf.mjs';
import { launch, openPopup, waitForViewerReady } from './harness.mjs';

let env;
before(async () => {
  env = await launch({ cdpPort: 9400 + Math.floor(Math.random() * 400) });
});
after(async () => {
  await env?.close();
});

const viewer = () => `${env.base}viewer/viewer.html`;

async function withPopup(page, fn) {
  await page.bringToFront();
  const { popup, disconnect } = await openPopup(env);
  try {
    await popup.waitForFunction(() => document.getElementById('toggle-web') && document.readyState === 'complete');
    await popup.waitForTimeout(300); // the context card is filled asynchronously
    return await fn(popup);
  } finally {
    // Chrome won't open a second popup while one is showing (actions that open a tab close it).
    if (!popup.isClosed()) await popup.evaluate(() => window.close()).catch(() => {});
    await disconnect().catch(() => {});
  }
}

async function pdfcraftSettings(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pdfcraft') ?? 'null'));
}

test('popup: layout and the PDFs linked from a page', async () => {
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/`);
  const [newTab] = await Promise.all([
    env.context.waitForEvent('page'),
    withPopup(page, async (popup) => {
      const size = await popup.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
      assert.equal(size.w, 293);
      assert.ok(size.h <= 510, `popup is ${size.h}px tall`);
      assert.equal(await popup.textContent('.ctx-title'), '10 PDFs on this page');
      assert.equal(await popup.locator('.ctx-item').count(), 3);
      assert.equal(await popup.textContent('.ctx-more'), 'and 7 more');
      assert.deepEqual(await popup.locator('.row strong').allTextContents(), ['Convert', 'Edit', 'E-Sign']);
      assert.ok(await popup.isChecked('#toggle-web'));
      await popup.click('.ctx-item >> nth=0');
    }),
  ]);
  await newTab.waitForURL((u) => u.href.startsWith(viewer()));
  assert.equal(new URL(newTab.url()).searchParams.get('file'), `${env.fixtures.origin}/doc.pdf`);
  await waitForViewerReady(newTab);
  await newTab.close();
  await page.close();
});

test('popup: a PDF shown by Chrome’s viewer opens in PdfCraft in the same tab', async () => {
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/doc.pdf`).catch(() => {});
  await page.waitForURL((u) => u.href.startsWith(viewer()));
  await waitForViewerReady(page);
  await page.click('#btn-more');
  await page.click('#menu-native');
  await page.waitForURL(`${env.fixtures.origin}/doc.pdf`);
  await withPopup(page, async (popup) => {
    assert.equal(await popup.textContent('.ctx-title'), 'This tab shows a PDF');
    assert.equal(await popup.textContent('.ctx-detail'), 'doc.pdf');
    await popup.click('#btn-open-this');
  });
  await page.waitForURL((u) => u.href.startsWith(viewer()));
  await waitForViewerReady(page);
  await page.close();
});

test('popup: a workspace row without a PDF asks for a file, in that workspace', async () => {
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/embed.html`);
  const [landing] = await Promise.all([env.context.waitForEvent('page'), withPopup(page, (popup) => popup.click('.row[data-mode="edit"]'))]);
  await landing.waitForURL(`${viewer()}?mode=edit`);
  await landing.waitForSelector('#btn-pick:visible');
  assert.equal(await landing.textContent('#status-title'), 'Choose a PDF to edit');
  // Only the landing's own controls: no error icon, no retry or Chrome-viewer buttons.
  for (const hidden of ['#status-icon', '#btn-retry', '#btn-native', '#status-spinner']) assert.ok(await landing.isHidden(hidden), hidden);
  assert.ok(await landing.isVisible('#btn-continue'));
  assert.equal((await pdfcraftSettings(landing)).default_mode, 'edit');

  // Choosing a file opens it.
  const dir = mkdtempSync(join(tmpdir(), 'pdfcraft-pick-'));
  const file = join(dir, 'Picked file.pdf');
  writeFileSync(file, makePdf({ pages: 2, title: 'Picked' }));
  await landing.setInputFiles('#file-input', file);
  await landing.waitForSelector('#status', { state: 'hidden' });
  assert.equal(await landing.textContent('#doc-name'), 'Picked file.pdf');
  assert.match(await landing.textContent("#doc-meta"), /^Local file · \d+ B$/);
  rmSync(dir, { recursive: true, force: true });
  await landing.close();
  await page.close();
});

test('popup: a workspace row on a PDF tab opens that PDF in the workspace; the user’s default comes back', async () => {
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/doc.pdf`).catch(() => {});
  await page.waitForURL((u) => u.href.startsWith(viewer()));
  await waitForViewerReady(page);
  await withPopup(page, async (popup) => {
    assert.equal(await popup.textContent('.ctx-title'), 'This PDF is open in PdfCraft');
    assert.match(await popup.textContent('.ctx-detail'), /^doc.pdf · /);
  });
  const [signTab] = await Promise.all([env.context.waitForEvent('page'), withPopup(page, (popup) => popup.click('.row[data-mode="sign"]'))]);
  await signTab.waitForURL((u) => u.href.startsWith(`${viewer()}?mode=sign&file=`));
  await waitForViewerReady(signTab);
  assert.equal((await pdfcraftSettings(signTab)).default_mode, 'sign');
  if (process.env.PDFCRAFT_SCREENSHOTS) await signTab.screenshot({ path: join(process.env.PDFCRAFT_SCREENSHOTS, 'pdfcraft-workspace-sign.png') });
  await signTab.close();

  // The next viewer without a workspace puts the earlier default (here: none, so PdfCraft's) back.
  const plain = await env.context.newPage();
  await plain.goto(viewer());
  await plain.waitForSelector('#btn-pick:visible');
  assert.notEqual((await pdfcraftSettings(plain))?.default_mode, 'sign');
  assert.equal(await plain.evaluate(() => localStorage.getItem('pdfcraftForChrome.mode')), null);
  await plain.close();
  await page.close();
});

test('the file chooser page: "Continue to PdfCraft" shows PdfCraft’s home', async () => {
  const page = await env.context.newPage();
  await page.goto(viewer());
  assert.equal(await page.textContent('#status-title'), 'Open a PDF in PdfCraft');
  await page.click('#btn-continue');
  await waitForViewerReady(page);
  await page.close();
});

/** The frame showing the embedded PDF (Chrome's viewer), once the content script has run in it. */
async function pdfFrame(page) {
  for (let i = 0; i < 100; i++) {
    const frame = page.frames().find((f) => f !== page.mainFrame() && f.url() === `${env.fixtures.origin}/doc.pdf`);
    if (frame) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error('no PDF frame');
}

test('embedded PDFs get an "Open in PdfCraft" button', async () => {
  for (const path of ['/embed.html', '/iframe.html', '/object.html']) {
    const page = await env.context.newPage();
    await page.goto(env.fixtures.origin + path);
    const frame = await pdfFrame(page);
    const host = frame.locator('pdfcraft-embedded-button');
    await host.waitFor({ state: 'attached', timeout: 15_000 });
    const box = await host.boundingBox();
    const pdf = await page.locator('#pdf').boundingBox();
    // Bottom right of the embedded document.
    assert.ok(box.x + box.width <= pdf.x + pdf.width && box.x > pdf.x + pdf.width / 2, `${path}: x ${box.x}`);
    assert.ok(box.y + box.height <= pdf.y + pdf.height && box.y > pdf.y + pdf.height / 2, `${path}: y ${box.y}`);
    if (process.env.PDFCRAFT_SCREENSHOTS && path === '/embed.html') {
      await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(process.env.PDFCRAFT_SCREENSHOTS, 'pdfcraft-embedded-hover.png') });
    }
    const [tab] = await Promise.all([env.context.waitForEvent('page'), page.mouse.click(box.x + box.width - 20, box.y + box.height / 2)]);
    await tab.waitForURL((u) => u.href.startsWith(viewer()));
    assert.equal(new URL(tab.url()).searchParams.get('file'), `${env.fixtures.origin}/doc.pdf`);
    await waitForViewerReady(tab);
    await tab.close();
    await page.close();
  }
});

test('the embedded-PDF button can be turned off', async () => {
  await env.worker.evaluate(() => chrome.storage.local.set({ settings: { embeddedButton: false } }));
  const page = await env.context.newPage();
  await page.goto(`${env.fixtures.origin}/embed.html`);
  const frame = await pdfFrame(page);
  await page.waitForTimeout(1500);
  assert.equal(await frame.locator('pdfcraft-embedded-button').count(), 0);
  await page.close();
  await env.worker.evaluate(() => chrome.storage.local.set({ settings: {} }));
});

test('offline: PdfCraft still starts; web documents explain why they can’t load', async () => {
  const page = await env.context.newPage();
  await env.context.setOffline(true);
  try {
    await page.goto(`${viewer()}?file=${encodeURIComponent(`${env.fixtures.origin}/doc.pdf`)}`);
    await page.waitForSelector('#status.is-error');
    assert.equal(await page.textContent('#status-title'), "You're offline");
    assert.ok(await page.isVisible('#status-icon'));
    await page.goto(viewer());
    await page.click('#btn-continue');
    await waitForViewerReady(page);
  } finally {
    await env.context.setOffline(false);
    await page.close();
  }
});

test('context menu items are registered (clicking them needs a person: see docs/testing.md)', async () => {
  // contextMenus.update rejects for an id that doesn't exist.
  const ids = ['pdfcraft-open-link', 'pdfcraft-open-frame', 'pdfcraft-open-page'];
  const results = await env.worker.evaluate(
    (list) => Promise.all(list.map((id) => chrome.contextMenus.update(id, {}).then(() => 'ok', (e) => e.message))),
    ids,
  );
  assert.deepEqual(results, ['ok', 'ok', 'ok']);
  const missing = await env.worker.evaluate(() => chrome.contextMenus.update('no-such-item', {}).then(() => 'ok', () => 'rejected'));
  assert.equal(missing, 'rejected');
});

// Last: allowing file access reloads the extension.
test('local file:// PDFs open in PdfCraft once file access is allowed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdfcraft-local-'));
  const file = join(dir, 'Local report.pdf');
  writeFileSync(file, makePdf({ pages: 4, title: 'Local' }));
  const fileUrl = pathToFileURL(file).href;

  // Allowing file access reloads the extension. Playwright reports no new worker for that, so
  // wait for Chrome to report the access as active, then give the reload time to finish.
  const settingsPage = await env.context.newPage();
  await settingsPage.goto('chrome://extensions');
  await settingsPage.evaluate((id) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, fileAccess: true }), env.extensionId);
  await settingsPage.waitForFunction(
    (id) => chrome.developerPrivate.getExtensionInfo(id).then((e) => e.fileAccess.isActive && e.state === 'ENABLED'),
    env.extensionId,
  );
  await settingsPage.waitForTimeout(3000);
  await settingsPage.close();

  const page = await env.context.newPage();
  await page.goto(fileUrl).catch(() => {}); // aborted by the redirect
  // Playwright's waitForURL can miss a redirect that replaced an aborted goto(), so poll.
  for (let i = 0; i < 150 && !page.url().startsWith(viewer()); i++) await page.waitForTimeout(100);
  assert.ok(page.url().startsWith(viewer()), `not redirected: ${page.url()}`);
  await waitForViewerReady(page);
  assert.equal(await page.textContent('#doc-name'), 'Local report.pdf');
  assert.match(await page.textContent('#doc-meta'), /^Local file · /);
  await page.close();
  rmSync(dir, { recursive: true, force: true });
});
