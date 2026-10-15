# 02 — PdfCraft architecture assessment (for a Chrome MV3 extension that bundles the official web build)

> **Status:** investigation, read-only. **Date:** 2026-10-15.
> **Sources inspected**
> - PdfCraft source, main-branch archive matching v0.8.0 for `apps/pdfcraft-web`. Citations below are relative to this root (`<src>/…`): `%TEMP%/claude/…/scratchpad/src/pdfcraft-main`.
> - The official web release `pdfcraft-web-0.8.0` (`<web>/…`), sha256-verified by the caller.
> - The installed desktop app `C:\Program Files\PdfCraft` (`pdfcraft-cli 0.8.0`; `pdfcraft-cli tools` lists 163 automation tools).
>
> No git commands were run, and nothing from the downloaded trees was built or executed. The wasm/JS were inspected only as data (grep and a byte search).

---

## TL;DR

- PdfCraft is a pure-Rust Cargo workspace. The web app is the **same egui shell** (`pdfcraft-ui-egui`) compiled to wasm32 with **trunk**. All PDF work runs in wasm on the CPU (hayro renderer, lopdf/cos object model). It needs **no server, no account and no network**, apart from an optional `?file=<url>` fetch.
- The JS surface is **only the wasm-bindgen glue** (`export { initSync, __wbg_init as default }`) plus a **postMessage host bridge** (`?host=parent`, same-origin parent only). There is **no JS-callable engine API**: an extension cannot ask it to "merge these files" or "open the Sign tool". It can only hand files in and take saves out.
- **Corrections to earlier assumptions:**
  1. `?webgl` / `?cpu` **do not exist in code**. The web renderer is hard-wired to eframe **Glow, which needs WebGL2** (`apps/pdfcraft-web/src/main.rs:11`). HOSTING.md is stale on this point.
  2. The wasm is **38,059,629 bytes**, not the ~13 MB HOSTING.md quotes.
- **MV3 blockers:**
  1. The release `index.html` uses an **inline module script**, which MV3 forbids.
  2. Wasm needs **`'wasm-unsafe-eval'`** in the extension-page CSP.
  3. The bridge needs a **same-origin parent frame**, so the extension needs a wrapper page that hosts the app in an iframe.
- **Web capability gates:**
  - OCR is compiled in but has **no models**, so it is not usable.
  - **Digital (certificate) signing does not work on web.** Fill & Sign (visual signatures) does.
  - **Printing goes through the browser's print dialog** (images in a hidden iframe).
  - Save becomes a **browser download**, or a **`pdfcraft:save` message** to the host page.
  - Files cannot go to the clipboard, there are no folders, no file watching, no autosave or recovery, and no update check.
- **Licensing:**
  - Code is `MIT OR Apache-2.0`. The **PdfCraft app icon is `MIT OR Apache-2.0`**, so it was copied (see §8). The document icon is `ISC AND (MIT OR Apache-2.0)`.
  - The **ArtCraft marks are trademarks and are rendered inside the wasm.** Any rebuilt or modified build must remove them, and the extension's name, icon and listing must never use them.
  - The web zip ships only NOTICE, LICENSE-MIT and LICENSE-APACHE. The extension must also ship the OFL, ISC, BSD and other texts that NOTICE references (§8).

---

## 1. Project structure, entry points, languages, dependencies

| Item | Finding | Evidence |
|---|---|---|
| Language / package manager | Rust only (edition 2024, rust ≥ 1.95), Cargo workspace, `resolver = "3"`, version **0.8.0**, licence `MIT OR Apache-2.0` | `<src>/Cargo.toml:1-12` |
| "No handwritten JS/TS" | Applies to the product **and** the build | `<src>/CLAUDE.md:33`, `<src>/docs/architecture.md:11-13`, `<src>/apps/pdfcraft-web/src/main.rs:1-2` |
| Binaries | `apps/pdfcraft` (desktop eframe/egui on wgpu with a glow fallback), `apps/pdfcraft-cli` (inspect/edit/combine/…/`run`/`tools`/`ui`/opt-in `mcp`), `apps/pdfcraft-web` (the egui shell compiled to wasm) | `<src>/docs/architecture.md:15-20` |
| Library crates | 31 crates in 6 layers. L0 `geom filters crypt`; L1 `cos`; L2 `content model fonts`; L3 `render annot forms js xfa`; L4 `edit organize redact xfdf sign ocr create export optimize preflight a11y compare measure print`; L6 `engine` (session, history, command registry, **tool catalogue**); L7 `platform ui-egui automation` | `<src>/docs/architecture.md:24-37` |
| Web entry point | `apps/pdfcraft-web/src/main.rs` (251 lines): `eframe::WebRunner` on `<canvas id="pdfcraft">`, `PdfCraftApp::new()`, settings restored from storage key `"pdfcraft"` (fallback `"printcraft"`), `?file`, `beforeunload` guard, `?host=parent` bridge | `main.rs:6-87` |
| Web build config | `Trunk.toml`: `dist = "../../dist/web"`, `public_url = "./"`, `filehash = true`; `index.html` uses `<link data-trunk rel="rust" data-wasm-opt="z">` | `<src>/apps/pdfcraft-web/Trunk.toml:1-9`, `index.html:7` |
| Web crate deps | `pdfcraft-ui-egui`, `eframe` with features `default_fonts, glow, persistence, accesskit`, `egui`, `wasm-bindgen-futures`, `web-sys`, `js-sys` | `<src>/apps/pdfcraft-web/Cargo.toml:12-20` |
| UI toolkit | egui/eframe **0.36**, `egui_extras` (svg), `rfd 0.17` (file dialogs; on wasm with `file-handle-inner`), shared `craft-ui` (git, storytold/craft-libs) | `<src>/Cargo.toml:16,72-76`; `<src>/crates/ui-egui/Cargo.toml:13-31,61-66` |
| wgpu | `ui-egui` enables eframe's `wgpu` feature (`ui-egui/Cargo.toml:22`), so wgpu's WebGPU and WebGL code is **compiled into the wasm** (strings such as `requestAdapter` and `WebGPU is only available in secure contexts` appear in glue and wasm). The web app **selects Glow** (`main.rs:11`). A vendored `egui-wgpu` patch exists (`Cargo.toml:114`). | glue `pdfcraft-web-*.js:1812-1817` |
| PDF engines | Rendering: vendored **hayro 0.7.1** family (`hayro`, `hayro-interpret`, `hayro-syntax`, `hayro-jbig2`), CPU raster. Inspection: vendored **lopdf 0.45** (bootstrap debt). Object model / writer: own `pdfcraft-cos`. | `<src>/Cargo.toml:54-58,106-114`; `<src>/CLAUDE.md:53-54`; `<src>/docs/architecture.md:60-63` |
| Other key deps | OCR: `ocrs 0.13.1` + `rten 0.26` (`crates/ocr/Cargo.toml:15-16`). JS: `boa_engine 0.22` (`crates/js/Cargo.toml:14-17`). Signing: `p256`/`p384`; `aws-lc-rs` for RSA on native only (`crates/sign/Cargo.toml:21,42`). Images: `image 0.25`. Desktop update check: `ureq` (desktop app only, `apps/pdfcraft/Cargo.toml:12-15`). | as cited |
| Size | About 152k lines of Rust and 1,765 tests (2026-10-10). `ui-egui` alone is about 53k lines. `#[test]` count in this archive: 3,121. | `<src>/docs/architecture.md:11-12` |

