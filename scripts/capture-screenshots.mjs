// Captures the PdfCraft extension's UI states for docs/investigation (the comparison with the
// Acrobat extension). Needs a build: `npm run build && node scripts/capture-screenshots.mjs`.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openPopup, root, waitForViewerReady } from '../tests/e2e/harness.mjs';

const out = join(root, 'docs', 'investigation', 'screenshots');
mkdirSync(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: join(out, `pdfcraft-${name}.png`) });

const env = await launch({ cdpPort: 9300 + Math.floor(Math.random() * 90) });
try {
  const { origin } = env.fixtures;
  const viewer = `${env.base}pdfcraft.html`;

  // Viewer with a web PDF (redirected from the address bar).
  const page = await env.context.newPage();
  await page.goto(`${origin}/doc.pdf`).catch(() => {});
  await page.waitForURL((u) => u.href.startsWith(viewer));
  await waitForViewerReady(page);
  await page.waitForTimeout(1500);
  await shot(page, '01-viewer-direct-pdf');
  await page.click('#btn-more');
  await shot(page, '02-viewer-more-menu');
  await page.keyboard.press('Escape');

  // Toolbar popup: on a web page with PDF links, then on a PDF tab (our viewer).
  const site = await env.context.newPage();
  await site.goto(`${origin}/`);
  await site.bringToFront();
  let { popup, disconnect } = await openPopup(env);
  await popup.waitForTimeout(600);
  await shot(popup, '03-popup-on-web-page');
  await disconnect();
  await page.bringToFront();
  ({ popup, disconnect } = await openPopup(env));
  await popup.waitForTimeout(600);
  await shot(popup, '04-popup-on-pdf-tab');
  await disconnect();

  // File chooser page (popup "Select a file", or a workspace row with no PDF in the tab).
  const landing = await env.context.newPage();
  await landing.goto(`${viewer}?mode=edit`);
  await landing.waitForSelector('#btn-pick:visible');
  await shot(landing, '05-select-a-file-edit');

  // Workspace rows: the same PDF opened in Convert and in E-Sign.
  for (const mode of ['convert', 'sign']) {
    const tab = await env.context.newPage();
    await tab.goto(`${viewer}?mode=${mode}&file=${encodeURIComponent(`${origin}/doc.pdf`)}`);
    await waitForViewerReady(tab);
    await tab.waitForTimeout(1500);
    await shot(tab, `06-workspace-${mode}`);
    await tab.close();
  }

  // Embedded PDF button.
  const embed = await env.context.newPage();
  await embed.goto(`${origin}/embed.html`);
  await embed.waitForTimeout(2500);
  const frame = embed.frames().find((f) => f.url() === `${origin}/doc.pdf`);
  const box = await frame.locator('pdfcraft-embedded-button').boundingBox();
  await embed.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
  await embed.waitForTimeout(400);
  await shot(embed, '07-embedded-button-hover');

  // Errors and states.
  const states = [
    ['08-error-not-a-pdf', `${origin}/malformed.pdf`],
    ['09-error-404', `${viewer}?file=${encodeURIComponent(`${origin}/gone.pdf`)}`],
    ['10-error-401', `${viewer}?file=${encodeURIComponent(`${origin}/protected.pdf`)}`],
  ];
  for (const [name, url] of states) {
    const tab = await env.context.newPage();
    await tab.goto(url).catch(() => {});
    await tab.waitForSelector('#status.is-error');
    await shot(tab, name);
    await tab.close();
  }
  const offline = await env.context.newPage();
  await env.context.setOffline(true);
  await offline.goto(`${viewer}?file=${encodeURIComponent(`${origin}/doc.pdf`)}`);
  await offline.waitForSelector('#status.is-error');
  await shot(offline, '11-error-offline');
  await env.context.setOffline(false);

  const options = await env.context.newPage();
  await options.goto(`${env.base}options/options.html`);
  await options.waitForTimeout(500);
  await options.screenshot({ path: join(out, 'pdfcraft-12-settings.png'), fullPage: true });

  // PdfCraft's own saved theme value, which the extension's pages follow (ui/theme.js).
  await page.bringToFront();
  await page.waitForTimeout(32_000); // eframe saves about every 30 s
  console.log('PdfCraft theme setting:', await page.evaluate(() => JSON.parse(localStorage.getItem('pdfcraft') ?? 'null')?.theme));
  console.log(`screenshots in ${out}`);
} finally {
  await env.close();
}
