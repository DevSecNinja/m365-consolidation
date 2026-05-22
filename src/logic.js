export const PLANS = ['E1', 'E3', 'E5', 'E7'];
export const TARGET_PLANS = ['E3', 'E5', 'E7'];
export const CATEGORIES = [
  'Identity',
  'Email Security',
  'Endpoint Security',
  'Cloud Security',
  'Compliance & Data Governance',
  'Productivity',
  'Windows'
];
export const STATUSES = ['unchecked', 'already covered', 'not needed', 'gap — need to evaluate'];

export function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ');
}

export function featureKey(feature) {
  return `${feature.category}::${feature.parentFeature || ''}::${feature.name}`;
}

export function isCoveredValue(value) {
  return value === true || (typeof value === 'string' && value.trim().length > 0);
}

export function isFullyCoveredValue(value) {
  return value === true;
}

export function getCoverageLabel(value) {
  if (value === true) return 'Included';
  if (value === false || value === null || value === undefined || value === '') return 'Not included';
  return String(value);
}

export function coverageTone(feature, plan) {
  const value = feature.coverage?.[plan];
  if (value === true) {
    const lowerPlan = TARGET_PLANS.slice(0, TARGET_PLANS.indexOf(plan)).some((candidate) => isCoveredValue(feature.coverage?.[candidate]));
    return lowerPlan ? 'lower' : 'included';
  }
  if (isCoveredValue(value)) return 'partial';
  const higherPlan = TARGET_PLANS.slice(TARGET_PLANS.indexOf(plan) + 1).some((candidate) => isCoveredValue(feature.coverage?.[candidate]));
  return higherPlan ? 'upgrade' : 'not-included';
}

export function getKnownVendors(features) {
  return [...new Set(features.flatMap((feature) => feature.commonVendors || []))].sort((a, b) => a.localeCompare(b));
}

export function matchVendorsToFeatures(vendors, features) {
  const normalizedVendors = vendors.map((vendor) => ({ raw: vendor, normalized: normalizeText(vendor) })).filter((vendor) => vendor.normalized);
  const mapped = new Map();
  const recognized = new Set();

  for (const feature of features) {
    const featureVendors = (feature.commonVendors || []).map((vendor) => ({ raw: vendor, normalized: normalizeText(vendor) }));
    const matches = normalizedVendors
      .filter((vendor) => featureVendors.some((known) => known.normalized === vendor.normalized))
      .map((vendor) => vendor.raw);
    if (matches.length > 0) {
      mapped.set(featureKey(feature), matches);
      matches.forEach((vendor) => recognized.add(normalizeText(vendor)));
    }
  }

  return {
    mapped,
    recognized: normalizedVendors.filter((vendor) => recognized.has(vendor.normalized)).map((vendor) => vendor.raw),
    unmapped: normalizedVendors.filter((vendor) => !recognized.has(vendor.normalized)).map((vendor) => vendor.raw)
  };
}

export function filterFeatures(features, filters = {}, matchedFeatureKeys = new Set()) {
  const {
    category = 'All',
    query = '',
    plan = 'All',
    e5UpliftOnly = false,
    filledOnly = false,
    collapsedParents = new Set()
  } = filters;
  const normalizedQuery = normalizeText(query);

  return features.filter((feature) => {
    if (category !== 'All' && feature.category !== category) return false;
    if (normalizedQuery && !normalizeText(`${feature.name} ${feature.parentFeature} ${feature.notes}`).includes(normalizedQuery)) return false;
    if (plan !== 'All' && !isCoveredValue(feature.coverage?.[plan])) return false;
    if (e5UpliftOnly && isCoveredValue(feature.coverage?.E3)) return false;
    if (filledOnly && !matchedFeatureKeys.has(featureKey(feature))) return false;
    if (feature.parentFeature && collapsedParents.has(feature.parentFeature)) return false;
    return true;
  });
}

export function groupParents(features) {
  const parentCounts = new Map();
  for (const feature of features) {
    if (feature.parentFeature) parentCounts.set(feature.parentFeature, (parentCounts.get(feature.parentFeature) || 0) + 1);
  }
  return parentCounts;
}

export function summarizeCoverage(vendors, features) {
  const matches = matchVendorsToFeatures(vendors, features);
  const uniqueVendors = [...new Set(vendors.map(normalizeText).filter(Boolean))];
  const categorySummary = Object.fromEntries(CATEGORIES.map((category) => [category, Object.fromEntries(TARGET_PLANS.map((plan) => [plan, 0]))]));

  const planVendorCoverage = Object.fromEntries(TARGET_PLANS.map((plan) => [plan, new Set()]));
  for (const feature of features) {
    const matchedVendors = matches.mapped.get(featureKey(feature)) || [];
    for (const plan of TARGET_PLANS) {
      if (!isCoveredValue(feature.coverage?.[plan])) continue;
      for (const vendor of matchedVendors) {
        planVendorCoverage[plan].add(normalizeText(vendor));
      }
      if (matchedVendors.length > 0) categorySummary[feature.category][plan] += 1;
    }
  }

  const plans = Object.fromEntries(TARGET_PLANS.map((plan) => {
    const coveredCount = planVendorCoverage[plan].size;
    return [plan, {
      coveredCount,
      totalCount: uniqueVendors.length,
      percent: uniqueVendors.length ? Math.round((coveredCount / uniqueVendors.length) * 100) : 0,
      notableInclusions: features
        .filter((feature) => (matches.mapped.get(featureKey(feature)) || []).length > 0 && isCoveredValue(feature.coverage?.[plan]))
        .slice(0, 4)
        .map((feature) => feature.name)
    }];
  }));

  return { plans, categories: categorySummary, unmapped: matches.unmapped, matches };
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) return `"${stringValue.replaceAll('"', '""')}"`;
  return stringValue;
}

export function exportFeaturesToCsv(features, vendors, statuses = {}, timestamp = new Date()) {
  const matches = matchVendorsToFeatures(vendors, features);
  const lines = [
    `# Exported ${timestamp.toISOString()} | Feature data sourced from M365 Maps by Aaron Dinnage`,
    ['Category', 'Feature Name', 'Parent Feature', 'Current Vendor', 'Covered in E3', 'Covered in E5', 'Covered in E7', 'Notes', 'Status'].join(',')
  ];

  for (const feature of features) {
    const key = featureKey(feature);
    const matchedVendors = matches.mapped.get(key) || [];
    lines.push([
      feature.category,
      feature.name,
      feature.parentFeature || '',
      matchedVendors.join('; '),
      getCoverageLabel(feature.coverage?.E3),
      getCoverageLabel(feature.coverage?.E5),
      getCoverageLabel(feature.coverage?.E7),
      feature.notes || '',
      statuses[key] || 'unchecked'
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function createStorageAdapter(storage, key = 'm365-consolidation-state') {
  const defaults = { vendors: [], statuses: {}, activePlan: 'All', activeCategory: 'All', theme: 'auto' };
  return {
    load() {
      try {
        return { ...defaults, ...JSON.parse(storage.getItem(key) || '{}') };
      } catch {
        return { ...defaults };
      }
    },
    save(state) {
      storage.setItem(key, JSON.stringify({ ...defaults, ...state }));
    },
    reset() {
      storage.removeItem(key);
      return { ...defaults };
    }
  };
}