---

## 2. Capabilities, and which are in the web build

The tool catalogue is data in the engine (`<src>/crates/engine/src/catalog.rs`, `TOOL_GROUPS`, lines 62-529). Every UI builds its All-tools panel, palette and menus from it. Each item has `label`, `icon` (a Lucide name), `command` and `availability` (`Ready`, `Planned("Mx")` or `Provider`). The web build compiles the same catalogue. What changes on web is the wasm `cfg` gates in `ui-egui` and in a few engine crates.

### 2.1 Tool groups (user-visible labels) and their web status

| Group id (for `set_option("tool", id)`) | Label shown | Catalogue line | Ready items (summary) | Web build |
|---|---|---|---|---|
| `export` | Export a PDF | 63 | Word .docx, .pptx, PNG image, all images, HTML, RTF, text. Planned: .xlsx, PS/EPS | ✅ Runs inline; results are browser downloads (`export_ui.rs:269-279`) |
| `fill_sign` | Fill & Sign | 85 | Text, check, cross, dot, line, date, signature, initials | ✅ Signature images are picked through a web inbox (`fill_sign.rs:1051-1160`). No drop onto the pad (`lib.rs:2810-2812`) |
| `edit` | Edit a PDF | 108 | Rotate, insert, delete, extract, organize pages; edit text & images, add text, image, header/footer, watermark, link, Bates, background | ⚠️ Partial. **Adding or replacing images says "arrives on the web with file pickers"** (`content_ui.rs:637-653,709-721`). Copying an image to the clipboard is refused (`content_ui.rs:687-689`) |
| `create` | Create a PDF | 142 | Single file, multiple files, separate PDFs, images, clipboard, blank | ⚠️ "Images" says "On the web, open or drop an image" (`create_ui.rs:169-170`). Clipboard returns nothing (`create_ui.rs:116-117`). Multiple files are downloaded (`create_multiple_ui.rs:78-94`) |
| `combine` | Combine files | 161 | Add files to combine | ✅ Uses a file picker and drops (`files.rs:286-300,405-420`). **No "Add folder"** (`combine_ui.rs:1221,2524-2531`) |
| `organize` | Organize pages | 170 | Page grid, rotate, delete, extract, insert, replace, split, page boxes, crop, duplicate, page labels | ✅ Split and extract outputs are downloaded (`files.rs:689-695`). No drop of OS files onto the grid on web (`lib.rs:2812`) |
| `comment` | Add comments | 202 | Sticky note, highlight, underline, strikethrough, squiggly, text box, ink, rectangle, oval, line, arrow, comment list, flatten. Planned: cloud, stamp | ✅ |
| `scan` | Scan & OCR | 242 | Recognize text (this file, multiple files), enhance camera image | ❌ **OCR is not usable.** The models are found only through `$PDFCRAFT_MODELS`, folders beside the executable, or the source tree (`crates/ocr/src/lib.rs:57-72`). None exists in a browser, and "the web build doesn't include them yet" (`docs/releasing.md:72-78`). No `.rten` data in the wasm (byte search: 0). The dialog checks `pdfcraft_engine::ocr::available()` (`ocr_ui.rs:72`). OCR code (ocrs) **is compiled in** and would run inline/single-threaded (`ocr_ui.rs:190-191,276-277`). Camera-image enhancement is pure Rust and should work |
| `protect` | Protect a PDF | 260 | Password, remove hidden info, security properties, remove security. Planned: certificate encryption | ✅ |
| `redact` | Redact a PDF | 285 | Mark, pages, find & redact, properties, sanitize | ✅ |
| `compress` | Compress a PDF | 303 | Reduce file size, advanced optimization. Planned: audit | ✅ |
| `form` | Prepare a form | 319 | Field list, detect, clear, properties, tab order, flatten, import/export data, add 9 field types | ⚠️ "Import data" says "arrives on the web with file pickers" (`files.rs:825-826`). "Merging data files needs the desktop app" (`files.rs:891`) |
| `stamp` | Add a stamp | 357 | Stamp palette | ✅ |
| `certificate` | Use a certificate | 366 | Digitally sign, validate, certify (visible/invisible). Planned: timestamp | ❌ **Signing fails on web.** With no `save_override`, the wasm branch returns `Err(String::new())` without signing or saving (`sign_ui.rs:482-486`). There is no "Browse…" for a .p12/.pfx Digital ID (`sign_ui.rs:749-751,791-805`), and RSA key generation is refused in the browser (`crates/sign/src/keys.rs:657-660`). Validating existing signatures is engine-only and presumably works (not runtime-verified) |
| `print_production` | Use print production | 384 | Set page boxes (others planned M11) | ✅ (page boxes) |
| `measure` | Measure objects | 403 | Distance, perimeter, area, scale, info, snapping, export CSV | ✅ CSV is downloaded (`measure_ui.rs:489`) |
| `compare` | Compare files | 424 | Select files to compare | ✅ (file picker) — not runtime-verified |
| `actions` | Use guided actions | 433 | Action Wizard, prepare for distribution, optimize scans | ✅ The open document stands in for the file picker, and outputs are downloaded (`actions_ui.rs:84-110,194-196`) |
| `accessibility` | Prepare for accessibility | 451 | Autotag, reading options, check, report, alt text, tags panel | ✅ |
| `standards` | Apply PDF standards | 471 | Save as PDF/A (PDF/X, PDF/UA and Preflight planned) | ✅ |
| `search_index` | Add search index | 488 | — (planned M12) | n/a |
| `javascript` | Use JavaScript | 497 | Group marked Planned(M6) in the catalogue, but the JS console and document JS dialogs exist (`Dialog::JsConsole/DocumentJs`, `lib.rs:319-322`) | ✅ boa runs on the calling thread on wasm (`crates/js/src/lib.rs:1116-1117`) |
| `ai` | AI assistant (badge "Optional") | 513 | Provider (bring your own model, off by default) | n/a (no provider) |

