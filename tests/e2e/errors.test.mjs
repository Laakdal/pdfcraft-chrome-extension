// End-to-end: no errors. Exercises the main flows, collecting console errors and uncaught
// exceptions from the service worker and every extension page (verified to catch a deliberate
// console.error and throw in both). Chrome's own error list (chrome://extensions, developer mode)
// is checked too, but it did not record a deliberate test error, so treat it as secondary.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch, openPopup, waitForViewerReady } from './harness.mjs';

let env;
let manager;
const consoleErrors = [];

before(async () => {
  env = await launch({ cdpPort: 9800 + Math.floor(Math.random() * 100) });
  manager = await env.context.newPage();
  await manager.goto('chrome://extensions');
  await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  env.worker.on('console', (m) => m.type() === 'error' && consoleErrors.push(`worker: ${m.text()}`));
  env.context.on('page', (page) => {
    page.on('console', (m) => {
      if (m.type() === 'error' && page.url().startsWith(env.base)) consoleErrors.push(`${page.url()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  });
});
after(async () => {
  await env?.close();
});

test('main flows leave no extension errors or console errors', async () => {
  const { origin } = env.fixtures;
  const viewer = `${env.base}viewer/viewer.html`;
  for (const path of ['/doc.pdf', '/redirect.pdf', '/no-extension', '/large.pdf']) {
    const page = await env.context.newPage();
    await page.goto(origin + path).catch(() => {});
    await page.waitForURL((u) => u.href.startsWith(viewer));
    await waitForViewerReady(page, { timeout: 120_000 });
    await page.close();
  }
  const site = await env.context.newPage();
  await site.goto(`${origin}/embed.html`);
  await site.waitForTimeout(2000);
  await site.bringToFront();
  const { popup, disconnect } = await openPopup(env);
  await popup.waitForTimeout(800);
  await popup.evaluate(() => window.close()).catch(() => {});
  await disconnect();
  const landing = await env.context.newPage();
  await landing.goto(`${viewer}?mode=convert`);
  await landing.click('#btn-continue');
  await waitForViewerReady(landing);
  const options = await env.context.newPage();
  await options.goto(`${env.base}options/options.html`);
  await options.waitForTimeout(500);

  const info = await manager.evaluate((id) => chrome.developerPrivate.getExtensionInfo(id), env.extensionId);
  assert.deepEqual(info.manifestErrors.map((e) => e.message), []);
  assert.deepEqual(info.runtimeErrors.map((e) => `${e.source}: ${e.message}`), []);
  assert.deepEqual(info.installWarnings, []);
  assert.deepEqual(consoleErrors, []);
});
