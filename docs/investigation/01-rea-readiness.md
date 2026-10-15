# 01 · REA readiness and capability report

Date: 2026-10-15 · Host: Windows 11 Pro (win32 x64) · Agent client: Claude Code 2.1.300

## Verdict

**REA is installed, registered and working in this session.** No setup or configuration change was
needed, and none was made: no agent settings were touched. REA's browser, JavaScript-application and
evidence tools are available. Its Android, macOS-only, firmware and JEB tools are not; this
investigation doesn't need them.

## How REA is connected

| Item | Observed value | Source |
|---|---|---|
| Package | `rea-agents` **6.4.0**, run through `npx` (`…\npm-cache\_npx\9b9809298fe40d2c\node_modules\rea-agents\scripts\rea.mjs`) | `binary_session` → `server_identity.package` |
| MCP server | `rea` 6.4.0, started 2026-10-15T04:10:59Z, MCP SDK 2.3.1, protocol `2025-11-25` | `binary_session` → `server_identity.server` |
| Catalog | 170 MCP tools, 127 CLI commands, 6 prompts | `server_identity.catalog.counts` |
| Skill | `reverse-engineer-anything`, expected skill version 37, installed at `~/.claude/skills/reverse-engineer-anything` | skill file + `server_identity.skill` |
| Client features | elicitation (form, URL) and roots: yes; sampling: no | `client_features` |
| Deep-analysis providers | **Ghidra 12.1.4** available (Java 22.0.1); Hopper unavailable (not supported on win32); IDA unavailable (`REA_IDA_MCP_CONFIG` not set) | `analysis_provider_candidates` |

In Claude Code the REA tools are *deferred* MCP tools (`mcp__rea__*`). Each one has to be loaded
with ToolSearch before its first call; this is a client mechanism, not an REA limitation.

## Tool availability (from `binary_session`, no target open)

| Status | Count | Notes |
|---|---|---|
| Available | 59 | Includes every browser and JavaScript tool below |
| `target_required` | 59 | Native or archive tools that need `open_binary` first (e.g. `inspect_artifact`, `extract_artifact`, decompiler views). Not a fault. |
| `provider_missing` | 42 | Android/ADB, JEB, apktool, firmware (Binwalk/Unblob), EVM, ELF layout and core files, and **`recover_javascript_sources`** |
| `unsupported_host` | 10 | macOS-only (Mach-O, plist, asset catalogue, signatures, native UI capture) |

### Tools relevant to this investigation

| Question | REA tool | Available | What it can inspect |
|---|---|---|---|
| Static code of the unpacked Adobe extension (JS/MV3) | `analyze_javascript_application`, `inspect_analysis_view`, `trace_application_feature`, `trace_javascript_semantics`, `trace_web_source_location` | yes | Application graph (modules, imports, semantic relations, Chrome API use) **without executing** it |
| Running browser pages | `list_browser_targets`, `inspect_web_page`, `inspect_web_event_listeners`, `observe_web_session`, `observe_web_execution`, `discover_webmcp_tools` | yes | DOM, accessibility tree, scripts, resources, network/console metadata, workers and storage key names, over a **loopback CDP endpoint** |
| Screenshots | `capture_web_screenshot`, `compare_web_screenshots` | yes | Visible viewport PNG of a CDP page target, without scrolling or running page JS |
| Scripted scenarios | `capture_browser_scenario` | yes | Launches or attaches to a browser and runs explicit actions with network/DOM/screenshot capture |
| Network captures | `inspect_web_network_capture` | yes | Retained HAR/mitmproxy files |
| Evidence ledger | `get_evidence_bundle`, `export_evidence_bundle`, `record_unknown` | yes | Evidence IDs (`ev_…`), export to disk |
| Source maps → sources | `recover_javascript_sources` | **no** (`provider_missing`) | Not needed: the Adobe extension ships readable bundles |

## Connecting REA to a browser

REA's browser tools don't launch an extension-enabled browser for you. They attach to a literal
loopback CDP endpoint (for example `http://127.0.0.1:9333`) or launch an executable with a throwaway
profile (`capture_browser_scenario`). The setup used for the Adobe investigation:

1. Copy the installed Adobe extension (`…\Chrome\User Data\Default\Extensions\efaidnbmnnnibpcajpcglclefindmkaj\26.10.1.0_0`)
   to the scratch directory. Remove `_metadata/` from the copy used at runtime: Chrome refuses to
   load an unpacked extension that has reserved `_`-prefixed folders. The manifest's `key` keeps
   the real extension ID.
2. Start **Playwright's Chromium 139** (`ms-playwright\chromium-1181`) with a temporary profile,
   `--load-extension`, `--disable-extensions-except` and `--remote-debugging-port`. The installed
   Google Chrome 155 can't be used. Branded Chrome ignores `--load-extension` (since Chrome 137)
   and refuses remote debugging on the default profile (since Chrome 136). The user's real Chrome
   profile was never attached to or modified.
3. Point `list_browser_targets` and the inspection and screenshot tools at that endpoint.

## Verification performed

| Check | Result |
|---|---|
| `binary_session` (complete status, no target) | Succeeded; it returned the identity, providers and availability above. The full JSON was 243 KB and was read with a script rather than inline. |
| Skill and server version agreement | The skill expects server skill version 37 and the server reports the same skill name. No staleness warning. |
| Static JS analysis on a real target | Run by the static-analysis track on the Adobe extension copy (report 03, kept private and not published here) |
| CDP attachment, page inspection and screenshots | Run by the runtime track (report 04, section "REA capability probe results"; kept private and not published here) |

## Limitations and observations

- The REA skill documents browser discovery as listing **HTTP(S) page targets**. Extension pages
  (`chrome-extension://…`: the popup, the viewer, the service worker) may therefore be invisible
  to `list_browser_targets` and the tools built on it. The runtime track probes this explicitly.
  Where REA can't see a target, screenshots come from Playwright/CDP and are labelled as an
  **alternative method**, not REA evidence.
- REA runtime observation is passive: it never clicks or navigates for you, except in
  `capture_browser_scenario`. Interactions in the runtime track were driven by Playwright and
  observed with REA where possible.
- REA evidence IDs live in the REA server session. The reports quote the relevant excerpts inline
  so the findings stay readable after this session ends.
- One shell command in this session (concatenating files inside the downloaded PdfCraft source
  archive) was refused by Claude Code's auto-mode safety classifier as "untrusted code
  integration". The same files were then read with the read-only file tools. Nothing was executed
  from downloaded archives.
- The GitHub MCP server failed to connect at session start (authorization header error). This is
  irrelevant here: the task forbids Git/GitHub workflows, and PdfCraft's source and release were
  fetched as HTTPS downloads instead.
