# Testing PdfCraft for Chrome

## Commands

```sh
npm install              # dev dependency: playwright-core (drives Chromium; not shipped)
npm run fetch-pdfcraft   # once: download and verify PdfCraft's web build into vendor/
npm run build            # dist/pdfcraft-chrome
npm test                 # unit tests (Node only)
npm run test:e2e         # end-to-end tests in Chromium with the built extension
npm run test:chrome      # smoke test in installed Google Chrome (throwaway profile)
```

The end-to-end tests need a Chromium build: branded Google Chrome ignores `--load-extension`
(since Chrome 137). They use `PDFCRAFT_CHROMIUM` or Playwright's cached Chromium
(`npx playwright install chromium`). Set `PDFCRAFT_HEADED=1` to watch them. If PdfCraft's desktop
app is installed (`C:\Program Files\PdfCraft\pdfcraft-cli.exe`, or `PDFCRAFT_CLI`), saved files
are also checked with `pdfcraft-cli info`.

`node tests/fixtures/server.mjs` serves the fixture site on http://127.0.0.1:8790/ for manual
testing. `node tests/e2e/hold.mjs 600 9555` keeps a Chromium with the extension open, with CDP
on port 9555, for DevTools or REA.

## Results (2026-10-15)

Environment: Windows 11 Pro; Node 22.21.1; Chromium 139.0.7258.5 (Playwright build 1181),
headless (SwiftShader WebGL); playwright-core 1.58.2; Google Chrome 155.0.8059.79 for the smoke
test (puppeteer-core 24.43.1); PdfCraft web build 0.8.0.

**Unit: 22 of 22 passed.** URL handling, PDF detection, filenames, redirect rules, workspace
preselection and theme.

**End-to-end: 32 of 32 passed** in about 45 s. Each row was executed; "Evidence" names the test.

| # | Scenario | Expected | Actual | Result | Evidence (test) |
|---|---|---|---|---|---|
| 1 | Extension loads | Enabled; no manifest errors, install warnings, runtime or console errors across the main flows | As expected | Pass | errors: "main flows leave no extension errors" |
| 2 | Direct PDF URL | Redirected to `viewer.html?file=<url>`; PdfCraft 0.8.0 starts; document opens; title "doc.pdf – PdfCraft" | As expected | Pass | viewer #1 |
| 3 | PDF link, same tab and `target=_blank` | Both open the viewer | As expected | Pass | viewer #2 |
| 4 | 302 redirect to a PDF | Viewer opens the final URL | As expected | Pass | viewer #3 |
| 5 | `application/pdf` without `.pdf` in the path | Viewer | As expected | Pass | viewer #4 |
| 6 | `.pdf` as `application/octet-stream`, default settings | Downloads (as Adobe) | As expected | Pass | viewer #5 |
| 7 | Same, with "Also open mislabelled PDFs" on | Viewer | As expected | Pass | viewer #6 |
| 8 | Query string and fragment | Preserved exactly (`?a=1&b=two#page=2`) | As expected | Pass | viewer #7 |
| 9 | PDF bytes as `text/plain` | Left to Chrome | As expected | Pass | viewer #8 |
| 10 | `Content-Disposition: attachment` | Downloads; no viewer | As expected | Pass | viewer #9 |
| 11 | 404 at a `.pdf` address | The site's own 404 page | As expected | Pass | viewer #10 |
| 12 | Malformed "PDF" (HTML with a PDF content type) | "This isn't a PDF" with icon, Open in Chrome's viewer, Select a file | As expected | Pass | viewer #11 |
| 13 | Viewer fetch gets 404 / 401 | Specific messages, Try again | As expected | Pass | viewer #12 |
| 14 | Unreachable server | "couldn't be reached" | As expected | Pass | viewer #13 |
| 15 | Large PDF (24 MB, 200 pages) | Opens; size shown | As expected | Pass | viewer #14 |
| 16 | Viewer framed by another site | Refuses; PdfCraft not started | As expected | Pass | viewer #15 |
| 17 | "Download" (original) | `chrome.downloads`, blob URL, valid 3-page PDF (`pdfcraft-cli info`: no warnings) | As expected | Pass | viewer #16 |
| 18 | Save in PdfCraft (Ctrl+S in the canvas) | `pdfcraft:save` → download → valid 3-page PDF | As expected | Pass | viewer #17 |
| 19 | "Open in Chrome's PDF viewer" | Same tab shows Chrome's viewer; the next PDF is redirected again | As expected | Pass | viewer #18 |
| 20 | Setting "Open PDFs from the web" off | No redirect | As expected | Pass | viewer #19 |
| 21 | Popup on a page with PDF links | 293 px wide, ≤ 510 px tall; "10 PDFs on this page", 3 listed, "and 7 more"; rows Convert/Edit/E-Sign; toggle on; a listed PDF opens in a new viewer tab | As expected | Pass | ui #1 |
| 22 | Popup on a tab showing Chrome's viewer | "This tab shows a PDF"; Open in PdfCraft replaces the tab | As expected | Pass | ui #2 |
| 23 | Popup row (Edit) with no PDF | Chooser page "Choose a PDF to edit", no stray controls; PdfCraft `default_mode` = edit; choosing a file opens it | As expected | Pass | ui #3 |
| 24 | Popup on a PdfCraft tab, row E-Sign | Card names the document; new tab `?mode=sign&file=…`; E-Sign workspace (screenshot `pdfcraft-06-workspace-sign.png`); next start restores the user's default | As expected | Pass | ui #4 |
| 25 | Chooser page "Continue to PdfCraft" | PdfCraft home | As expected | Pass | ui #5 |
| 26 | Embedded PDFs (`<embed>`, `<iframe>`, `<object>`) | Button at the bottom right inside the PDF frame; opens a viewer tab | As expected | Pass | ui #6 |
| 27 | Embedded button setting off | No button | As expected | Pass | ui #7 |
| 28 | Offline | Web PDF: "You're offline" with icon; PdfCraft still starts from the chooser page | As expected | Pass | ui #8 |
| 29 | Context menus | All three items registered | As expected | Pass | ui #9 (registration only) |
| 30 | Local `file://` PDF, file access allowed | Redirected; "Local report.pdf · Local file" | As expected | Pass | ui #10 |
| 31 | "Copy document link" | Toast "Link copied"; the exact original URL (with query and fragment) written to the clipboard | As expected | Pass | viewer "Copy document link" |
| 32 | Bypassed load becomes a download | The one-time allow rule is removed; the next PDF in that tab opens in PdfCraft again | As expected | Pass | viewer "a bypassed load that becomes a download…" |

