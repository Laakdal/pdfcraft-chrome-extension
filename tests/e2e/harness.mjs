// Launches Chromium with the built extension (dist/pdfcraft-chrome) and the fixture server.
//
// Branded Google Chrome ignores --load-extension (since Chrome 137), so the tests use a Chromium
// build: PDFCRAFT_CHROMIUM, or Playwright's cached Chromium (npx playwright install chromium).

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startFixtureServer } from '../fixtures/server.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const extensionDir = join(root, 'dist', 'pdfcraft-chrome');

export function findChromium() {
  if (process.env.PDFCRAFT_CHROMIUM) return process.env.PDFCRAFT_CHROMIUM;
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright')
      : process.platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'ms-playwright')
        : join(homedir(), '.cache', 'ms-playwright'));
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const build of builds) {
    for (const exe of ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const path = join(cache, build, exe);
      if (existsSync(path)) return path;
    }
  }
  throw new Error('No Chromium found: set PDFCRAFT_CHROMIUM or run `npx playwright install chromium`');
}

/** Starts Chromium with the extension. `headless` defaults to PDFCRAFT_HEADED !== "1". */
export async function launch({ headless = process.env.PDFCRAFT_HEADED !== '1', offline = false, cdpPort = null } = {}) {
  if (!existsSync(join(extensionDir, 'manifest.json'))) throw new Error('dist/pdfcraft-chrome is missing: run `npm run build` first');
  const fixtures = await startFixtureServer();
  const profile = mkdtempSync(join(tmpdir(), 'pdfcraft-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: findChromium(),
    headless,
    offline,
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;
  const base = `chrome-extension://${extensionId}/`;
  // The rules are installed from onInstalled; wait until they are there. Playwright can attach to
  // the worker before its global scope (chrome.*, even setTimeout) is set up, so poll from here.
  for (let i = 0; ; i++) {
    const count = await worker.evaluate(async () => (await globalThis.chrome?.declarativeNetRequest?.getDynamicRules())?.length ?? 0).catch(() => 0);
    if (count > 0) break;
    if (i > 200) throw new Error('the redirect rules never appeared');
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    context,
    worker,
    extensionId,
    base,
    fixtures,
    cdpEndpoint: cdpPort ? `http://127.0.0.1:${cdpPort}` : null,
    async close() {
      await context.close().catch(() => {});
      await fixtures.close();
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

/** Waits until the viewer in `page` has PdfCraft running and the status overlay is gone. */
export async function waitForViewerReady(page, { timeout = 90_000 } = {}) {
  await page.waitForFunction(() => document.documentElement.dataset.pdfcraftVersion !== undefined, null, { timeout });
  await page.waitForSelector('#status', { state: 'hidden', timeout });
}

/**
 * Opens the toolbar popup for the active tab and returns a Playwright page for it. Playwright
 * doesn't list extension popups, so this connects a second client over CDP (needs `cdpPort`).
 */
export async function openPopup(env) {
  if (!env.cdpEndpoint) throw new Error('launch({ cdpPort }) is needed to reach the popup');
  await env.worker.evaluate(() => chrome.action.openPopup());
  const browser = await chromium.connectOverCDP(env.cdpEndpoint);
  for (let i = 0; i < 50; i++) {
    for (const context of browser.contexts()) {
      const popup = context.pages().find((p) => p.url() === `${env.base}popup/popup.html`);
      if (popup) {
        await popup.waitForLoadState('domcontentloaded');
        return { popup, disconnect: () => browser.close() };
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await browser.close();
  throw new Error('the popup did not open');
}