**Home tab:** the recommended tools are `organize, comment, form, edit, protect` (`crates/ui-egui/src/home.rs:10`). Home also shows "Welcome to PdfCraft", Open file, Recent, a "Join the ArtCraft community" card **with the ArtCraft mark** (`home.rs:40-43`), and a Privacy note ("PdfCraft works offline. No telemetry, no account…", `home.rs:208-210`).

### 2.2 Cross-cutting web behaviour

| Area | Web behaviour | Evidence |
|---|---|---|
| Viewing / rendering | CPU raster by hayro, single-threaded on wasm (render work queue gates; "the web build has no threads") | `crates/render/src/raster/work_queue.rs:7-47`; `crates/ui-egui/src/web_print.rs:1-4` |
| Open | `rfd` web picker (`<input type=file>`) → `inbox`; drag-and-drop (`open_dropped`, wasm variant); `?file=` → `startup_inbox`; bridge `pdfcraft:open` → `startup_inbox` | `lib.rs:1750-1775`, `lib.rs:1420`, `main.rs:31-53,178-208` |
| Save | **Browser download** through an `<a download>` with a blob URL. With `host_save` set, **`pdfcraft:save`** is posted to the parent instead | `editing.rs:608-645`, `editing.rs:980-997` |
| Other outputs (export, split, extract, OCR or action batches, CSV, XFDF, print fallback) | Always `crate::editing::download(...)`, **even in host mode** (not routed to the host) | call sites: `export_ui.rs:279`, `files.rs:693,862,926,985`, `measure_ui.rs:489`, `ocr_ui.rs:243`, `actions_ui.rs:110`, `create_ui.rs:288`, `create_multiple_ui.rs:81`, `print_ui.rs:471,510` |
| Print (web printing closed gap 4: `docs/gaps.md:6,20,367`; `ROADMAP.md:208`) | "Browser's print dialog" is the only printer. PdfCraft renders each sheet to PNG (300/200/150 dpi by sheet count, ≤ 1000 sheets, ≤ 64 MP per sheet, ≤ 1 GiB per job), turns them into blob URLs, and builds a page in a **hidden iframe via `srcdoc`**, then calls `contentWindow.print()`. If that fails, it downloads the print-ready PDF | `web_print.rs:1-60,234-317`; `print_ui.rs:456-472,750` |
| Clipboard | Text uses eframe/web clipboard (`writeText` in glue). **Images and files to the clipboard are refused** on web | glue `:2860`; `content_ui.rs:687-689`; `image_pick.rs:205-208` |
| Autosave / crash recovery | **Off on web.** `recovery` starts as `None` (`lib.rs:714,999`) and only the desktop app calls `enable_recovery` (`apps/pdfcraft/src/main.rs:379`). The web `main.rs` never does, so `autosave_tick` returns early (`recovery.rs:187-190`) | as cited |
| Reopen last session, file watching, pinned folders, reveal in folder, local cross-PDF links | Desktop only | `last_session.rs:63-71,136-137`; `lib.rs:77-78`; `folders_ui.rs:194`; `tab_context.rs:19-44`; `lib.rs:1664-1666` |
| Update check | No-op on web (no `update_source`) | `updates.rs:89-91` |
| Language | Web always detects **English**. The user can change it in Preferences (persisted) | `i18n/mod.rs:390-393` |
| Unsaved-work guard | `beforeunload` + `preventDefault` while `unsaved_flag` is set | `main.rs:54-56,89-101` |
| Attachments | "Downloading attachments on the web arrives with M3.10" | `lib.rs:1468-1469` |

---

## 3. UI components and design system (ui-egui)

### 3.1 Design tokens (`crates/ui-egui/src/theme.rs:70-122`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `titlebar` | `#E9E9EB` | `#1B1B1E` | Tab strip / title band |
| `chrome` | `#FFFFFF` | `#26262A` | Mode bar, panels |
| `panel` | `#FFFFFF` | `#26262A` | Panels (`panel_fill`) |
| `pasteboard` | `#F1F1F3` | `#19191C` | Document area behind pages (also the web page `background`, `index.html:40-42`) |
| `card` | `#FFFFFF` | `#2E2E33` | Cards, windows (`window_fill`) |
| `border` | `#DADADE` | `#3C3C43` | Window strokes, borders |
| `divider` | `#E8E8EB` | `#333339` | Separators |
| `text` | `#222226` | `#ECECEF` | Primary text |
| `text_muted` | `#5E5E66` | `#AEAEB6` | Secondary text |
| `text_faint` | `#6B6B73` | `#97979E` | Hints, captions (≥ 4.5:1 on every surface, enforced by test `theme.rs:675-686`) |
| `icon` | `#44444B` | `#D4D4DA` | Icon tint |
| `hover` | `#F0F0F3` | `#34343A` | Hover wash, `faint_bg_color` |
| `pressed` | `#E4E4E9` | `#3E3E45` | Pressed wash |
| `selected` | `#E6EEFD` | `#233A63` | Selected rows/tools |
| `accent` | `#1B63E0` | `#4B8BF5` | The single blue accent (selection stroke) |
| `accent_text` | `#1755C4` | `#8CB6FA` | Links, accent text |
| `accent_soft` | `#E3ECFD` | `#243657` | Selection background, selected-control wash |
| `field` | `#FFFFFF` | `#1E1E22` | Text field background |
| `badge_new` | `#1B63E0` | `#3D7DEE` | "New" badges |
| `page_shadow` | black α 34 (≈ `rgba(0,0,0,.13)`) | black α 120 (≈ `rgba(0,0,0,.47)`) | Page drop shadow |
| `radius` | 6 px | 6 px | Widget corner radius |

**Brand colour vs UI accent.** The **app icon** uses PdfCraft green **`#12a58a`**, paper `#efe9dc` and ink `#0b0b0c` (`assets/app-icon/README.md`, palette table; also the README badge colour `README.md:22`). The **UI accent is blue** (`#1B63E0` / `#4B8BF5`). For a popup that should "look like PdfCraft", use the neutral tokens with the blue accent, and reserve the green for the icon or brand header.

**Tool-family hues** (icon tints in All tools, `catalog.rs:54-60`):

