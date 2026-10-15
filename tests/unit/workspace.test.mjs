import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareWorkspace } from '../../extension/lib/workspace.js';

class Storage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  json(k) {
    return JSON.parse(this.getItem(k));
  }
}

test('a requested workspace is set and the user’s choice remembered', () => {
  const s = new Storage({ pdfcraft: JSON.stringify({ theme: 'dark', default_mode: 'read' }) });
  prepareWorkspace('edit', s);
  assert.deepEqual(s.json('pdfcraft'), { theme: 'dark', default_mode: 'edit' });
  assert.deepEqual(s.json('pdfcraftForChrome.mode'), { forced: 'edit', previous: 'read' });
});

test('the next start puts the user’s choice back', () => {
  const s = new Storage({ pdfcraft: JSON.stringify({ theme: 'dark', default_mode: 'read' }) });
  prepareWorkspace('edit', s);
  // PdfCraft ran and saved the forced value back, along with other changes.
  s.setItem('pdfcraft', JSON.stringify({ theme: 'light', default_mode: 'edit' }));
  prepareWorkspace(null, s);
  assert.deepEqual(s.json('pdfcraft'), { theme: 'light', default_mode: 'read' });
  assert.equal(s.getItem('pdfcraftForChrome.mode'), null);
});

test('a choice the user made in PdfCraft meanwhile is kept', () => {
  const s = new Storage({ pdfcraft: JSON.stringify({ default_mode: 'read' }) });
  prepareWorkspace('edit', s);
  s.setItem('pdfcraft', JSON.stringify({ default_mode: 'convert' }));
  prepareWorkspace(null, s);
  assert.deepEqual(s.json('pdfcraft'), { default_mode: 'convert' });
});

test('back-to-back requests restore first, then force', () => {
  const s = new Storage({ pdfcraft: JSON.stringify({ default_mode: 'all' }) });
  prepareWorkspace('edit', s);
  prepareWorkspace('sign', s);
  assert.deepEqual(s.json('pdfcraft'), { default_mode: 'sign' });
  assert.deepEqual(s.json('pdfcraftForChrome.mode'), { forced: 'sign', previous: 'all' });
});

test('first run: no PdfCraft settings yet', () => {
  const s = new Storage();
  prepareWorkspace('sign', s);
  assert.deepEqual(s.json('pdfcraft'), { default_mode: 'sign' });
  s.setItem('pdfcraft', JSON.stringify({ theme: 'system', default_mode: 'sign' }));
  prepareWorkspace(null, s);
  assert.deepEqual(s.json('pdfcraft'), { theme: 'system' });
});

test('no request and nothing to restore changes nothing', () => {
  const s = new Storage({ pdfcraft: '{"default_mode":"read"}' });
  prepareWorkspace(null, s);
  assert.equal(s.getItem('pdfcraft'), '{"default_mode":"read"}');
  prepareWorkspace('read', s);
  assert.equal(s.getItem('pdfcraftForChrome.mode'), null);
});

test('corrupt JSON is ignored', () => {
  const s = new Storage({ pdfcraft: '{not json', 'pdfcraftForChrome.mode': 'also not' });
  prepareWorkspace('edit', s);
  assert.deepEqual(s.json('pdfcraft'), { default_mode: 'edit' });
});
