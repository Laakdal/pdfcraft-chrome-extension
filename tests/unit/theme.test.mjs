import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pdfcraftTheme } from '../../extension/ui/theme.js';

const storage = (value) => ({ getItem: () => value });

test('PdfCraft’s theme setting decides the extension’s theme', () => {
  assert.equal(pdfcraftTheme(storage(null)), 'light'); // PdfCraft's default
  assert.equal(pdfcraftTheme(storage('{"theme":"Light"}')), 'light');
  assert.equal(pdfcraftTheme(storage('{"theme":"Dark"}')), 'dark');
  assert.equal(pdfcraftTheme(storage('{"theme":"System"}')), 'system');
  assert.equal(pdfcraftTheme(storage('{"default_mode":"all"}')), 'light');
  assert.equal(pdfcraftTheme(storage('not json')), 'light');
});
