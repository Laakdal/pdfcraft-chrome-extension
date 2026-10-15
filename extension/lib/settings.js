// User settings, kept in chrome.storage.local and shared by every extension page.

export const DEFAULT_SETTINGS = Object.freeze({
  /** Open PDF links and addresses in PdfCraft instead of Chrome's viewer. */
  openWebPdfs: true,
  /** Also catch PDFs a server mislabels as application/octet-stream when the path ends in .pdf.
   *  Off by default, like Acrobat's extension, which lets those download
   *  (docs/investigation/05-design-and-comparison.md, A3). */
  openOctetStreamPdfs: false,
  /** Open file:// PDFs in PdfCraft (needs "Allow access to file URLs" on chrome://extensions). */
  openLocalPdfs: true,
  /** Show the "Open in PdfCraft" button on PDFs embedded in web pages. */
  embeddedButton: true,
});

export async function loadSettings() {
  const stored = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings ?? {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
