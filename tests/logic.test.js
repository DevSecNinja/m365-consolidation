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
  MATRIX_CATEGORY_HEADERS,
  normalizeText,
  parseCsv,
  parseMatrixFeatures,
  PLANS,
  PLAN_DIFFS,
  summarizeCoverage
} from '../src/logic.js';

function normalizeMetadataName(value) {
  return normalizeText(value).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

const metadataFeatures = JSON.parse(await readFile(new URL('../data/features.json', import.meta.url), 'utf8'));
const matrixCsv = await readFile(new URL('../Microsoft-365-Matrix-Export.csv', import.meta.url), 'utf8');
const features = parseMatrixFeatures(matrixCsv, metadataFeatures);

function isConciseSentence(value) {
  const text = String(value || '').trim();
  return text.length > 0 && /[.!?]$/.test(text) && text.split(/\s+/).length <= 18;
}

function isConciseLabel(value) {
  const text = String(value || '').trim();
  return text.split(/\s+/).filter(Boolean).length <= 14;
}

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

test('parsed features match the Microsoft-365-Matrix-Export.csv rows 1:1 (name + E3/E5/E7)', () => {
  // Independent re-read of the CSV using a self-contained symbol map.
  // Any drift between the parser and the source CSV (extra rows, missing rows,
  // mis-mapped coverage cells) will fail this test.
  const SYMBOLS = {
    '✔': true,
    '+': 'Add-on',
    'Δ': 'Available add-on',
    '⊡': 'Package only',
    '?': 'Unknown'
  };
  const cellToCoverage = (cell) => {
    const value = String(cell || '').trim();
    if (!value) return false;
    if (Object.hasOwn(SYMBOLS, value)) return SYMBOLS[value];
    return value;
  };
  const cleanName = (value) => String(value || '').replace(/^\ufeff/, '').trim();
  const stripHierarchy = (value) => cleanName(value).replace(/^(?:\s*>\s*)+/, '').trim();

  const rawRows = parseCsv(matrixCsv);
  const headerIndex = rawRows.findIndex((row) => cleanName(row[0]) === 'Feature');
  assert.notEqual(headerIndex, -1, 'CSV must contain a Feature header row');
  const headerCells = rawRows[headerIndex].slice(1, 4).map(cleanName);
  assert.deepEqual(headerCells, ['E3', 'E5', 'E7']);

  const expected = [];
  for (const row of rawRows.slice(headerIndex + 1)) {
    const rawCell = row[0];
    if (rawCell === undefined) continue;
    const name = stripHierarchy(rawCell);
    if (!name) continue;
    const cells = row.slice(1, 4);
    const isPlanHeaderRow = cells.map(cleanName).join('|') === 'E3|E5|E5';
    if (MATRIX_CATEGORY_HEADERS.has(name) || isPlanHeaderRow) continue;
    if (!cells.some((cell) => String(cell || '').trim())) continue;
    expected.push({
      name,
      coverage: {
        E3: cellToCoverage(cells[0]),
        E5: cellToCoverage(cells[1]),
        E7: cellToCoverage(cells[2])
      }
    });
  }

  // Parse with no metadata and no exclusions so the comparison is purely CSV-derived.
  const parsed = parseMatrixFeatures(matrixCsv, [], new Set());

  assert.equal(parsed.length, expected.length, `Parsed feature count (${parsed.length}) must equal CSV feature row count (${expected.length})`);

  const mismatches = [];
  for (let i = 0; i < expected.length; i += 1) {
    const exp = expected[i];
    const got = parsed[i];
    if (got.name !== exp.name) {
      mismatches.push(`row ${i}: name "${got.name}" !== "${exp.name}"`);
      continue;
    }
    for (const plan of ['E3', 'E5', 'E7']) {
      if (got.coverage[plan] !== exp.coverage[plan]) {
        mismatches.push(`"${exp.name}" ${plan}: parsed ${JSON.stringify(got.coverage[plan])} !== CSV ${JSON.stringify(exp.coverage[plan])}`);
      }
    }
  }
  assert.deepEqual(mismatches, [], `CSV/parser mismatches:\n  - ${mismatches.join('\n  - ')}`);
});

test('every matrix feature has a matching metadata entry in data/features.json', () => {
  const metadataKeys = new Set();
  for (const entry of metadataFeatures) {
    for (const name of [entry.name, ...(entry.aliases || [])]) {
      const key = normalizeText(name);
      if (key) metadataKeys.add(key);
      const stripped = normalizeMetadataName(name);
      if (stripped) metadataKeys.add(stripped);
    }
  }
  const uniqueMatrixNames = [...new Set(features.map((feature) => feature.name))];
  const unmapped = uniqueMatrixNames.filter((name) => {
    return !metadataKeys.has(normalizeText(name)) && !metadataKeys.has(normalizeMetadataName(name));
  });
  assert.deepEqual(unmapped, [], `Unmapped matrix features (missing from data/features.json):\n  - ${unmapped.join('\n  - ')}`);
});

test('metadata feature names and aliases are unique within data/features.json', () => {
  const owners = new Map();
  const duplicates = [];
  for (const entry of metadataFeatures) {
    for (const name of [entry.name, ...(entry.aliases || [])]) {
      const key = normalizeText(name);
      if (!key) continue;
      if (owners.has(key)) {
        duplicates.push(`"${name}" used by both "${owners.get(key)}" and "${entry.name}"`);
      } else {
        owners.set(key, entry.name);
      }
    }
  }
  assert.deepEqual(duplicates, [], `Duplicate metadata names/aliases:\n  - ${duplicates.join('\n  - ')}`);
});

test('every metadata entry has an explicit businessFunction and businessValue', () => {
  const missingFunction = metadataFeatures.filter((entry) => !entry.businessFunction || !String(entry.businessFunction).trim()).map((entry) => entry.name);
  const missingValue = metadataFeatures.filter((entry) => !entry.businessValue || !String(entry.businessValue).trim()).map((entry) => entry.name);
  assert.deepEqual(missingFunction, [], `Metadata entries missing businessFunction:\n  - ${missingFunction.join('\n  - ')}`);
  assert.deepEqual(missingValue, [], `Metadata entries missing businessValue:\n  - ${missingValue.join('\n  - ')}`);
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
  assert.equal(getBusinessFunction(safeAttachments), 'Email attachment sandboxing');
  assert.equal(getBusinessValue(safeAttachments), 'Reduces malware risk from weaponized email attachments.');
  assert.equal(getBusinessFunction(oneDrive), 'Personal cloud file storage, sync and sharing');
  assert.equal(getBusinessCapability(agent365), agent365.category);
  assert.equal(getBusinessFunction(agent365), 'AI agent management & governance');
  assert.equal(getBusinessValue(agent365), 'Brings security, identity, and governance to AI agents.');
});

test('business view has concise sub-capability and value copy for every parsed feature', () => {
  assert.equal(features.every((feature) => isConciseLabel(getBusinessFunction(feature))), true);
  assert.equal(features.every((feature) => isConciseSentence(getBusinessValue(feature))), true);
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

test('feature filtering can show only features added by higher plans', () => {
  const sampleFeatures = [
    { name: 'Base feature', category: 'Suite', coverage: { E3: true, E5: true, E7: true } },
    { name: 'E5 feature', category: 'Suite', coverage: { E3: false, E5: true, E7: true } },
    { name: 'E7 feature', category: 'Suite', coverage: { E3: false, E5: false, E7: true } },
    { name: 'Add-on in base', category: 'Suite', coverage: { E3: 'Add-on', E5: true, E7: true } },
    { name: 'Azure-billed E5', category: 'Suite', coverage: { E3: false, E5: 'Azure consumption', E7: 'Azure consumption' } }
  ];

  // Default: add-ons and Azure consumption are not treated as "covered" by the
  // plan/diff filters, so an add-on in the base plan still shows up as an E5
  // gain (the customer would pay extra to get it on E3 today).
  assert.deepEqual(
    filterFeatures(sampleFeatures, { planDiff: 'E5-over-E3' }).map((feature) => feature.name),
    ['E5 feature', 'Add-on in base']
  );
  assert.deepEqual(
    filterFeatures(sampleFeatures, { planDiff: 'E7-over-E5' }).map((feature) => feature.name),
    ['E7 feature']
  );

  // includeAddOns: an add-on in the base plan now counts as already-in-base, so
  // it drops out of the E5-over-E3 diff again.
  assert.deepEqual(
    filterFeatures(sampleFeatures, { planDiff: 'E5-over-E3', includeAddOns: true }).map((feature) => feature.name),
    ['E5 feature']
  );

  // includeAzureConsumption surfaces Azure-billed E5 services in the diff.
  assert.deepEqual(
    filterFeatures(sampleFeatures, { planDiff: 'E5-over-E3', includeAzureConsumption: true }).map((feature) => feature.name),
    ['E5 feature', 'Add-on in base', 'Azure-billed E5']
  );
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
  assert.match(csv, /Office 365 Protection,Email attachment sandboxing,Reduces malware risk from weaponized email attachments\.,Safe Attachments,Office 365,Proofpoint/);
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
  adapter.save({ vendors: ['Okta'], activePlan: 'E5', activePlanDiff: 'E5-over-E3', hiddenPlans: ['E7'], manualVendors: { feature: 'ManualCo' }, tableView: 'feature' });
  assert.deepEqual(adapter.load().vendors, ['Okta']);
  assert.equal(adapter.load().activePlan, 'E5');
  assert.equal(adapter.load().activePlanDiff, 'E5-over-E3');
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
  assert.equal(adapter.load().activePlanDiff, 'All');
  assert.deepEqual(adapter.load().hiddenPlans, ['E7']);
  assert.equal(adapter.load().tableView, 'business');
});

test('plan diff filter options are available for higher plan comparisons', () => {
  assert.deepEqual(PLAN_DIFFS.map((diff) => diff.value), ['All', 'E5-over-E3', 'E7-over-E5']);
});

test('hybrid parent rows expose hierarchy via depth, ancestry and isParent', () => {
  const byName = new Map(features.map((feature) => [`${feature.category}::${feature.parentFeature}::${feature.name}`, feature]));

  const dfo2 = features.find((f) => f.name === 'Defender for Office 365 Plan 2');
  assert.ok(dfo2, 'Defender for Office 365 Plan 2 row exists');
  assert.equal(dfo2.depth, 0);
  assert.equal(dfo2.isParent, true);
  assert.deepEqual(dfo2.ancestry, []);
  assert.equal(dfo2.category, 'Office 365');

  const dfo1 = features.find((f) => f.name === 'Defender for Office 365 Plan 1' && f.parentFeature === 'Defender for Office 365 Plan 2');
  assert.ok(dfo1, 'nested Defender for Office 365 Plan 1 row exists');
  assert.equal(dfo1.depth, 1);
  assert.equal(dfo1.isParent, true);
  assert.deepEqual(dfo1.ancestry, ['Defender for Office 365 Plan 2']);

  const anti = features.find((f) => f.name === 'Advanced Anti-Phishing');
  assert.ok(anti);
  assert.equal(anti.depth, 2);
  assert.equal(anti.isParent, false);
  assert.deepEqual(anti.ancestry, ['Defender for Office 365 Plan 2', 'Defender for Office 365 Plan 1']);

  // The deeply nested Entra ID chain should preserve full lineage.
  const mfa = features.find((f) => f.name === 'Multi-Factor Auth (MFA)');
  assert.ok(mfa);
  assert.ok(mfa.depth >= 4);
  assert.equal(mfa.ancestry[0], 'Entra ID Plan 2');
});

test('Related Services sub-categories are captured as subCategory, not as category', () => {
  // Intune Suite appears twice: once under EMS, once under Related Services > Security & Compliance.
  const occurrences = features.filter((f) => f.name === 'Intune Suite');
  assert.equal(occurrences.length, 2, 'Intune Suite occurs in two sections');

  const ems = occurrences.find((f) => f.category === 'Enterprise Mobility + Security');
  const related = occurrences.find((f) => f.category === 'Related Services');
  assert.ok(ems, 'EMS occurrence exists');
  assert.ok(related, 'Related Services occurrence exists');
  assert.equal(ems.subCategory, '');
  assert.equal(related.subCategory, 'Security & Compliance');

  // No feature should have category === parentFeature pointing at a top category (former sub-heading bug).
  for (const f of features) {
    if (f.category === 'Related Services' && f.depth === 0) {
      assert.notEqual(f.subCategory, '', `${f.name} under Related Services must have a subCategory`);
    }
  }
});
