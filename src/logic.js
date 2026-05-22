export const PLANS = ['E3', 'E5', 'E7'];
export const TARGET_PLANS = ['E3', 'E5', 'E7'];
export const TABLE_VIEWS = ['business', 'feature'];
export const CATEGORIES = [];
export const STATUSES = ['unchecked', 'already covered', 'not needed', 'gap — need to evaluate'];
export const MATRIX_CATEGORY_HEADERS = new Set([
  'Office 365',
  'Enterprise Mobility + Security',
  'Windows',
  'Suite Value',
  'Related Services',
  'Microsoft Entra',
  'Microsoft Priva',
  'Microsoft Purview',
  'Microsoft Security Experts',
  'Communications',
  'Extra Capacity',
  'Support Services',
  'Education',
  'Employee Experience',
  'Power Platform',
  'Companion Products & Services',
  'Automation & Intelligence'
]);

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

function sentence(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function firstSentence(value) {
  const text = String(value || '').trim();
  return sentence(text.match(/^[^.!?]+[.!?]/)?.[0] || text);
}

export function getBusinessCapability(feature) {
  if (feature.businessCapability) return feature.businessCapability;
  if (feature.parentFeature && feature.parentFeature !== feature.category) return feature.parentFeature;
  return feature.category || 'Microsoft 365';
}

export function getBusinessFunction(feature) {
  if (feature.businessFunction) return feature.businessFunction;
  if (feature.notes) return firstSentence(feature.notes);
  return `Provides ${feature.name} capabilities.`;
}

export function getBusinessValue(feature) {
  if (feature.businessValue) return feature.businessValue;
  const category = feature.category || '';
  if (category === 'Office 365' || category === 'Productivity' || category === 'Communications' || category === 'Employee Experience') {
    return 'Helps consolidate collaboration and productivity capabilities in Microsoft 365.';
  }
  if (category === 'Enterprise Mobility + Security' || category === 'Microsoft Entra') {
    return 'Helps strengthen identity, access, and device security controls.';
  }
  if (category === 'Windows') {
    return 'Helps secure and manage Windows devices with built-in platform capabilities.';
  }
  if (category === 'Microsoft Purview' || category === 'Microsoft Priva' || category === 'Compliance & Data Governance') {
    return 'Helps meet governance, privacy, and compliance obligations in Microsoft 365.';
  }
  if (category === 'Power Platform' || category === 'Automation & Intelligence') {
    return 'Helps automate processes and extend business apps inside Microsoft 365.';
  }
  if (category === 'Education') {
    return 'Supports education workflows with Microsoft 365 capabilities.';
  }
  return 'Helps reduce separate tooling by using Microsoft 365 included capabilities.';
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += character;
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function cleanMatrixName(value) {
  return String(value || '').replace(/^\ufeff/, '').trim();
}

function parseMatrixName(value) {
  const raw = cleanMatrixName(value);
  const prefix = raw.match(/^(?:\s*>\s*)+/)?.[0] || '';
  return {
    depth: (prefix.match(/>/g) || []).length,
    name: raw.replace(/^(?:\s*>\s*)+/, '').trim()
  };
}

function normalizeMetadataName(value) {
  return normalizeText(value).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function coverageFromMatrixCell(value) {
  const cell = String(value || '').trim();
  if (!cell) return false;
  if (cell === '✔') return true;
  if (cell === '+') return 'Add-on';
  if (cell === 'Δ') return 'Available add-on';
  if (cell === '⊡') return 'Package only';
  if (cell === '?') return 'Unknown';
  return cell;
}

function findMetadata(featureName, metadataByName) {
  return metadataByName.get(normalizeText(featureName)) || metadataByName.get(normalizeMetadataName(featureName)) || {};
}

function getMetadataNames(feature) {
  return [feature.name, ...(Array.isArray(feature.aliases) ? feature.aliases : [])].filter(Boolean);
}

export function parseMatrixFeatures(csvText, metadataFeatures = [], excludedFeatureNames = new Set()) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex((row) => cleanMatrixName(row[0]) === 'Feature');
  if (headerIndex === -1) return [];

  const plans = rows[headerIndex].slice(1, 4).map(cleanMatrixName).filter((plan) => PLANS.includes(plan));
  const metadataByName = new Map();
  for (const feature of metadataFeatures) {
    for (const name of getMetadataNames(feature)) {
      metadataByName.set(normalizeText(name), feature);
      metadataByName.set(normalizeMetadataName(name), feature);
    }
  }

  const features = [];
  const stack = [];
  let category = 'Microsoft 365';

  for (const row of rows.slice(headerIndex + 1)) {
    const { depth, name } = parseMatrixName(row[0]);
    if (!name || excludedFeatureNames.has(name)) continue;

    const values = row.slice(1, 4);
    const hasCoverage = values.some((value) => String(value || '').trim());
    const isCategory = depth === 0 && (MATRIX_CATEGORY_HEADERS.has(name) || values.join('|') === 'E3|E5|E5');
    if (isCategory) {
      category = name;
      stack.length = 0;
      stack[0] = name;
      continue;
    }
    if (!hasCoverage) continue;

    const metadata = findMetadata(name, metadataByName);
    const parentFeature = depth > 0 ? stack[depth - 1] || category : category;
    const coverage = Object.fromEntries(plans.map((plan, index) => [plan, coverageFromMatrixCell(values[index])]));
    features.push({
      name,
      category,
      parentFeature,
      coverage,
      notes: metadata.notes || '',
      commonVendors: metadata.commonVendors || [],
      businessCapability: metadata.businessCapability || '',
      businessFunction: metadata.businessFunction || '',
      businessValue: metadata.businessValue || ''
    });

    stack.length = depth;
    stack[depth] = name;
  }

  return features;
}

export function getFeatureCategories(features) {
  return [...new Set(features.map((feature) => feature.category).filter(Boolean))];
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

export function parseVendorList(value) {
  return String(value || '')
    .split(/[;,]/)
    .map((vendor) => vendor.trim())
    .filter(Boolean);
}

export function matchVendorsToFeatures(vendors, features, manualVendors = {}) {
  const normalizedVendors = vendors.map((vendor) => ({ raw: vendor, normalized: normalizeText(vendor) })).filter((vendor) => vendor.normalized);
  const mapped = new Map();
  const recognized = new Set();

  for (const feature of features) {
    const key = featureKey(feature);
    const featureVendors = (feature.commonVendors || []).map((vendor) => ({ raw: vendor, normalized: normalizeText(vendor) }));
    const automaticMatches = normalizedVendors
      .filter((vendor) => featureVendors.some((known) => known.normalized === vendor.normalized))
      .map((vendor) => vendor.raw);
    const manualMatches = parseVendorList(manualVendors[key]);
    const matches = [...new Set([...automaticMatches, ...manualMatches])];
    if (matches.length > 0) {
      mapped.set(key, matches);
      automaticMatches.forEach((vendor) => recognized.add(normalizeText(vendor)));
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
    availableOnly = false,
    visiblePlans = PLANS,
    filledOnly = false,
    collapsedParents = new Set()
  } = filters;
  const normalizedQuery = normalizeText(query);

  return features.filter((feature) => {
    if (category !== 'All' && feature.category !== category) return false;
    if (normalizedQuery && !normalizeText(`${feature.name} ${feature.parentFeature} ${getBusinessCapability(feature)} ${getBusinessFunction(feature)} ${getBusinessValue(feature)} ${feature.notes}`).includes(normalizedQuery)) return false;
    if (plan !== 'All' && !isCoveredValue(feature.coverage?.[plan])) return false;
    if (availableOnly && !visiblePlans.some((candidate) => isCoveredValue(feature.coverage?.[candidate]))) return false;
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

export function summarizeCoverage(vendors, features, manualVendors = {}) {
  const matches = matchVendorsToFeatures(vendors, features, manualVendors);
  const uniqueVendors = [...new Set([...vendors, ...Object.values(manualVendors).flatMap(parseVendorList)].map(normalizeText).filter(Boolean))];
  const categories = getFeatureCategories(features);
  const categorySummary = Object.fromEntries(categories.map((category) => [category, Object.fromEntries(TARGET_PLANS.map((plan) => [plan, 0]))]));

  const planVendorCoverage = Object.fromEntries(TARGET_PLANS.map((plan) => [plan, new Set()]));
  for (const feature of features) {
    const matchedVendors = matches.mapped.get(featureKey(feature)) || [];
    for (const plan of TARGET_PLANS) {
      if (!isCoveredValue(feature.coverage?.[plan])) continue;
      for (const vendor of matchedVendors) {
        planVendorCoverage[plan].add(normalizeText(vendor));
      }
      if (matchedVendors.length > 0 && categorySummary[feature.category]) categorySummary[feature.category][plan] += 1;
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

export function exportFeaturesToCsv(features, vendors, statuses = {}, timestamp = new Date(), manualVendors = {}, options = {}) {
  const matches = matchVendorsToFeatures(vendors, features, manualVendors);
  const isBusinessView = options.view === 'business';
  const lines = [
    `# Exported ${timestamp.toISOString()} | Feature data sourced from M365 Maps by Aaron Dinnage`,
    (isBusinessView
      ? ['Business Capability', 'Function', 'Business Value', 'Microsoft Feature', 'Category', 'Current Vendor', 'Manual Vendor Override', 'Covered in E3', 'Covered in E5', 'Covered in E7', 'Status']
      : ['Category', 'Feature Name', 'Parent Feature', 'Current Vendor', 'Manual Vendor Override', 'Covered in E3', 'Covered in E5', 'Covered in E7', 'Notes', 'Status']
    ).join(',')
  ];

  for (const feature of features) {
    const key = featureKey(feature);
    const matchedVendors = matches.mapped.get(key) || [];
    const coverageFields = [
      matchedVendors.join('; '),
      parseVendorList(manualVendors[key]).join('; '),
      getCoverageLabel(feature.coverage?.E3),
      getCoverageLabel(feature.coverage?.E5),
      getCoverageLabel(feature.coverage?.E7)
    ];
    const viewFields = isBusinessView
      ? [getBusinessCapability(feature), getBusinessFunction(feature), getBusinessValue(feature), feature.name, feature.category]
      : [feature.category, feature.name, feature.parentFeature || ''];
    const trailingFields = isBusinessView
      ? [statuses[key] || 'unchecked']
      : [feature.notes || '', statuses[key] || 'unchecked'];
    lines.push([...viewFields, ...coverageFields, ...trailingFields].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function createStorageAdapter(storage, key = 'm365-consolidation-state') {
  const defaults = { vendors: [], statuses: {}, manualVendors: {}, activePlan: 'All', activeCategory: 'All', hiddenPlans: [], theme: 'auto', tableView: 'business' };
  const normalizeState = (state) => ({
    ...defaults,
    ...state,
    activePlan: state.activePlan === 'All' || PLANS.includes(state.activePlan) ? state.activePlan : defaults.activePlan,
    hiddenPlans: Array.isArray(state.hiddenPlans) ? state.hiddenPlans.filter((plan) => PLANS.includes(plan)) : defaults.hiddenPlans,
    tableView: TABLE_VIEWS.includes(state.tableView) ? state.tableView : defaults.tableView
  });
  return {
    load() {
      try {
        return normalizeState(JSON.parse(storage.getItem(key) || '{}'));
      } catch {
        return { ...defaults };
      }
    },
    save(state) {
      storage.setItem(key, JSON.stringify(normalizeState(state)));
    },
    reset() {
      storage.removeItem(key);
      return { ...defaults };
    }
  };
}
