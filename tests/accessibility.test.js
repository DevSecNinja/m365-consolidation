import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('feature matrix has keyboard reachable controls and table semantics', () => {
  assert.match(html, /<a class="skip-link" href="#feature-table">/);
  assert.match(html, /<div id="category-tabs" class="tabs" role="tablist"/);
  assert.match(html, /<fieldset class="plan-visibility">/);
  assert.match(html, /<caption>Microsoft 365 feature coverage by plan/);
  assert.match(html, /<tr id="feature-headings"><\/tr>/);
});

test('focus styles and contrast-oriented tokens are present', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /--green: #107c41/);
  assert.match(css, /--red: #b42318/);
  assert.match(css, /color-scheme: light dark/);
});
