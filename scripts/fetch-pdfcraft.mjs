// Downloads the official PdfCraft web build from the GitHub release, checks it against the
// pinned SHA-256 (the same value the release's SHA256SUMS.txt lists) and unpacks it into
// vendor/. The extension bundles this build unmodified; see scripts/build.mjs.
//
//   node scripts/fetch-pdfcraft.mjs            (skips the download when vendor/ is already there)
//   node scripts/fetch-pdfcraft.mjs --force

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PDFCRAFT_VERSION = '0.8.0';
const SHA256 = '1f9ea51f3c1f71cc719c12814e10f236912fa41ef54a7782c7dd4a619d9eee9a';
const URL = `https://github.com/storytold/pdfcraft/releases/download/v${PDFCRAFT_VERSION}/pdfcraft-web-${PDFCRAFT_VERSION}.zip`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'vendor');
const target = join(vendor, `pdfcraft-web-${PDFCRAFT_VERSION}`);

async function main() {
  const force = process.argv.includes('--force');
  if (existsSync(join(target, 'index.html')) && !force) {
    console.log(`vendor/pdfcraft-web-${PDFCRAFT_VERSION} is present (use --force to download again)`);
    return;
  }
  console.log(`downloading ${URL}`);
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== SHA256) throw new Error(`checksum mismatch: expected ${SHA256}, got ${digest}`);

  mkdirSync(vendor, { recursive: true });
  const zip = join(vendor, `pdfcraft-web-${PDFCRAFT_VERSION}.zip`);
  writeFileSync(zip, bytes);
  rmSync(target, { recursive: true, force: true });
  // unzip where available (Git Bash, Linux, macOS); otherwise Windows' bsdtar, which reads zip files.
  try {
    execFileSync('unzip', ['-q', '-o', zip, '-d', vendor], { stdio: 'inherit' });
  } catch {
    execFileSync('tar', ['-xf', zip, '-C', vendor], { stdio: 'inherit' });
  }
  rmSync(zip);
  if (!existsSync(join(target, 'index.html'))) throw new Error('the archive did not contain the expected folder');
  writeFileSync(join(target, '.sha256'), `${SHA256}  pdfcraft-web-${PDFCRAFT_VERSION}.zip\n`);
  console.log(`unpacked into vendor/pdfcraft-web-${PDFCRAFT_VERSION} (sha256 ${SHA256})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
