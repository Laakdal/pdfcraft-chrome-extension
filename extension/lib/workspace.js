// Opening PdfCraft in a chosen workspace (All tools, Read, Edit, Convert, E-Sign).
//
// PdfCraft 0.8.0's web build has no URL parameter or message for this. It does read its settings
// from localStorage["pdfcraft"] (JSON, written by eframe) at start-up, and applies the
// `default_mode` setting to each document it opens. The viewer shares that origin, so it sets
// `default_mode` before PdfCraft starts. PdfCraft then saves that value back as if the user had
// chosen it, so the user's own preference is remembered in localStorage["pdfcraftForChrome.mode"]
// and put back on the next start, unless they changed it in PdfCraft in the meantime.

const SETTINGS_KEY = 'pdfcraft';
const BACKUP_KEY = 'pdfcraftForChrome.mode';

function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** Call before loading PdfCraft. `mode` is one of lib/pdf.js MODES, or null for the user's own default. */
export function prepareWorkspace(mode, storage = globalThis.localStorage) {
  const settings = read(storage, SETTINGS_KEY);
  const backup = read(storage, BACKUP_KEY);
  let changed = false;

  if (backup) {
    if (settings && settings.default_mode === backup.forced) {
      if (backup.previous == null) delete settings.default_mode;
      else settings.default_mode = backup.previous;
      changed = true;
    }
    storage.removeItem(BACKUP_KEY);
  }

  let next = settings;
  if (mode) {
    const previous = settings?.default_mode ?? null;
    if (previous !== mode) {
      next = { ...(settings ?? {}), default_mode: mode };
      storage.setItem(BACKUP_KEY, JSON.stringify({ forced: mode, previous }));
      changed = true;
    }
  }
  if (changed && next) storage.setItem(SETTINGS_KEY, JSON.stringify(next));
}
