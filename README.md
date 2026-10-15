# PdfCraft for Chrome

A standalone Chrome extension (Manifest V3) that opens PDFs from the web in
[PdfCraft](https://github.com/storytold/pdfcraft), the free, offline PDF editor. It works like
Adobe Acrobat's Chrome extension: PDF links open in an editor tab, the toolbar popup offers
Convert / Edit / E-Sign, and embedded PDFs get an "Open in PdfCraft" button. Everything runs
locally in Chrome. Nothing else to install, no local server, no account; documents are never
uploaded.

The extension bundles PdfCraft's **official, unmodified web build** (release 0.8.0, SHA-256
verified) and adds the browser integration around it.

## Install

1. Build it (see below), or use an existing `dist/pdfcraft-chrome` folder.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose
   `dist/pdfcraft-chrome`.
3. Pin PdfCraft to the toolbar (puzzle-piece menu → pin).
4. Optional, for PDFs on your computer (`file://`): on PdfCraft's **Details** page, turn on
   **Allow access to file URLs**.

## Use

- **Open a PDF link** or type a PDF's address: it opens in PdfCraft. The **⋮** menu has
  *Open in Chrome's PDF viewer* when you want Chrome's viewer for that document.
- **Toolbar popup**:
  - **Select a file** opens a local PDF.
  - The middle card shows this tab's PDF, or the PDFs linked on the page.
  - **Convert**, **Edit** and **E-Sign** open the PDF in that PdfCraft workspace.
  - The switch at the bottom turns PDF opening on or off.
- **Embedded PDFs**: hover the round PdfCraft button at the bottom right of the PDF.
- **Right-click** a link → *Open link in PdfCraft*.
- **Saving**: PdfCraft's Save and Save As go to your downloads, and *Download* in the top bar
  saves the original file. Exports, splits and prints come from PdfCraft itself.
- **Settings**: the gear in the popup, or the extension's *Extension options*.

## Build from source

Requirements: Node.js 20+ and npm. No Rust toolchain is needed, because PdfCraft's prebuilt web
release is used.

```sh
npm install              # playwright-core and puppeteer-core, for tests only
npm run fetch-pdfcraft   # downloads pdfcraft-web-0.8.0.zip from GitHub, checks SHA-256, unpacks to vendor/
npm run build            # → dist/pdfcraft-chrome (about 37 MB, mostly PdfCraft's wasm)
npm test                 # unit tests
npm run test:e2e         # end-to-end tests in Chromium (see docs/testing.md)
npm run test:chrome      # smoke test in your installed Google Chrome (throwaway profile)
```

`vendor/pdfcraft-web-0.8.0/` is already present in this folder, so `fetch-pdfcraft` skips the
download unless you pass `--force`. Other scripts:
- `node scripts/capture-screenshots.mjs` re-creates the PdfCraft screenshots in
  `docs/investigation/screenshots`.
- `node scripts/make-icon-sprite.mjs <pdfcraft-src>/assets/icons` rebuilds the Lucide icon sprite.

## How it works

```
PDF navigation ─► declarativeNetRequest rule (Content-Type: application/pdf) ─┐
file:// PDF ────► service worker (webNavigation) ─────────────────────────────┤
context menu, toolbar popup, embedded-PDF button ─► service worker ───────────┼─► viewer/viewer.html
                                                                               │   fetches the PDF (your cookies, no CORS),
                                                                               │   checks it, shows errors, saves downloads
                                                                               └─► <iframe> pdfcraft/index.html?host=parent
                                                                                    PdfCraft 0.8.0 web build (wasm), unmodified,
                                                                                    driven by its postMessage bridge
```

