// Smoke test in branded Google Chrome, which ignores --load-extension: installs the built
// extension through the DevTools Extensions.loadUnpacked command (puppeteer's enableExtensions,
// needs a debugging pipe), in a throwaway profile, then checks the main flows.
//
//   PDFCRAFT_CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" node tests/e2e/chrome-smoke.mjs

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { startFixtureServer } from '../fixtures/server.mjs';
import { root as project } from './harness.mjs';

const chrome =
  process.env.PDFCRAFT_CHROME ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');
const ext = join(project, 'dist', 'pdfcraft-chrome');
const fixtures = await startFixtureServer();
const profile = mkdtempSync(join(tmpdir(), 'pdfcraft-chrome155-'));
const browser = await puppeteer.launch({
  executablePath: chrome,
  userDataDir: profile, headless: true, pipe: true, enableExtensions: [ext],
  args: ['--no-first-run', '--no-default-browser-check'],
});
const result = { version: await browser.version() };
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/service-worker.js'), { timeout: 30000 });
  result.extensionId = new URL(swTarget.url()).host;
  const base = `chrome-extension://${result.extensionId}/`;
  const worker = await swTarget.worker();
  for (let i = 0; i < 100; i++) {
    const n = await worker.evaluate(async () => (await globalThis.chrome?.declarativeNetRequest?.getDynamicRules())?.length ?? 0).catch(() => 0);
    if (n) { result.rules = n; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  const page = await browser.newPage();
  await page.goto(`${fixtures.origin}/doc.pdf`).catch((e) => (result.gotoNote = e.message.split('\n')[0]));
  for (let i = 0; i < 100 && !page.url().startsWith(base); i++) await new Promise((r) => setTimeout(r, 100));
  result.redirectedTo = page.url();
  result.source = await page.waitForFunction(() => history.state?.pdfcraftSource?.url, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => null);
  await page.waitForFunction(() => document.documentElement.dataset.pdfcraftVersion !== undefined, { timeout: 90000 });
  await page.waitForSelector('#status', { hidden: true, timeout: 90000 });
  result.pdfcraftVersion = await page.evaluate(() => document.documentElement.dataset.pdfcraftVersion);
  result.title = await page.title();
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: join(project, 'docs/investigation/screenshots/pdfcraft-13-chrome155-viewer.png') });

  const site = await browser.newPage();
  await site.goto(`${fixtures.origin}/`);
  await site.bringToFront();
  result.openPopup = await worker.evaluate(() => chrome.action.openPopup().then(() => 'ok', (e) => e.message));
  const popupTarget = await browser.waitForTarget((t) => t.url() === `${base}popup/popup.html`, { timeout: 10000 }).catch(() => null);
  if (popupTarget) {
    const popup = await popupTarget.asPage();
    await new Promise((r) => setTimeout(r, 1000));
    result.popup = await popup.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, ctx: document.querySelector('.ctx-title')?.textContent }));
    await popup.screenshot({ path: join(project, 'docs/investigation/screenshots/pdfcraft-14-chrome155-popup.png') });
  }
  const embed = await browser.newPage();
  await embed.goto(`${fixtures.origin}/embed.html`);
  await new Promise((r) => setTimeout(r, 3000));
  const frame = embed.frames().find((f) => f.url().endsWith('/doc.pdf'));
  result.embeddedButton = frame ? await frame.evaluate(() => !!document.querySelector('pdfcraft-embedded-button')) : 'no pdf frame';
} catch (e) {
  result.error = e.message.split('\n')[0];
} finally {
  console.log(JSON.stringify(result, null, 2));
  const ok = result.pdfcraftVersion && result.redirectedTo?.includes('/pdfcraft.html') && result.source === `${fixtures.origin}/doc.pdf` && result.popup?.w === 293 && result.embeddedButton === true;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
  await browser.close();
  await fixtures.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
