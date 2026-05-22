import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createStorageAdapter,
  exportFeaturesToCsv,
  featureKey,
  filterFeatures,
  matchVendorsToFeatures,
  parseMatrixFeatures,
  PLANS,
  summarizeCoverage
} from '../src/logic.js';

const metadataFeatures = JSON.parse(await readFile(new URL('../data/features.json', import.meta.url), 'utf8'));
const matrixCsv = await readFile(new URL('../Microsoft-365-Matrix-Export.csv', import.meta.url), 'utf8');
const features = parseMatrixFeatures(matrixCsv, metadataFeatures);

test('matrix export parses expected top-level categories', () => {
  const categories = new Set(features.map((feature) => feature.category));
  for (const category of ['Office 365', 'Enterprise Mobility + Security', 'Windows', 'Suite Value', 'Related Services']) {
    assert.equal(categories.has(category), true, `${category} is present`);
  }
});

test('matrix export only exposes Microsoft 365 target plans', () => {
  assert.deepEqual(PLANS, ['E3', 'E5', 'E7']);
  assert.ok(features.length > 500);
  assert.ok(features.every((feature) => !Object.hasOwn(feature.coverage, 'E1')));
  assert.ok(features.every((feature) => Object.keys(feature.coverage).join(',') === 'E3,E5,E7'));
});

test('vendor matching maps known vendors and keeps unmapped vendors', () => {
  const result = matchVendorsToFeatures(['Okta', 'Unknown Tool'], features);
  assert.equal(result.unmapped.includes('Unknown Tool'), true);
  assert.equal(result.recognized.includes('Okta'), true);
  assert.equal([...result.mapped.values()].some((vendors) => vendors.includes('Okta')), true);
});

test('manual vendor overrides map a vendor to a specific feature', () => {
  const row = features.find((feature) => feature.name === 'Safe Attachments');
  const key = featureKey(row);
  const result = matchVendorsToFeatures(['Unknown Tool'], [row], { [key]: 'Proofpoint; Mimecast' });

  assert.deepEqual(result.mapped.get(key), ['Proofpoint', 'Mimecast']);
  assert.deepEqual(result.unmapped, ['Unknown Tool']);
});

test('feature filtering supports plan, category, search, and filled-only filters', () => {
  const matches = matchVendorsToFeatures(['Proofpoint'], features);
  const matchedKeys = new Set(matches.mapped.keys());
  const filtered = filterFeatures(features, {
    category: 'Office 365',
    query: 'Threat',
    plan: 'E5',
    filledOnly: true
  }, matchedKeys);

  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((feature) => feature.category === 'Office 365'));
  assert.ok(filtered.every((feature) => /threat/i.test(`${feature.name} ${feature.notes}`)));
  assert.ok(filtered.every((feature) => feature.coverage.E5));
  assert.ok(filtered.every((feature) => matchedKeys.has(featureKey(feature))));
});

test('coverage summary counts unique covered vendors by target plan', () => {
  const summary = summarizeCoverage(['CrowdStrike', 'Proofpoint', 'Unknown Tool'], features);
  assert.equal(summary.plans.E5.totalCount, 3);
  assert.ok(summary.plans.E5.coveredCount >= 2);
  assert.ok(summary.plans.E5.percent >= summary.plans.E3.percent);
  assert.deepEqual(summary.unmapped, ['Unknown Tool']);
});

test('coverage summary includes manual vendor overrides', () => {
  const row = features.find((feature) => feature.name === 'Safe Attachments');
  const summary = summarizeCoverage([], [row], { [featureKey(row)]: 'Proofpoint' });

  assert.equal(summary.plans.E5.totalCount, 1);
  assert.equal(summary.plans.E5.coveredCount, 1);
});

test('CSV export includes attribution, filtered rows, coverage, vendors, and status', () => {
  const row = features.find((feature) => feature.name === 'Safe Attachments');
  const key = featureKey(row);
  const csv = exportFeaturesToCsv([row], ['Proofpoint'], { [key]: 'gap — need to evaluate' }, new Date('2026-05-22T13:57:21.706Z'), { [key]: 'Mimecast' });
  assert.match(csv, /^# Exported 2026-05-22T13:57:21.706Z \| Feature data sourced from M365 Maps by Aaron Dinnage/);
  assert.match(csv, /Office 365,Safe Attachments,Defender for Office 365 Plan 1,Proofpoint; Mimecast,Mimecast,Included,Included,Included/);
  assert.match(csv, /gap — need to evaluate/);
});

test('selected licensing rows match validated M365 Maps corrections', () => {
  const byName = new Map(features.map((feature) => [feature.name, feature]));

  assert.equal(byName.get('Defender for Office 365 Plan 1').coverage.E3, true);
  assert.equal(byName.get('Safe Links').coverage.E3, true);
  assert.equal(byName.get('Safe Attachments').coverage.E3, true);
  assert.equal(byName.get('Defender Vulnerability Management (core)').coverage.E7, true);
  assert.equal(byName.get('Data Lifecycle Management').coverage.E3, false);
  assert.equal(byName.get('Microsoft Teams').coverage.E7, 'Optional');
});

test('matrix export can be filtered by external exclusions without editing the export', () => {
  const filteredFeatures = parseMatrixFeatures(matrixCsv, metadataFeatures, new Set(['Minecraft Education Edition']));

  assert.equal(filteredFeatures.some((feature) => feature.name === 'Minecraft Education Edition'), false);
});

test('storage adapter persists, loads, and resets local state', () => {
  const store = new Map();
  const fakeStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key)
  };
  const adapter = createStorageAdapter(fakeStorage, 'test-key');
  adapter.save({ vendors: ['Okta'], activePlan: 'E5', hiddenPlans: ['E7'], manualVendors: { feature: 'ManualCo' } });
  assert.deepEqual(adapter.load().vendors, ['Okta']);
  assert.equal(adapter.load().activePlan, 'E5');
  assert.deepEqual(adapter.load().hiddenPlans, ['E7']);
  assert.deepEqual(adapter.load().manualVendors, { feature: 'ManualCo' });
  assert.deepEqual(adapter.reset().vendors, []);
  assert.deepEqual(adapter.reset().hiddenPlans, []);
  assert.deepEqual(adapter.reset().manualVendors, {});
  assert.equal(store.has('test-key'), false);
});

test('storage adapter removes retired plans from saved state', () => {
  const store = new Map([['test-key', JSON.stringify({ activePlan: 'E1', hiddenPlans: ['E1', 'E7'] })]]);
  const fakeStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key)
  };
  const adapter = createStorageAdapter(fakeStorage, 'test-key');

  assert.equal(adapter.load().activePlan, 'All');
  assert.deepEqual(adapter.load().hiddenPlans, ['E7']);
});
