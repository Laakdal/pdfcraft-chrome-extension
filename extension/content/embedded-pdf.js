// "Open in PdfCraft" on PDFs embedded in web pages (<embed>, <object>, <iframe>).
//
// Chrome shows an embedded PDF in its own viewer, inside a frame whose document has the content
// type application/pdf, and extensions can't replace that viewer. Like Acrobat's extension
// (docs/investigation/05-design-and-comparison.md, A7), this script runs in every frame and, in
// such a PDF frame, adds a round button at the bottom right that opens the document in a PdfCraft
// tab. Hovering shows its label and a button to hide it on this page.
//
// The button lives in a closed shadow root with a constructed stylesheet, so neither the page's
// CSS nor its Content Security Policy can change or block it.

(() => {
  if (window.top === window || window.__pdfcraftEmbedded) return;
  if (!/^application\/(x-)?pdf$/i.test(document.contentType)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.__pdfcraftEmbedded = true;

  let host = null;

  function create() {
    host = document.createElement('pdfcraft-embedded-button');
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { all: initial; position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; }
      .wrap { display: flex; align-items: center; gap: 6px; font: 600 13px/1 Inter, 'Segoe UI', system-ui, sans-serif; }
      .open {
        display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 4px;
        border: 1px solid #dadade; border-radius: 20px; background: #fff; color: #222226; font: inherit;
        cursor: pointer; box-shadow: 0 4px 16px rgb(0 0 0 / 22%), 0 1px 3px rgb(0 0 0 / 14%);
      }
      .open img { width: 30px; height: 30px; border-radius: 50%; }
      .label { display: none; padding-right: 10px; white-space: nowrap; }
      .hide {
        display: none; width: 24px; height: 24px; border: 0; border-radius: 50%; padding: 0;
        background: rgb(0 0 0 / 55%); color: #fff; font: 600 14px/24px system-ui, sans-serif; cursor: pointer;
      }
      .wrap:hover .label, .open:focus-visible .label { display: inline; }
      .wrap:hover .hide, .wrap:focus-within .hide { display: inline-block; }
      .open:hover { background: #f0f0f3; }
      .open:focus-visible, .hide:focus-visible { outline: 2px solid #1b63e0; outline-offset: 2px; }
      @media (prefers-color-scheme: dark) {
        .open { background: #26262a; color: #ececef; border-color: #3c3c43; }
        .open:hover { background: #2f2f34; }
      }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const hide = document.createElement('button');
    hide.className = 'hide';
    hide.type = 'button';
    hide.textContent = '×';
    hide.title = chrome.i18n.getMessage('embeddedHide');
    hide.setAttribute('aria-label', hide.title);
    hide.addEventListener('click', () => host.remove());

    const open = document.createElement('button');
    open.className = 'open';
    open.type = 'button';
    open.title = chrome.i18n.getMessage('embeddedOpenTip');
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/pdfcraft-64.png');
    icon.alt = '';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = chrome.i18n.getMessage('embeddedOpen');
    open.append(icon, label);
    open.setAttribute('aria-label', label.textContent);
    open.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-url', url: location.href }));

    wrap.append(hide, open);
    shadow.append(wrap);
    document.documentElement.append(host);
  }

  function apply(settings) {
    const enabled = settings?.embeddedButton ?? true;
    if (enabled && !host) create();
    else if (!enabled && host) {
      host.remove();
      host = null;
    }
  }

  chrome.storage.local.get('settings').then(({ settings }) => apply(settings));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) apply(changes.settings.newValue);
  });
})();
