// Pure helpers shared by the service worker, the viewer and the popup. No chrome.* calls here,
// so tests/unit can import this module under Node.

export const VIEWER_PATH = 'viewer/viewer.html';
const FILE_PARAM = 'file=';

/** PdfCraft's workspaces ("modes"), as its settings name them. */
export const MODES = ['all', 'read', 'edit', 'convert', 'sign'];

/**
 * The viewer URL for a document URL (or none), optionally opening in a PdfCraft workspace, e.g.
 * chrome-extension://<id>/viewer/viewer.html?mode=edit&file=https%3A…
 * `file` is always the last parameter: see documentUrlFromViewer.
 */
export function viewerUrl(extensionBase, documentUrl, { mode } = {}) {
  const params = [];
  if (mode && MODES.includes(mode)) params.push(`mode=${mode}`);
  if (documentUrl) params.push(`${FILE_PARAM}${encodeURIComponent(documentUrl)}`);
  return `${extensionBase}${VIEWER_PATH}${params.length ? `?${params.join('&')}` : ''}`;
}

/** Where the document URL starts in a viewer URL, or -1. */
function fileParamAt(viewerHref) {
  const match = /[?&]file=/.exec(viewerHref);
  return match ? match.index + 1 : -1;
}

/** The workspace a viewer URL asks for, or null. Only parameters before `file=` count. */
export function modeFromViewer(viewerHref) {
  const at = fileParamAt(viewerHref);
  const query = viewerHref.slice(viewerHref.indexOf('?') + 1, at < 0 ? undefined : at);
  if (viewerHref.indexOf('?') < 0) return null;
  const mode = new URLSearchParams(query.split('#')[0]).get('mode');
  return MODES.includes(mode) ? mode : null;
}

/**
 * The document URL a viewer URL points at, or null.
 *
 * Two spellings reach the viewer: URLs we build (encoded with encodeURIComponent) and URLs the
 * declarativeNetRequest redirect builds with a `\0` substitution, which appends the original URL
 * unencoded. Everything after the first `file=` parameter is the document URL, so an unencoded URL keeps
 * its own query string and fragment intact.
 */
export function documentUrlFromViewer(viewerHref) {
  const at = fileParamAt(viewerHref);
  if (at < 0) return null;
  let raw = viewerHref.slice(at + FILE_PARAM.length);
  if (/^(https?|file|blob)%3A/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return isOpenableUrl(raw) ? raw : null;
}

/** http(s) and file URLs are the documents the viewer can fetch. */
export function isOpenableUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
  } catch {
    return false;
  }
}

/** True for a URL whose path ends in .pdf (query and fragment ignored). */
export function looksLikePdfUrl(url) {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** True when a Content-Type header value names a PDF. */
export function isPdfContentType(value) {
  if (!value) return false;
  const type = value.split(';')[0].trim().toLowerCase();
  return type === 'application/pdf' || type === 'application/x-pdf' || type === 'application/acrobat';
}

/** True when the bytes start like a PDF. Readers accept the header within the first 1024 bytes. */
export function hasPdfSignature(bytes) {
  const head = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) {
      return true; // "%PDF-"
    }
  }
  return false;
}

/** The filename from a Content-Disposition header (RFC 6266 filename* first), or null. */
export function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return cleanFilename(decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')));
    } catch {
      // fall through to the plain parameter
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  if (plain) return cleanFilename((plain[2] ?? plain[1]).trim());
  return null;
}

/** The last path segment of a URL, decoded, or null. */
export function filenameFromUrl(url) {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment ? cleanFilename(decodeURIComponent(segment)) : null;
  } catch {
    return null;
  }
}

/** A filename safe for chrome.downloads and display: no path separators or control characters, ends in .pdf. */
export function pdfFilename(...candidates) {
  const name = candidates.find((c) => c && c.trim()) ?? 'document.pdf';
  const clean = cleanFilename(name) || 'document.pdf';
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
}

function cleanFilename(name) {
  return name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 200);
}

/** A short human description of a byte count. */
export function formatBytes(count) {
  if (count < 1024) return `${count} B`;
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(0)} KB`;
  return `${(count / (1024 * 1024)).toFixed(1)} MB`;
}