| Name | Hex |
|---|---|
| RED | `#E03E3E` |
| PURPLE | `#8E4EE6` |
| BLUE | `#3A6FE8` |
| GREEN | `#2D9D5B` |
| ORANGE | `#E88A1A` |
| TEAL | `#149CA8` |
| PINK | `#D63B8F` |

Group → hue (all 23 groups, from the `hue:` field of each block):

| Hue | Groups |
|---|---|
| BLUE | export, combine, protect, javascript |
| PURPLE | fill_sign, form, stamp, print_production, actions, accessibility |
| PINK | edit, measure, compare, ai |
| RED | create, redact, compress, standards |
| GREEN | organize, scan, search_index |
| ORANGE | comment |
| TEAL | certificate |

**Other style values** (`theme.rs:379-443`):

| Setting | Value |
|---|---|
| Window corner radius | 10 |
| Menu corner radius | 8 |
| Window shadow | offset 0,8, blur 28, black α 38 (light) / 110 (dark) |
| Popup shadow | offset 0,4, blur 16, α 30 / 90 |
| `item_spacing` | 8×6 |
| `button_padding` | 10×5 |
| `menu_margin` | 6 |
| Scrollbar | floating, width 8 (3 when floating) |
| Cursor on controls | pointing hand |
| Tooltip delay | 0.35 s |
| Animated hover / press | 0.12 s / 0.06 s; a full press drops the content 1 px (`theme.rs:133-178`) |
| Light-theme text gamma | 0.75 |

**Default theme preference:** **Light**, not System (`theme.rs:17-23`). The web `index.html` background follows `prefers-color-scheme` (`index.html:40-42`).

### 3.2 Typography (`theme.rs:277-367,434-437`)

- **Inter** (Regular / Medium / SemiBold) is the proportional face. **JetBrains Mono** is the monospace face. **Dancing Script** is used for typed signatures. egui's defaults follow as fallbacks, then optional craft-fonts faces (CJK, Arabic, Telugu, Hebrew, Thai).
- Sizes: Body and Button **13 px regular**, Small **11 px**, Heading **17 px SemiBold**. Named families `medium` and `semibold` are used for emphasis, for example the Home "Recommended tools" heading at SemiBold 15 (`home.rs:60`) and dialog titles at SemiBold 18 (`ocr_ui.rs:76`).
- Font files: `<src>/assets/fonts/Inter-{Regular,Medium,SemiBold}.ttf`, `JetBrainsMono-Regular.ttf`, `DancingScript.ttf`, each with `OFL-*.txt`. A popup can bundle Inter under OFL-1.1, or load Inter from Google Fonts.

### 3.3 Icons

- **Lucide** (lucide-static **1.49.0**, ISC). 186 SVGs plus `LICENSE-lucide.txt` live in `<src>/assets/icons/` and are embedded via `icon_data.rs`.
- They are rendered white with **stroke width 1.75**, then tinted per use (`crates/ui-egui/src/icons.rs:1-17`).
- The icon names in the catalogue (`file-output`, `pen-line`, `file-pen-line`, `file-plus-2`, `files`, `layout-grid`, `scan-text`, `stamp`, …) are Lucide names, so a popup can use the same Lucide icons for a 1:1 look.

### 3.4 Layout grammar

The layout follows `lib.rs:1-6` and `chrome.rs:1-27`:

1. **Tab strip**, 38 px tall (28 px on macOS). Tabs are 30 px tall and at least 180 px wide. The Home tab is shown when `active = None`.
2. **Mode bar** (workspace switcher). Labels exactly as shown: **"All tools", "Read", "Edit", "Convert", "E-Sign"** (`chrome.rs:494`). Each mode maps to a left panel:

   | Mode | Left panel |
   |---|---|
   | Edit | tool `edit` |
   | Convert | tool `export` |
   | E-Sign | tool `fill_sign` |
   | All tools, Read | All tools list |

   Mapping in `lib.rs:2036-2048`. Read mode closes the right panes (`lib.rs:2053-2071`).
