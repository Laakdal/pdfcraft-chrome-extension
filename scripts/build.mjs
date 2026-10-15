// Builds the unpacked extension into dist/pdfcraft-chrome/ (load it from chrome://extensions →
// Developer mode → Load unpacked).
//
// The extension sources in extension/ are copied as they are. PdfCraft's official web build
// (vendor/pdfcraft-web-<version>/, fetched by scripts/fetch-pdfcraft.mjs) goes into pdfcraft/
// unmodified; only its loader script is regenerated as pdfcraft/boot.js (see boot.template.js).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFCRAFT_VERSION } from './fetch-pdfcraft.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'extension');
const vendor = join(root, 'vendor', `pdfcraft-web-${PDFCRAFT_VERSION}`);
const out = join(root, 'dist', 'pdfcraft-chrome');

/** Source files that are build inputs, not extension files. */
const SKIP = new Set(['pdfcraft/boot.template.js']);
const SKIP_DIRS = new Set(['icons/source']);

export function build() {
  if (!existsSync(join(vendor, 'index.html'))) {
    throw new Error(`vendor/pdfcraft-web-${PDFCRAFT_VERSION} is missing: run \`npm run fetch-pdfcraft\` first`);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  cpSync(source, out, {
    recursive: true,
    filter: (path) => {
      const rel = relative(source, path).replaceAll('\\', '/');
      return !SKIP.has(rel) && !SKIP_DIRS.has(rel);
    },
  });

  // PdfCraft: the wasm-bindgen glue and the wasm module named in the release's index.html.
  const index = readFileSync(join(vendor, 'index.html'), 'utf8');
  const js = /from '\.\/(pdfcraft-web-[0-9a-f]+\.js)'/.exec(index)?.[1];
  const wasm = /module_or_path: '\.\/(pdfcraft-web-[0-9a-f]+_bg\.wasm)'/.exec(index)?.[1];
  if (!js || !wasm) throw new Error('could not find the PdfCraft loader file names in the release index.html');
  const pdfcraftOut = join(out, 'pdfcraft');
  for (const file of [js, wasm, 'LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE']) {
    cpSync(join(vendor, file), join(pdfcraftOut, file));
  }
  const boot = readFileSync(join(source, 'pdfcraft', 'boot.template.js'), 'utf8')
    .replace('__PDFCRAFT_JS__', js)
    .replace('__PDFCRAFT_WASM__', wasm);
  writeFileSync(join(pdfcraftOut, 'boot.js'), boot);

  // Licence texts at the root of the package as well (MIT OR Apache-2.0, same as PdfCraft).
  for (const file of ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE']) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(out, file));
  }

  const size = du(out);
  console.log(`built ${relative(root, out)} (${(size / 1024 / 1024).toFixed(1)} MB, PdfCraft ${PDFCRAFT_VERSION}: ${js}, ${wasm})`);
  return out;
}

function du(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + du(join(path, name)), 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    build();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
