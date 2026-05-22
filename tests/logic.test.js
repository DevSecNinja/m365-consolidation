import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CATEGORIES,
  createStorageAdapter,
  exportFeaturesToCsv,
  featureKey,
  filterFeatures,
  matchVendorsToFeatures,
  summarizeCoverage
} from '../src/logic.js';

const features = JSON.parse(await readFile(new URL('../data/features.json', import.meta.url), 'utf8'));

test('feature data covers required MVP categories', () => {
  const categories = new Set(features.map((feature) => feature.category));
  for (const category of CATEGORIES) assert.equal(categories.has(category), true, `${category} is present`);
});

test('vendor matching maps known vendors and keeps unmapped vendors', () => {
  const result = matchVendorsToFeatures(['Okta', 'Unknown Tool'], features);
  assert.equal(result.unmapped.includes('Unknown Tool'), true);
  assert.equal(result.recognized.includes('Okta'), true);
  assert.equal([...result.mapped.values()].some((vendors) => vendors.includes('Okta')), true);
});

test('feature filtering supports plan, category, search, uplift, and filled-only filters', () => {
  const matches = matchVendorsToFeatures(['Proofpoint'], features);
  const matchedKeys = new Set(matches.mapped.keys());
  const filtered = filterFeatures(features, {
    category: 'Email Security',
    query: 'Safe',
    plan: 'E5',
    e5UpliftOnly: true,
    filledOnly: true
  }, matchedKeys);

  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((feature) => feature.category === 'Email Security'));
  assert.ok(filtered.every((feature) => /safe/i.test(`${feature.name} ${feature.notes}`)));
  assert.ok(filtered.every((feature) => !feature.coverage.E3 && feature.coverage.E5));
  assert.ok(filtered.every((feature) => matchedKeys.has(featureKey(feature))));
});

test('coverage summary counts unique covered vendors by target plan', () => {
  const summary = summarizeCoverage(['CrowdStrike', 'Proofpoint', 'Unknown Tool'], features);
  assert.equal(summary.plans.E5.totalCount, 3);
  assert.ok(summary.plans.E5.coveredCount >= 2);
  assert.ok(summary.plans.E5.percent >= summary.plans.E3.percent);
  assert.deepEqual(summary.unmapped, ['Unknown Tool']);
});

test('CSV export includes attribution, filtered rows, coverage, vendors, and status', () => {
  const row = features.find((feature) => feature.name === 'Safe Attachments');
  const key = featureKey(row);
  const csv = exportFeaturesToCsv([row], ['Proofpoint'], { [key]: 'gap — need to evaluate' }, new Date('2026-05-22T13:57:21.706Z'));
  assert.match(csv, /^# Exported 2026-05-22T13:57:21.706Z \| Feature data sourced from M365 Maps by Aaron Dinnage/);
  assert.match(csv, /Email Security,Safe Attachments,Defender for Office 365 Plan 1,Proofpoint,Not included,Included,Included/);
  assert.match(csv, /gap — need to evaluate/);
});

test('storage adapter persists, loads, and resets local state', () => {
  const store = new Map();
  const fakeStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key)
  };
  const adapter = createStorageAdapter(fakeStorage, 'test-key');
  adapter.save({ vendors: ['Okta'], activePlan: 'E5' });
  assert.deepEqual(adapter.load().vendors, ['Okta']);
  assert.equal(adapter.load().activePlan, 'E5');
  assert.deepEqual(adapter.reset().vendors, []);
  assert.equal(store.has('test-key'), false);
});