**Google Chrome 155.0.8059.79 (the installed, branded Chrome): smoke test passed** (`npm run test:chrome`).
Run headless in a throwaway profile; the user's own profile was not used. The extension was
installed with the DevTools command `Extensions.loadUnpacked`, because branded Chrome ignores
`--load-extension`. Checked and passed:
- A PDF link redirects to the viewer (`viewer.html?file=…`) and PdfCraft 0.8.0 opens it
  (`pdfcraft-13-chrome155-viewer.png`).
- `chrome.action.openPopup()` renders the popup at 293 × 487 with "10 PDFs on this page"
  (`pdfcraft-14-chrome155-popup.png`).
- The embedded-PDF button is present in the PDF frame.

### Not tested automatically (with manual steps)

| Scenario | Why not | Manual check |
|---|---|---|
| The *Load unpacked* button in branded Chrome | Chrome 155 was tested through `Extensions.loadUnpacked` (the same unpacked-install path), not by clicking the button | chrome://extensions → Developer mode → Load unpacked → `dist/pdfcraft-chrome`. Open a PDF link: PdfCraft should open it |
| Physical toolbar click | Automation opened the popup with `chrome.action.openPopup()` | Click the PdfCraft toolbar icon (pin it first) on a page with PDF links |
| Clicking context-menu items | No API can click native menus | Right-click a PDF link → "Open link in PdfCraft": a viewer tab opens next to the current one |
| Printing | OS print dialog | Open a PDF → PdfCraft's printer icon (or Ctrl+P inside PdfCraft): Chrome's print preview shows the document |
| PDFs behind a sign-in (cookies) | Fixtures have no cookie auth | Sign in to a site that serves private PDFs, open one: it should open in PdfCraft (the viewer fetches with your cookies). Some sites bind downloads to a one-time token: then use "Open in Chrome's PDF viewer" |
| Real GPU / WebGPU | Headless used SwiftShader | Open any PDF in Chrome with hardware acceleration on |
| Incognito | Not exercised | chrome://extensions → PdfCraft → Details → Allow in Incognito; open a PDF in an incognito window |
| Real network loss | Offline was emulated (Playwright) | Disconnect, open a PDF link, then "Select a file" |
| Very large PDFs (hundreds of MB) | Largest fixture is 24 MB | The whole file is held in memory twice (viewer and PdfCraft); expect high memory use |
| PdfCraft's own test suite (`cargo test`) | PdfCraft's code was not changed; the release build is bundled as is | — |

### Adobe extension (for comparison)

Adobe's runtime scenarios (Chromium 139, signed out, same kinds of fixtures) are documented in
the private investigation notes, which are not published in this repository.
