// Fills data-i18n* attributes from _locales/<lang>/messages.json.

export function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

export function localize(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  document.documentElement.lang = chrome.i18n.getUILanguage();
}
