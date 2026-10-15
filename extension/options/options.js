import { loadSettings, saveSettings } from '../lib/settings.js';
import { localize, t } from '../ui/i18n.js';
import { applyTheme } from '../ui/theme.js';

applyTheme();
localize();

const manifest = chrome.runtime.getManifest();
document.getElementById('versions').textContent = t('optVersions', [manifest.version, manifest.version_name.match(/PdfCraft ([\d.]+)/)?.[1] ?? '?']);

const settings = await loadSettings();
for (const input of document.querySelectorAll('[data-setting]')) {
  const key = input.dataset.setting;
  if (input.type === 'checkbox') input.checked = Boolean(settings[key]);
  else input.value = settings[key];
  input.addEventListener('change', async () => {
    await saveSettings({ [key]: input.type === 'checkbox' ? input.checked : input.value });
    toast(t('optSaved'));
  });
}

// Local PDFs need Chrome's per-extension "Allow access to file URLs" switch, which only the user can turn on.
const allowed = await chrome.extension.isAllowedFileSchemeAccess();
document.getElementById('file-access-row').hidden = allowed;
document.getElementById('btn-file-access').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

let timer;
function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => (el.hidden = true), 2000);
}