| Path | What |
|---|---|
| `extension/manifest.json` | MV3 manifest |
| `extension/service-worker.js` | Redirect rules, local files, "open in Chrome's viewer" bypass, context menus, messages |
| `extension/lib/` | `pdf.js` (URLs, detection, file names), `rules.js` (DNR rules), `settings.js`, `workspace.js` (opening a PdfCraft workspace) |
| `extension/viewer/` | The PdfCraft tab: top bar, download, errors, file chooser, PdfCraft bridge |
| `extension/popup/` | Toolbar popup |
| `extension/options/` | Settings page |
| `extension/content/embedded-pdf.js` | "Open in PdfCraft" button inside embedded PDF frames |
| `extension/pdfcraft/` | `index.html` and `boot.template.js`: PdfCraft's page with its inline loader moved out (MV3 CSP). The build adds PdfCraft's js, wasm and licences |
| `extension/ui/` | Design tokens (PdfCraft's palette), i18n, theme (follows PdfCraft's theme setting) |
| `extension/_locales/en/messages.json` | All UI text |
| `extension/icons/` | PdfCraft app icon (MIT/Apache) and Lucide sprite (ISC) |
| `extension/licenses/` | Third-party licence texts |
| `scripts/` | `fetch-pdfcraft.mjs`, `build.mjs`, `capture-screenshots.mjs`, `make-icon-sprite.mjs` |
| `tests/` | `unit/` (node:test), `e2e/` (Playwright + Chromium), `fixtures/` (PDF generator and test server) |
| `vendor/pdfcraft-web-0.8.0/` | PdfCraft's release, as downloaded |
| `docs/` | Investigation, design and test reports (below) |

## Permissions and privacy

| Permission | Why |
|---|---|
| Access to all sites | Redirect PDF responses to PdfCraft and download them for you (with your cookies) from any site |
| `declarativeNetRequestWithHostAccess` | The PDF redirect rules |
| `webNavigation` | Local `file://` PDFs, and ending the one-time "open in Chrome's viewer" bypass |
| `contextMenus` | *Open link / frame / this PDF in PdfCraft* |
| `downloads` | Saving PdfCraft's Save / Save As and the original file |
| `storage` | Extension settings |
| `scripting`, `activeTab` | The popup lists the PDFs linked on the current page |

No data leaves the computer except the request for the PDF you open. PdfCraft keeps its own
settings in the extension's local storage, including saved signatures and initials if you create
them.

## Documentation

1. [REA readiness and capability report](docs/investigation/01-rea-readiness.md)
2. [PdfCraft architecture assessment](docs/investigation/02-pdfcraft-architecture.md)
3. [Design, feature mapping, architecture, UI comparison, evidence index](docs/investigation/05-design-and-comparison.md)
4. [Testing and results](docs/testing.md)
5. Screenshots: `docs/investigation/screenshots/`

The Adobe extension investigation (reports 03 and 04, and the Adobe reference screenshots) is kept
private and isn't published in this repository; report 05 summarises its findings.

## Known limitations

- **The PDF is downloaded twice.** Chrome reserves PDF handling for allowlisted extensions, so
  the tab's own request and the viewer's request both fetch it. Single-use download links can
  therefore fail; use *Open in Chrome's PDF viewer*. PDFs produced by a form POST stay in Chrome.
- **Workspaces, not tools.** PdfCraft 0.8.0 lets a host open documents and receive saves, nothing
  else. Popup rows preselect a workspace through PdfCraft's saved `default_mode` setting, and the
  user's own choice is restored on the next start.
- **PdfCraft web-build gaps** (upstream): no OCR models; certificate signing fails; adding or
  replacing images and importing form data aren't available on the web yet; WebGL 2 is required.
- **Two bars.** PdfCraft's UI is shown unmodified below the extension's own bar. PdfCraft's Home
  and About screens show the ArtCraft community mark, which is part of the unmodified upstream
  build. The extension's name, icon and pages don't use it.
- **Not built** (Adobe cloud features): AI assistant, PDF Spaces, sharing, accounts, side panel,
  webpage-to-PDF conversion, Gmail/Drive/Outlook integrations, the onboarding tour.
- **Testing:** the full suite runs in Chromium 139 (headless); Google Chrome 155 passed a smoke test
  (redirect, viewer, popup, embedded button). Physical toolbar and context-menu clicks, printing
  and cookie-protected PDFs are manual checks: see docs/testing.md.

## Remaining work

- Upstream a small PdfCraft change (about 15 lines in `apps/pdfcraft-web/src/main.rs`): pass
  whitelisted query parameters (`tool`, `mode`, `panel`) to the existing `set_option`. Popup
  items could then open individual tools such as Compress, Organize or Redact. A local rebuild
  instead would make the bundled build a modified version, which must drop the ArtCraft marks.
- Hand the tab's response to the viewer instead of fetching twice, if Chrome ever opens a
  supported API for it.
- Onboarding page, first-run coachmark for the embedded button, more locales.

## Licence

MIT OR Apache-2.0, like PdfCraft. See `NOTICE` for bundled third-party material. PdfCraft for
Chrome is not affiliated with Adobe; "Adobe" and "Acrobat" are Adobe's trademarks.