3. **Left tool panel** (All tools, or one group's sections).
4. **Floating vertical quick-action bar** (`QuickTool`: Select, Hand, comment, measure, crop, fill, field, redact, add or edit text, stamp, link, sign area, marquee zoom, snapshot, column select; `lib.rs:200-238`).
5. **Document canvas.**
6. **Right panel plus right rail.** Panels: Comments, Bookmarks, Pages, Fields, Layers, Attachments, Signatures, Accessibility, Tags, Search, Compare (`lib.rs:180-197`).
7. **Docking** with panels Canvas, Tools and Inspector (`docking.rs:11-25`).
8. A **command palette** (`palette_open`) and many modal dialogs (`enum Dialog`, `lib.rs:261-339`).

---

## 4. State management and routing

| Concept | Where | Notes |
|---|---|---|
| App root | `PdfCraftApp` (`lib.rs:468-…`), an `eframe::App` (`lib.rs:2743`) | Immediate-mode UI with no router. "Routing" is state: `active: Option<usize>` (None = Home), `mode: Mode`, `left: LeftPanel`, `right: Option<RightPanel>`, `dialog: Option<Dialog>`, `quick_tool` |
| Documents / tabs | `session: pdfcraft_engine::Session` (documents, undo history, commands) + `views: Vec<DocView>` (one per tab) | Engine façade: frontends never reach past it (`docs/architecture.md:35`) |
| Workspaces | `enum Mode { AllTools="all", Read, Edit, Convert, Sign }` (`lib.rs:147-170`), `default_mode` (persisted) and `mode_override` (session only) | On open, the app switches to `mode_override` or `default_mode` (`lib.rs:1283,1305-1314`) |
| Async inboxes | `Inbox = Arc<Mutex<Vec<(String, Vec<u8>)>>>` (`lib.rs:370`): `inbox` (picker, drops), `startup_inbox` (`?file`, host bridge), `failed_inbox` | `startup_inbox` is drained only when no prompt, dialog or close request is pending. A file that arrives after the user has started working opens in a **background** tab (`lib.rs:2829-2850`, `startup_superseded` at `:2796`) |
| Host hooks | `host_save: Option<HostSaveFn>` (`Fn(&str, &[u8], bool) -> Result`), `host_dirty: Option<HostDirtyFn>` (called every frame; the bridge de-duplicates), `unsaved_flag: Arc<AtomicBool>` | `lib.rs:389-395,593-604`; `lib.rs:2880-2885` |
| View options API (exists, **not exposed on web**) | `PdfCraftApp::set_option(key, value)` accepts `mode`, `default-mode`, `tool`, `left`, `home`, `panel`, `theme`, `language`, `scroll_speed`, `animation_effects`, `date-format`, `dialog`, `page`, … | `lib.rs:2319-2420`. The desktop applies CLI `--key value` pairs with it (`apps/pdfcraft/src/main.rs:412-417`) |
| Persistence | `eframe::App::save` → `storage.set_string("pdfcraft", self.persist())` (`lib.rs:2759-2761`). On web, eframe's `persistence` feature stores this in **`localStorage`** (glue has `getItem`/`setItem`/`removeItem`; indexedDB: none). Restore at startup is `main.rs:27-29` → `restore()` (`lib.rs:2163`) | **JSON keys** (`lib.rs:2097-2160`): `docking, docking_left_open, docking_right, recent, reopen_last_session, last_session, reload_changed_files, system_title_bar, pinned_folders, theme, scroll_speed, animation_effects, default_mode, default_layout, default_zoom, highlight_fields, units, language, reading_colors, ui_scale, flatten_fill_sign, fill_text_size, date_format, date_language, author, comment_styles, signature, signature_text, signature_image, initials, sign_graphic, digital_ids, trusted, custom_stamps, javascript, actions, combine_columns, combine_view, combine_zoom, comments_panel_closed, right_panel_closed`, and more. Note that it **stores drawn, typed and image signatures, initials and digital ID entries**, which is relevant to a Chrome Web Store privacy disclosure. egui's own memory is also persisted by eframe. The exact localStorage key naming is eframe's and should be checked at runtime |

---

## 5. Backend / API / auth

- **None is required.** Everything runs locally in wasm. HOSTING.md:13 says "There is no server-side code"; Home says "PdfCraft works offline. No telemetry, no account, and no cloud processing unless you add a provider" (`home.rs:210`).
- **Network calls in the web build:**
  - `fetch(?file=url)` (`main.rs:110-120`).
  - The wasm self-fetch in the glue (`init` → `fetch(module_or_path)`, glue `:3511`).
  - User-initiated link opens (`window.open`, glue `:1675`, eframe `links`).
  - The desktop-only update check (`ureq`, `apps/pdfcraft/Cargo.toml:12-15`) is not in the web build (`updates.rs:89-91`).
- The help links in the wasm (getartcraft.com, Discord, GitHub) are clickable only.
- MCP and the control channel are opt-in and desktop-only (`AGENTS.md:96-103`). The control transport is loopback TCP, which the web build cannot use.

---

## 6. Web build JS surface (glue `<web>/pdfcraft-web-2e8fa69ba6b1231a.js`, 164,653 bytes)

| Question | Answer | Evidence |
|---|---|---|
| Exports | **Only `export { initSync, __wbg_init as default }`**. No `#[wasm_bindgen]` app functions | glue `:3519` |
| `index.html` | **Inline** `<script type="module">` imports the glue, `await init({module_or_path: './…_bg.wasm'})`, sets `window.wasmBindings`, and dispatches `TrunkApplicationStarted`. It also has `modulepreload`/`preload` with SRI `integrity` | `<web>/index.html:8-18,24` |
| eval / `new Function` | **None.** The single `Function(` hit is the `debugString` formatter (`` `Function(${name})` ``) | glue `:3146` |
| Wasm instantiation | `WebAssembly.instantiateStreaming` with an `instantiate` fallback, so MV3 needs **`'wasm-unsafe-eval'`** | glue (5 × `WebAssembly.instantiate`, 3 × `instantiateStreaming`) |
| Workers / SharedArrayBuffer | **No Worker construction** (only a `WorkerGlobalScope` probe at `:8`). **No SharedArrayBuffer**, and no COOP/COEP needed (HOSTING.md:39-42). Everything is single-threaded | glue `:8-9` |
| fetch of extra assets | **None at runtime.** Fonts, icons, CMaps and std-14 fonts are all `include_bytes!` in the wasm. No `.rten` models | grep; `theme.rs:323-326`; `crates/fonts/build.rs:1-6,39-68` |
| WebGPU vs WebGL | Code for both is linked (wgpu `requestAdapter` etc., and `getContext`). The **web app uses Glow / WebGL2** (`main.rs:11`). **`?webgl` and `?cpu` are not implemented**: `main.rs` reads only `file`, `host`, `author` (`:31,59,64`), and no crate reads `location().search` (grep). HOSTING.md:81-94 ("PdfCraft renders with wgpu… ?webgl… ?cpu") does not match the code. **A browser without WebGL2 cannot start the app** (the bridge then posts `pdfcraft:failed`, `main.rs:78-85`) | glue `:830-843,1812-1817` |
| Clipboard | `navigator.clipboard.writeText`, plus `clipboardData` on paste events | glue `:314-319,2860` |
| localStorage | Yes (eframe persistence) | glue `:881,1390,1797,1885` |
| IndexedDB | No | grep: 0 |
| window.open | Yes (`arg0.open(url, target)`, link opening) | glue `:1675` |
| Downloads | `URL.createObjectURL` + `<a>.download` + `.click()` | glue `:426,2079,292`; `editing.rs:980-997` |
| Print | Hidden `<iframe srcdoc=…>` with blob-URL `<img>` sheets, then `contentWindow.print()` | glue `:371,1737,2358`; `web_print.rs:266-317` |
| postMessage | `parent.postMessage(msg, origin[, transfer])` (bridge) | glue `:1727-1731` |
| File input | `rfd` web: creates `<input type=file>`, reads `.files`, `FileReader` / `arrayBuffer` | glue `:743-747,1604` |
| Provenance markers in wasm | `pdfcraft:ready` next to `0.8.0version`; `pdfcraft:save`, `saveAs`, `pdfcraft:dirty`, `pdfcraft:failed`; `printcraft`; `PdfCraft: could not fetch` | byte search |
| `pdfcraft:open` literal | Not found as a literal (0 hits). Short constant comparisons are typically compiled to integer compares, so this is expected. **Present in source (`main.rs:187`); runtime check pending** | — |
| Wasm size | **38,059,629 bytes** (HOSTING.md says ~13 MB; stale) | `ls -l` |

---

## 7. Build, deployment, tests

- **Web build:** `cd apps/pdfcraft-web && trunk build --release`, producing `dist/web` with hashed file names and relative URLs. `packaging/web/package.sh` builds it, rejects root-absolute URLs, and copies in `_headers`, `.htaccess`, `README.md` (as `HOSTING.md`) and the docs (`copy_docs`: NOTICE, LICENSE-*, README). It then zips `pdfcraft-web-<v>.zip` (`<src>/packaging/web/package.sh:14-38`). `wasm-opt -Oz` comes from `data-wasm-opt="z"` (`index.html:7`).
- **Release CI:** `.github/workflows/release.yml` delegates to `storytold/craft-common-actions/.github/workflows/release.yml@main`, with craft-fonts pinned at `3d9ab3a1…` (`release.yml:20-28`). The exact web job lives outside this repo. Releases build with `CRAFT_FONTS_DIR` / `CRAFT_FONTS_REQUIRED=1` (`docs/releasing.md:66-69`). On wasm, only the UI faces of craft-fonts are embedded: BIZ UDPGothic Regular plus Arab/Telu/Hebr/Thai faces (`crates/fonts/build.rs:3-5`).
  - Note: a plain byte search of the 0.8.0 wasm found neither "BIZ UDPGothic" nor "Noto Sans Thai" (ASCII or UTF-16BE). Whether this release actually embeds them is unconfirmed.
- **CI** (`.github/workflows/ci.yml`):
  - `fmt --check`, `clippy -D warnings`, `cargo test --workspace`, `xtask layers`, `xtask assets` (lines 81-100).
  - A **wasm32 check** job (`cargo xtask wasm` = `cargo check --target wasm32-unknown-unknown` for every crate below L8; lines 106-119; `xtask/src/main.rs:22`).
  - `deny` (licences and advisories) and nightly fuzzing (lines 121-145).
  - Others: `freebsd.yml`, `packaging-lint.yml`, `windows-arm64.yml`.
- **Tests:**
  - 3,121 `#[test]` functions in this archive.
  - `crates/ui-egui/tests/*` holds 41 kittest UI tests, e.g. `control.rs`, `print.rs`, `signing.rs`, `ocr.rs`.
  - `crates/testkit` provides fixtures.
  - `xtask` gates: `layers`, `assets`, `wasm`, `deny`, `ci`, `corpus`, `check`, `fuzz`, `parity`, `text-oracle`, `render-oracle`, `screenshots`, `demo-pdf`, `models`.
  - `parity/acrobat-features.toml` records features that are claimed shipped, with test evidence.
  - **There is no automated test of the web runtime itself**: wasm is only `cargo check`ed, and `web_print` logic is unit-tested on native (`web_print.rs:8-9`).

---

## 8. Licensing for bundling and redistribution

| Component (in the extension) | Licence | Obligation | Source of text |
|---|---|---|---|
| PdfCraft code (the wasm and glue) | `MIT OR Apache-2.0` | Ship LICENSE-MIT and/or LICENSE-APACHE plus **NOTICE** (Apache §4d) | `<web>/LICENSE-MIT`, `LICENSE-APACHE`, `NOTICE` (NOTICE identical to `<src>/NOTICE`, checked with `cmp`) |
| **ArtCraft name, wordmark, mark** (embedded in the wasm: `widgets.rs:502-520`, shown on Home `home.rs:40` and About `dialogs.rs:1099,1117`) | **Trademark, not open source** (`LicenseRef-Storyteller-Trademark`) | Use is permitted only "within PdfCraft itself, its documentation and its official builds" (`docs/brand/LICENSE-brand.txt:13-15`). The marks must never appear in the name, logo, icon or store listing of anything other than PdfCraft (`:27-28`). **Modified versions must remove the marks** (`:30-35`). "Based on PdfCraft by the ArtCraft team" in plain text is allowed (`:34-35`). **Decision needed:** bundling the *unmodified* official build arguably counts as an official build, but **any rebuild (e.g. the adapter in §10) requires removing them** (patch `widgets.rs`, `home.rs:40`, `dialogs.rs:1099,1117`). Never use `docs/brand/*` in the extension's own UI or listing | `<src>/docs/brand/LICENSE-brand.txt`; `<src>/NOTICE:6-8`; `<src>/AGENTS.md:40` |
| **PdfCraft app icon** (`pdfcraft.svg`, `pdfcraft-small.svg`, and derived PNG/ICO/ICNS/hicolor) | `MIT OR Apache-2.0`; original artwork by the project owner; "no third-party material" | Redistribution is permitted **with the licence text**. **Copied** to `extension/icons/source/`. Caveat: Apache-2.0 §6 grants no trademark rights, so do not present the extension as the official PdfCraft app | `<src>/assets/app-icon/LICENSE.txt` |
| **PdfCraft document icon** (`pdfcraft-document.svg`) | `ISC AND (MIT OR Apache-2.0)` (Lucide `file-text` outline + original badge) | Keep the ISC notice. **Copied** with `LICENSE-document.txt` | `<src>/assets/app-icon/LICENSE-document.txt` |
| Lucide icons (embedded in the wasm; also usable directly in the popup) | ISC | Ship `LICENSE-lucide.txt` | `<src>/assets/icons/LICENSE-lucide.txt` |
| Inter, JetBrains Mono, Dancing Script (embedded) | SIL OFL 1.1 (Dancing Script RFN "Dancing Script") | Ship OFL texts | `<src>/assets/fonts/OFL-{Inter,JetBrainsMono,DancingScript}.txt` |
| craft-fonts web faces (BIZ UDPGothic Regular, Noto Sans Thai, plus Arabic, Telugu or Hebrew faces if embedded) | SIL OFL 1.1 | Ship the OFL texts. **Fetch them from storytold/craft-fonts @ `3d9ab3a1`** (not in the web zip or this archive) | `<src>/NOTICE:23-31` |
| egui default fonts (in the wasm: Ubuntu, Hack, Noto Emoji, emoji-icon-font, found by byte search) | Ubuntu Font Licence 1.0; MIT / Bitstream Vera; OFL 1.1; MIT | Ship the notices (source: the `epaint_default_fonts` crate) | `<src>/NOTICE:36-37` |
| hayro std-14 substitute fonts (Foxit `.pfb`, `include_bytes!` in `vendor/hayro-interpret/src/font/standard_font.rs:178-182`) | BSD-3-Clause | **Required notice**: "Copyright 2014 PDFium Authors… Foxit Software Inc." plus the BSD text | `<src>/NOTICE:42-44`; `vendor/hayro-interpret/assets/LICENSE_FOXIT` |
| Adobe CMap resources (in hayro-cmap) | BSD-3-Clause | **Required notice** (`NOTICE:46-49`) plus the BSD text | adobe-type-tools/cmap-resources LICENSE |
| CGATS001Compat ICC profile | CC0-1.0 | None (attribution courtesy) | `<src>/NOTICE:38` |
| OCR models (`.rten`) | CC-BY-SA-4.0 | **Not in the web build**, so no obligation unless you add them. If added: attribution, ShareAlike, and the licence text (see `C:\Program Files\PdfCraft\models\ATTRIBUTION.txt`) | `docs/releasing.md:72-78` |
| Per-file third-party list | — | Recommended: ship `ATTRIBUTION.md` | `<src>/ATTRIBUTION.md` |

**Notices the extension must ship** (for example in `extension/pdfcraft/licenses/`):

1. `NOTICE`
2. `LICENSE-MIT`
3. `LICENSE-APACHE`
4. `OFL-Inter.txt`, `OFL-JetBrainsMono.txt`, `OFL-DancingScript.txt`
5. The craft-fonts OFL texts (BIZ UDPGothic, Noto Sans Thai, …)
6. `LICENSE-lucide.txt`
7. `LICENSE_FOXIT` (BSD-3)
8. The Adobe CMap BSD-3 licence
9. The egui default-font licences
10. If the app icon is used: `assets/app-icon/LICENSE.txt` and `LICENSE-document.txt`

Also state "Based on PdfCraft (https://github.com/storytold/pdfcraft) by the ArtCraft team" in plain text, without logos.

**Copied to `extension/icons/source/`** (sha256 matches the source):

| File | sha256 (prefix) |
|---|---|
| `pdfcraft.svg` | `52b384a1…` |
| `pdfcraft-small.svg` | `b036304c…` |
| `pdfcraft-document.svg` | `8da8278c…` |
| `LICENSE.txt` | `b768acaf…` |
| `LICENSE-document.txt` | `64a3137e…` |
| `LICENSE-MIT` (repo root) | `cd7032ea…` |
| `LICENSE-APACHE` (repo root) | `0d542e0c…` |

The SVGs contain no `<script>`, event handlers, external hrefs, `<image>` or `<foreignObject>`. MIT and Apache full texts were added because `LICENSE.txt` only references them by URL. Chrome manifest icons must be PNG: `<src>/assets/app-icon/hicolor/{16,24,32,48,64,128,256,512}x…/apps/ai.storyteller.pdfcraft.png` are licensed the same way (derived files, `LICENSE.txt:1-2`). The existing `extension/icons/pdfcraft-*.png` should be checked against those.

---

## 9. Contributor conventions (AGENTS.md / CLAUDE.md)

- **Rust only.** No handwritten JS/TS in product or build (`CLAUDE.md:33`). Any upstreamable adapter must be Rust (web-sys) inside `apps/pdfcraft-web`, not a JS shim.
- **Asset policy:**
  - Nothing from Adobe products, ever (`AGENTS.md:19-30`).
  - Only allow-listed licences (`:32-49`), each asset recorded in `ATTRIBUTION.toml` with sha256 (`:51-67`).
  - Fonts go to craft-fonts, never into the repo (`:69-73`).
  - Icons are Lucide.
- **Never crash:** `Result` everywhere; no `unwrap`/`expect`/`panic`/indexing on untrusted input; `unsafe_code = "forbid"`; clippy denies (`AGENTS.md:105-116`; `Cargo.toml:78-83`). The web `main.rs` carries the deny attributes (`main.rs:4`).
- **Headless parity:** every user feature needs an automation tool and an end-to-end test (`AGENTS.md:98`).
- **Opt-in only, no outbound network by default:** MCP and the control channel stay opt-in (`AGENTS.md:99-100`). PR review checks "no new outbound network" (`CLAUDE.md:38`).
- **Layering:** nothing below L7 depends on egui, eframe or rfd (`CLAUDE.md:23`).
- **Quality gates before each commit:** fmt, clippy `-D warnings`, tests, `xtask layers`, `xtask assets`, wasm check (`CLAUDE.md:39-40`).
- **Workflow:** branch naming `<type>/<slug>`, PRs into `main` only (`CLAUDE.md:41-42`).
- **Clean-room:** never read Acrobat internals, never copy GPL/AGPL (`AGENTS.md:88-94`).

---

## 10. Integration constraints and missing capabilities for a Chrome MV3 host

### 10.1 Hard constraints (must be solved by the extension)

| # | Constraint | Fix |
|---|---|---|
| 1 | **Inline module script** in the release `index.html` (`:8-18`) is blocked by MV3 CSP | Ship your own `pdfcraft/app.html` with `<canvas id="pdfcraft">` (the id is required, `main.rs:15`) and an **external** `loader.js` that does `import init from './pdfcraft-web-<hash>.js'; await init({ module_or_path: './pdfcraft-web-<hash>_bg.wasm' });`. Keep the `<style>` (or move it to CSS). The SRI preload links are optional |
| 2 | Wasm compile needs `'wasm-unsafe-eval'` | `"content_security_policy": { "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" }`. Declare it explicitly even if Chrome's default already includes it |
| 3 | **WebGL2 is mandatory** (Glow, no fallback; `?webgl`/`?cpu` are not implemented) | Listen for `pdfcraft:failed` and show a "needs WebGL2 / hardware acceleration" message |
| 4 | The bridge only talks to a **same-origin parent window** (`main.rs:147-155,183`) | Host the app in an `<iframe src="pdfcraft/app.html?host=parent">` inside an extension page (`viewer.html`). Both are `chrome-extension://<id>`, so the origins match. A popup, side panel or new tab each need their own iframe wrapper. The app cannot be driven from the service worker or a content script directly. **If a content script frames the app inside a web page, the parent is cross-origin**, so the bridge stays silent (and framing would also need `web_accessible_resources`). Move such cases to the extension's own viewer page |
| 5 | **Send files only after `pdfcraft:ready`.** The listener is attached in the app constructor (`main.rs:69-72`); earlier messages are lost | Queue in the wrapper until `ready` (payload `{type, version:"0.8.0"}`) |
| 6 | `pdfcraft:open` carries **one file per message**: `{type:'pdfcraft:open', name, bytes: ArrayBuffer\|Uint8Array}` (`main.rs:186-201`). Non-PDF bytes are passed to `open_bytes` as-is | Several files = several messages. The first opens active; later arrivals open in **background tabs** once the user has started working (`lib.rs:2796,2843-2847`). They are held while a dialog or prompt is open. There is no message to "combine these" |
| 7 | `?file=<url>` uses `window.fetch` from the app page (`main.rs:31-53,110-120`) | Cross-origin URLs need `host_permissions`. `file://` needs the user's "Allow access to file URLs". Simpler: fetch in the wrapper or service worker and post `pdfcraft:open` |
| 8 | **Save in host mode** posts `{type:'pdfcraft:save', name, saveAs, bytes}`, where `bytes` is a **transferred ArrayBuffer**. `saveAs` is `true` for File ▸ Save As and `false` for Save (`main.rs:210-219`; `editing.rs:621-626`). As soon as the post succeeds the app **marks the document saved** and clears dirty (`editing.rs:628-640`), whether or not the host stored it. The host must report its own errors (there is no ack or fail message back) | The wrapper must persist reliably, e.g. `chrome.downloads.download({url: blobURL, filename: name, saveAs})` or the File System Access API. Without `?host=parent`, Save is an `<a download>` blob, which also works in extension pages |
| 9 | **Only Save and Save As go to the host.** Exports, split, extract, OCR or action batches, CSV/XFDF and the print fallback always use anchor downloads (§2.2) | Accept that these go through Chrome's download manager, or intercept with `chrome.downloads.onDeterminingFilename` |
| 10 | `pdfcraft:dirty` `{dirty:boolean}` is sent on change only. The app's own `beforeunload` guard also runs (`main.rs:56`) | Use it to warn before closing the extension tab |
| 11 | iframe attributes | `allow="clipboard-read; clipboard-write; fullscreen"`. If sandboxed: `allow-scripts allow-same-origin allow-downloads allow-popups` (`HOSTING.md:58-79`). Avoid sandboxing: it would break the same-origin bridge |
| 12 | Single-threaded wasm, 38 MB | Expect a startup cost (the extension ships the files locally, so there is no network). Long OCR, print or render jobs block the UI thread |
| 13 | Storage | Settings (including **saved signatures and digital IDs**) live in the extension origin's `localStorage` key `pdfcraft` and are **shared by all extension pages**. Disclose this in the privacy policy |

### 10.2 Missing capabilities (no host API exists)

| Wanted by an extension | Status | Smallest adapter |
|---|---|---|
| Choose a workspace (All tools, Read, Edit, Convert, E-Sign) from the host | ❌ No query param or message | **Without a rebuild:** before loading the iframe, merge `default_mode` (`"all"\|"read"\|"edit"\|"convert"\|"sign"`) into the JSON in `localStorage['pdfcraft']` (restored at `lib.rs:2207-2209`; applied when a document opens, `lib.rs:1283,1309-1314`). Downsides: sticky, visible as a preference, gives a mode but not a tool, and eframe rewrites the key on save. Verify the storage key name at runtime. **With a rebuild:** see the next row |
| Open a specific tool group (e.g. `organize`, `compress`, `redact`) or a panel | ❌ | **Rust, about 15 lines in `apps/pdfcraft-web/src/main.rs`** inside the creator closure: for each whitelisted query param (`mode`, `tool`, `panel`, `left`, `theme`, `language`), call the existing `app.set_option(key, value)` (`lib.rs:2322`). Leave `dialog` off the whitelist: unknown values fall back to About, and `sign` has side effects. The same queue could later accept a `pdfcraft:option` message. Upstreamable (Rust only). **A local rebuild makes it a modified version, so remove the ArtCraft marks** (§8) and rebuild with trunk |
| Run an engine operation headlessly (merge, compress, rotate) and get bytes back | ❌ `pdfcraft-automation` (163 tools on the CLI) is **not** linked into the web build, and there are no `#[wasm_bindgen]` exports | A new wasm target exporting automation tools would be a much larger change. Alternatively, Chrome Native Messaging to the user's installed `pdfcraft-cli.exe` (`doc_combine`, `doc_reduce`, `page_rotate`, `ocr_recognize`, …), which is desktop-only and opt-in |
| Return of non-Save outputs to the host | ❌ | Extend `HostSaveFn` use in `editing::download`. Upstream change |
| OCR in the browser | ❌ No models; the loader is filesystem-only | Upstream: a model-bytes injection API plus shipping the CC-BY-SA models (12 MB) with attribution |
| Digital signatures in the browser | ❌ (`sign_ui.rs:482-486`) | Upstream: route signed bytes through download or host_save |
| Ack or fail for host saves | ❌ | Upstream bridge change |
| Language from the browser | Always English at first start (`i18n/mod.rs:390-393`) | `set_option("language", …)` via the adapter, or pre-seed `language` in localStorage |

---

## 11. Reusable components (for the extension)

| Component | Reuse as | Where |
|---|---|---|
| Whole web app (wasm + glue) | Bundle unmodified under `extension/pdfcraft/`, loaded by an external loader in an iframe | `<web>/pdfcraft-web-2e8fa69ba6b1231a{.js,_bg.wasm}` |
| Host bridge protocol | Wrapper ↔ app messaging (`ready`, `open`, `save`, `dirty`, `failed`) | `main.rs:122-246` |
| Design tokens | CSS custom properties for popup and options pages (light/dark) | `theme.rs:70-122` (table §3.1) |
| Typography | Inter 13/11/17 px, JetBrains Mono for code | `assets/fonts/*` (OFL) |
| Icons | Lucide 1.49.0 SVGs, stroke 1.75 | `assets/icons/*.svg` (ISC) |
| Tool catalogue labels, ids and icons | Popup "quick tools" list with the same labels and icons (e.g. Organize pages / `layout-grid`, Compress a PDF, Combine files / `files`) | `crates/engine/src/catalog.rs:62-529` |
| Mode labels | "All tools · Read · Edit · Convert · E-Sign" | `chrome.rs:494` |
| App icon | Extension icon (PNG sizes from `hicolor/`) with its licence | `assets/app-icon/*` → `extension/icons/source/` |
| Hosting headers | Not needed in the extension (it serves `.wasm` as `application/wasm`) | `<web>/_headers`, `.htaccess` |

## 12. Open items to verify at runtime (in the extension harness)

1. `pdfcraft:open` is honoured by the 0.8.0 release (source says yes).
2. Glow / WebGL2 starts in an extension page and in an iframe, and `pdfcraft:failed` arrives when WebGL is disabled.
3. The exact `localStorage` key(s) eframe writes (`pdfcraft`, `egui_memory_ron`?).
4. A blob `<a download>` and `srcdoc` iframe printing work from `chrome-extension://`.
5. `location.origin` on a `chrome-extension://` page is the extension origin, not `"null"`. The bridge's origin check and its `postMessage` target depend on it (`main.rs:153,159-160,183`).
6. Compare, validate signatures and Office export work on web.
7. Whether the 0.8.0 wasm embeds craft-fonts faces.
