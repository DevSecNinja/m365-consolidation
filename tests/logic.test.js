import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createStorageAdapter,
  exportFeaturesToCsv,
  featureKey,
  filterFeatures,
  getBusinessCapability,
  getBusinessFunction,
  getBusinessValue,
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

test('business view labels are loaded from metadata with feature-name fallbacks', () => {
  const safeAttachments = features.find((feature) => feature.name === 'Safe Attachments');
  const agent365 = features.find((feature) => feature.name === 'Agent 365');
  const oneDrive = features.find((feature) => feature.name === 'OneDrive');

  assert.equal(getBusinessCapability(safeAttachments), 'Office 365 Protection');
  assert.equal(getBusinessFunction(safeAttachments), 'Opens suspicious attachments in a sandbox before delivery.');
  assert.equal(getBusinessValue(safeAttachments), 'Reduces malware risk from weaponized email attachments.');
  assert.equal(getBusinessFunction(oneDrive), 'Provides personal file storage, sync, sharing, and recovery for users.');
  assert.equal(getBusinessCapability(agent365), agent365.category);
  assert.equal(getBusinessFunction(agent365), 'Agent 365');
  assert.equal(getBusinessValue(agent365), 'Agent 365');
});

test('manual vendor overrides map a vendor to a specific feature', () => {
  const row = features.find((feature) => feature.name === 'Safe Attachments');
  const key = featureKey(row);
  const result = matchVendorsToFeatures(['Unknown Tool'], [row], { [key]: 'Proofpoint; Mimecast' });

  assert.deepEqual(result.mapped.get(key), ['Proofpoint', 'Mimecast']);
  assert.deepEqual(result.unmapped, ['Unknown Tool']);
});

test('feature filtering supports plan, category, search, availability, and filled-only filters', () => {
  const matches = matchVendorsToFeatures(['Proofpoint'], features);
  const matchedKeys = new Set(matches.mapped.keys());
  const filtered = filterFeatures(features, {
    category: 'Office 365',
    query: 'Threat',
    plan: 'E5',
    availableOnly: true,
    visiblePlans: ['E3', 'E5'],
    filledOnly: true
  }, matchedKeys);

  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((feature) => feature.category === 'Office 365'));
  assert.ok(filtered.every((feature) => /threat/i.test(`${feature.name} ${feature.businessCapability} ${feature.businessFunction} ${feature.businessValue} ${feature.notes}`)));
  assert.ok(filtered.every((feature) => feature.coverage.E5));
  assert.ok(filtered.every((feature) => matchedKeys.has(featureKey(feature))));
});

test('feature filtering searches business value labels', () => {
  const filtered = filterFeatures(features, {
    category: 'Office 365',
    query: 'weaponized email attachments'
  });

  assert.equal(filtered.some((feature) => feature.name === 'Safe Attachments'), true);
});

test('availability filter hides rows not included in shown suites', () => {
  const filtered = filterFeatures(features, {
    availableOnly: true,
    visiblePlans: ['E3', 'E5']
  });

  assert.equal(filtered.some((feature) => feature.name === 'Agent 365'), false);
  assert.equal(filtered.some((feature) => feature.name === 'Defender for Endpoint Plan 2'), true);
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

test('CSV export can use business value view columns', () => {
  const row = features.find((feature) => feature.name === 'Safe Attachments');
  const csv = exportFeaturesToCsv([row], ['Proofpoint'], {}, new Date('2026-05-22T13:57:21.706Z'), {}, { view: 'business' });

  assert.match(csv, /Business Capability,Function,Business Value,Microsoft Feature,Category,Current Vendor/);
  assert.doesNotMatch(csv.split('\n')[1], /Notes/);
  assert.match(csv, /Office 365 Protection,Opens suspicious attachments in a sandbox before delivery\.,Reduces malware risk from weaponized email attachments\.,Safe Attachments,Office 365,Proofpoint/);
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
  adapter.save({ vendors: ['Okta'], activePlan: 'E5', hiddenPlans: ['E7'], manualVendors: { feature: 'ManualCo' }, tableView: 'feature' });
  assert.deepEqual(adapter.load().vendors, ['Okta']);
  assert.equal(adapter.load().activePlan, 'E5');
  assert.deepEqual(adapter.load().hiddenPlans, ['E7']);
  assert.deepEqual(adapter.load().manualVendors, { feature: 'ManualCo' });
  assert.equal(adapter.load().tableView, 'feature');
  assert.deepEqual(adapter.reset().vendors, []);
  assert.deepEqual(adapter.reset().hiddenPlans, []);
  assert.deepEqual(adapter.reset().manualVendors, {});
  assert.equal(adapter.reset().tableView, 'business');
  assert.equal(store.has('test-key'), false);
});

test('storage adapter removes retired plans from saved state', () => {
  const store = new Map([['test-key', JSON.stringify({ activePlan: 'E1', hiddenPlans: ['E1', 'E7'], tableView: 'unknown' })]]);
  const fakeStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key)
  };
  const adapter = createStorageAdapter(fakeStorage, 'test-key');

  assert.equal(adapter.load().activePlan, 'All');
  assert.deepEqual(adapter.load().hiddenPlans, ['E7']);
  assert.equal(adapter.load().tableView, 'business');
});
