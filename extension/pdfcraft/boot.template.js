// Starts the bundled PdfCraft web build. This replaces the inline <script type="module"> that
// trunk writes into PdfCraft's index.html: Manifest V3 extension pages allow only scripts loaded
// from the extension itself. The statements are the same as trunk's. scripts/build.mjs fills in
// the content-hashed file names of the release being bundled.

import init, * as bindings from './__PDFCRAFT_JS__';

const wasm = await init({ module_or_path: './__PDFCRAFT_WASM__' });
window.wasmBindings = bindings;
dispatchEvent(new CustomEvent('TrunkApplicationStarted', { detail: { wasm } }));
