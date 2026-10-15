// Follows PdfCraft's own theme setting, so the extension's pages match the app they host.
//
// PdfCraft keeps its settings in this origin's localStorage["pdfcraft"] (shared by every extension
// page). Its `theme` is Light by default; "System" follows the OS; Dark is dark. ui/tokens.css
// reads <html data-theme="light|dark">, and with no attribute follows prefers-color-scheme.

export function pdfcraftTheme(storage = globalThis.localStorage) {
  let theme;
  try {
    theme = JSON.parse(storage.getItem('pdfcraft') ?? 'null')?.theme;
  } catch {
    theme = null;
  }
  const value = String(theme ?? 'light').toLowerCase();
  if (value.includes('dark')) return 'dark';
  if (value.includes('system')) return 'system';
  return 'light';
}

export function applyTheme() {
  const theme = pdfcraftTheme();
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
