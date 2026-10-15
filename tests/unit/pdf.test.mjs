import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  documentUrlFromViewer,
  filenameFromDisposition,
  filenameFromUrl,
  hasPdfSignature,
  isOpenableUrl,
  isPdfContentType,
  looksLikePdfUrl,
  pdfFilename,
  viewerUrl,
} from '../../extension/lib/pdf.js';
import { bypassRule, redirectRules } from '../../extension/lib/rules.js';
import { makePdf } from '../fixtures/make-pdf.mjs';

const BASE = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

test('viewerUrl and documentUrlFromViewer round-trip, encoded', () => {
  const doc = 'https://example.com/a b/report.pdf?x=1&y=2#page=3';
  const url = viewerUrl(BASE, doc);
  assert.equal(url, `${BASE}pdfcraft.html?file=${encodeURIComponent(doc)}`);
  assert.equal(documentUrlFromViewer(url), doc);
});

test('documentUrlFromViewer keeps an unencoded URL from the redirect rule whole', () => {
  // The declarativeNetRequest \0 substitution appends the URL as it is.
  const doc = 'https://example.com/report.pdf?x=1&file=2#page=3';
  assert.equal(documentUrlFromViewer(`${BASE}pdfcraft.html?file=${doc}`), doc);
});

test('documentUrlFromViewer rejects missing and unsupported URLs', () => {
  assert.equal(documentUrlFromViewer(`${BASE}pdfcraft.html`), null);
  assert.equal(documentUrlFromViewer(`${BASE}pdfcraft.html?file=javascript:alert(1)`), null);
  assert.equal(documentUrlFromViewer(`${BASE}pdfcraft.html?file=${encodeURIComponent('data:application/pdf,x')}`), null);
  assert.equal(documentUrlFromViewer(`${BASE}pdfcraft.html?file=https%3A%E0%A4%A`), null);
});

test('file URLs are openable, other schemes are not', () => {
  assert.ok(isOpenableUrl('file:///C:/docs/a.pdf'));
  assert.ok(isOpenableUrl('http://x/a.pdf'));
  assert.ok(!isOpenableUrl('chrome://settings'));
  assert.ok(!isOpenableUrl('not a url'));
});

test('looksLikePdfUrl ignores query and fragment', () => {
  assert.ok(looksLikePdfUrl('https://x/a/b.PDF?download=1#p'));
  assert.ok(!looksLikePdfUrl('https://x/a/b.pdf.html'));
  assert.ok(!looksLikePdfUrl('https://x/?f=a.pdf'));
});

test('isPdfContentType', () => {
  assert.ok(isPdfContentType('application/pdf'));
  assert.ok(isPdfContentType('Application/PDF; charset=binary'));
  assert.ok(isPdfContentType('application/x-pdf'));
  assert.ok(!isPdfContentType('application/octet-stream'));
  assert.ok(!isPdfContentType(null));
});

test('hasPdfSignature finds %PDF- within the first 1024 bytes only', () => {
  assert.ok(hasPdfSignature(makePdf()));
  assert.ok(hasPdfSignature(Buffer.concat([Buffer.alloc(100, 0x20), makePdf()])));
  assert.ok(!hasPdfSignature(Buffer.concat([Buffer.alloc(2000, 0x20), makePdf()])));
  assert.ok(!hasPdfSignature(Buffer.from('<html>%PDF</html>')));
  assert.ok(!hasPdfSignature(new Uint8Array()));
});

test('filenameFromDisposition prefers filename* and strips paths', () => {
  assert.equal(filenameFromDisposition('attachment; filename="a.pdf"'), 'a.pdf');
  assert.equal(filenameFromDisposition("inline; filename=\"x.pdf\"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf"), 'Résumé.pdf');
  assert.equal(filenameFromDisposition('attachment; filename=../../evil.pdf'), '_.._evil.pdf');
  assert.equal(filenameFromDisposition('inline'), null);
  assert.equal(filenameFromDisposition(null), null);
});

test('filenameFromUrl and pdfFilename', () => {
  assert.equal(filenameFromUrl('https://x/docs/Annual%20report.pdf?x=1'), 'Annual report.pdf');
  assert.equal(filenameFromUrl('https://x/'), null);
  assert.equal(pdfFilename(null, 'download'), 'download.pdf');
  assert.equal(pdfFilename('', null), 'document.pdf');
  assert.equal(pdfFilename('a:b?.PDF'), 'a_b_.PDF');
});

test('redirect rules target the viewer and skip attachments', () => {
  const rules = redirectRules(BASE);
  assert.equal(rules.length, 2);
  for (const rule of rules) {
    assert.equal(rule.action.redirect.regexSubstitution, `${BASE}pdfcraft.html?file=\\0`);
    assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
    assert.deepEqual(rule.condition.excludedResponseHeaders, [{ header: 'content-disposition', values: ['attachment*'] }]);
  }
  assert.equal(redirectRules(BASE, { octetStream: false }).length, 1);
  const octet = new RegExp(rules[1].condition.regexFilter);
  assert.ok(octet.test('https://x/a.pdf'));
  assert.ok(octet.test('https://x/a.PDF?x=1'));
  assert.ok(!octet.test('https://x/a.pdf.zip'));
  assert.ok(!octet.test('https://x/download?f=a.pdf'));
});

test('bypassRule allows one tab with a higher priority', () => {
  const rule = bypassRule(42);
  assert.equal(rule.id, 1042);
  assert.equal(rule.action.type, 'allow');
  assert.deepEqual(rule.condition.tabIds, [42]);
  assert.ok(rule.priority > redirectRules(BASE)[0].priority);
});

test('makePdf writes a well-formed xref', () => {
  const pdf = makePdf({ pages: 3 }).toString('latin1');
  const startxref = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), 'xref');
  for (const [, offset, n] of pdf.matchAll(/(\d{10}) 00000 n /g).map((m, i) => [m, Number(m[1]), i + 1])) {
    assert.equal(pdf.slice(offset, offset + `${n} 0 obj`.length), `${n} 0 obj`);
  }
});

test('viewer URLs carry an optional workspace before the document', async () => {
  const { modeFromViewer } = await import('../../extension/lib/pdf.js');
  const doc = 'https://x/a.pdf?mode=read&file=1';
  const url = viewerUrl(BASE, doc, { mode: 'edit' });
  assert.equal(url, `${BASE}pdfcraft.html?mode=edit&file=${encodeURIComponent(doc)}`);
  assert.equal(modeFromViewer(url), 'edit');
  assert.equal(documentUrlFromViewer(url), doc);
  // The document's own mode= parameter (unencoded, after file=) is not the viewer's.
  assert.equal(modeFromViewer(`${BASE}pdfcraft.html?file=${doc}`), null);
  assert.equal(viewerUrl(BASE, null, { mode: 'sign' }), `${BASE}pdfcraft.html?mode=sign`);
  assert.equal(modeFromViewer(`${BASE}pdfcraft.html?mode=sign`), 'sign');
  assert.equal(viewerUrl(BASE, null, { mode: 'bogus' }), `${BASE}pdfcraft.html`);
  assert.equal(modeFromViewer(`${BASE}pdfcraft.html?mode=bogus`), null);
});

test('redirect rules only apply to GET requests', () => {
  for (const rule of redirectRules(BASE)) assert.deepEqual(rule.condition.requestMethods, ['get']);
});
