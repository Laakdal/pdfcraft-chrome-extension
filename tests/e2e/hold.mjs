// Starts Chromium with the extension and the fixtures and keeps it running, for manual testing
// or for inspection with REA / DevTools over CDP:  node tests/e2e/hold.mjs [seconds] [cdpPort]
import { launch } from './harness.mjs';

const seconds = Number(process.argv[2] ?? 600);
const cdpPort = Number(process.argv[3] ?? 9555);
const env = await launch({ cdpPort, headless: process.env.PDFCRAFT_HEADED !== '1' });
const page = await env.context.newPage();
await page.goto(`${env.fixtures.origin}/embed.html`);
const viewer = await env.context.newPage();
await viewer.goto(`${env.fixtures.origin}/doc.pdf`).catch(() => {});
console.log(JSON.stringify({ cdp: env.cdpEndpoint, fixtures: env.fixtures.origin, extensionId: env.extensionId }));
await new Promise((r) => setTimeout(r, seconds * 1000));
await env.close();
