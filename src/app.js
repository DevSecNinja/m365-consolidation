import {
  PLANS,
  PLAN_DIFFS,
  STATUSES,
  TARGET_PLANS,
  createStorageAdapter,
  exportFeaturesToCsv,
  featureKey,
  filterFeatures,
  getBusinessCapability,
  getBusinessFunction,
  getBusinessValue,
  getFeatureCategories,
  getCoverageLabel,
  getKnownVendors,
  isCoveredValue,
  matchVendorsToFeatures,
  parseMatrixFeatures,
  parseMatrixExportDate,
  parseVendorList,
  summarizeCoverage
} from './logic.js';

const storage = createStorageAdapter(window.localStorage);
let state = storage.load();
let features = [];
let collapsedParents = new Set();
let visibleFeatures = [];

const elements = {
  vendorForm: document.querySelector('#vendor-form'),
  vendorInput: document.querySelector('#vendor-input'),
  vendorOptions: document.querySelector('#vendor-options'),
  vendorTags: document.querySelector('#vendor-tags'),
  unmappedVendors: document.querySelector('#unmapped-vendors'),
  summaryCards: document.querySelector('#summary-cards'),
  categorySummary: document.querySelector('#category-summary'),
  categoryTabs: document.querySelector('#category-tabs'),
  featureSearch: document.querySelector('#feature-search'),
  planFilter: document.querySelector('#plan-filter'),
  planDiffFilter: document.querySelector('#plan-diff-filter'),
  tableViewToggle: document.querySelector('#table-view-toggle'),
  planVisibility: document.querySelector('#plan-visibility'),
  featureHeadings: document.querySelector('#feature-headings'),
  featureCaption: document.querySelector('#feature-caption'),
  availableOnly: document.querySelector('#available-only'),
  filledOnly: document.querySelector('#filled-only'),
  featureRows: document.querySelector('#feature-rows'),
  visibleCount: document.querySelector('#visible-count'),
  exportCsv: document.querySelector('#export-csv'),
  resetData: document.querySelector('#reset-data'),
  themeToggle: document.querySelector('#theme-toggle')
};

function persist() {
  storage.save(state);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme === 'auto' ? '' : theme;
  elements.themeToggle.textContent = theme === 'dark' ? 'Use light mode' : 'Use dark mode';
  persist();
}

function addVendor(name) {
  const vendor = name.trim();
  if (!vendor) return;
  if (!state.vendors.some((existing) => existing.toLowerCase() === vendor.toLowerCase())) {
    state.vendors.push(vendor);
    persist();
    render();
  }
}

function removeVendor(vendor) {
  state.vendors = state.vendors.filter((item) => item !== vendor);
  persist();
  render();
}

function renderVendors(summary) {
  elements.vendorTags.innerHTML = '';
  for (const vendor of state.vendors) {
    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'tag';
    tag.textContent = `${vendor} ×`;
    tag.setAttribute('aria-label', `Remove ${vendor}`);
    tag.addEventListener('click', () => removeVendor(vendor));
    elements.vendorTags.append(tag);
  }
  elements.unmappedVendors.textContent = summary.unmapped.length
    ? `Not mapped: ${summary.unmapped.join(', ')}. Check these tools manually.`
    : '';
}

function renderSummary(summary) {
  const categories = getFeatureCategories(features);
  elements.summaryCards.innerHTML = TARGET_PLANS.map((plan) => {
    const planSummary = summary.plans[plan];
    const inclusions = planSummary.notableInclusions.length ? planSummary.notableInclusions.join(', ') : 'Add vendors to see matches';
    return `<article class="summary-card"><p class="eyebrow">${plan}</p><strong>${planSummary.percent}% covered</strong><span>${planSummary.coveredCount} of ${planSummary.totalCount} tools mapped</span><small>${inclusions}</small></article>`;
  }).join('');

  elements.categorySummary.innerHTML = categories.map((category) => {
    const scores = TARGET_PLANS.map((plan) => `<span><strong>${plan}</strong> ${summary.categories[category][plan]}</span>`).join('');
    return `<article><h3>${category}</h3><div>${scores}</div></article>`;
  }).join('');
}

function renderTabs() {
  const categories = ['All', ...getFeatureCategories(features)];
  elements.categoryTabs.innerHTML = categories.map((category) => `<button type="button" role="tab" aria-selected="${state.activeCategory === category}" data-category="${category}">${category}</button>`).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusClass(status) {
  if (status === 'already covered') return 'status-covered';
  if (status === 'not needed') return 'status-not-needed';
  if (status === 'gap — need to evaluate') return 'status-gap';
  return 'status-unchecked';
}

function getVisiblePlans() {
  const hiddenPlans = new Set(state.hiddenPlans || []);
  return PLANS.filter((plan) => !hiddenPlans.has(plan));
}

function renderPlanVisibility() {
  const hiddenPlans = new Set(state.hiddenPlans || []);
  elements.planVisibility.innerHTML = PLANS.map((plan) => `<label class="check"><input type="checkbox" value="${plan}" ${hiddenPlans.has(plan) ? '' : 'checked'}> ${plan}</label>`).join('');
}

function renderHeadings() {
  const featureColumns = state.tableView === 'business'
    ? ['<th scope="col">Function</th>', '<th scope="col">Business value</th>', '<th scope="col">Microsoft feature</th>']
    : ['<th scope="col">Feature</th>'];
  const trailingColumns = state.tableView === 'business'
    ? ['<th scope="col" class="status-col">Status</th>']
    : ['<th scope="col" class="status-col">Status</th>', '<th scope="col">Notes</th>'];
  elements.featureHeadings.innerHTML = [
    ...featureColumns,
    '<th scope="col">Manual vendor</th>',
    ...getVisiblePlans().map((plan) => `<th scope="col" class="plan-col">${plan}</th>`),
    ...trailingColumns
  ].join('');
  elements.featureCaption.textContent = state.tableView === 'business'
    ? 'Microsoft 365 coverage grouped by customer-facing business capability. Highlighted rows match your entered vendors.'
    : 'Microsoft 365 feature coverage by plan. Highlighted rows match your entered vendors.';
}

function coverageCell(feature, plan) {
  const value = feature.coverage?.[plan];
  const label = getCoverageLabel(value);
  let tone = 'not-included';
  if (value === true) tone = 'included';
  else if (isCoveredValue(value)) tone = 'partial';
  return `<td class="plan-cell"><span class="coverage ${tone}">${label}</span></td>`;
}

function featureRow(feature, matches, isGrouped = false) {
  const key = featureKey(feature);
  const matchedVendors = matches.mapped.get(key) || [];
  const manualVendor = state.manualVendors?.[key] || '';
  const depth = Number(feature.depth) || 0;
  const isBundleParent = Boolean(feature.isParent);
  const rowClasses = [
    isGrouped ? 'grouped-row' : '',
    matchedVendors.length ? 'matched-row' : '',
    isBundleParent ? 'bundle-row' : '',
    depth > 0 ? 'nested-row' : '',
    statusClass(state.statuses[key] || 'unchecked')
  ].filter(Boolean).join(' ');
  const vendorText = matchedVendors.length ? `<small>Matches: ${escapeHtml(matchedVendors.join(', '))}</small>` : '';
  const others = Array.isArray(feature.otherOccurrences) ? feature.otherOccurrences.filter(Boolean) : [];
  const dupText = others.length
    ? `<small class="also-in" title="Also listed under: ${escapeHtml(others.join(' | '))}">also in ${others.length} other ${others.length === 1 ? 'section' : 'sections'}</small>`
    : '';
  const status = state.statuses[key] || 'unchecked';

  const nameCell = state.tableView === 'business'
    ? `<th scope="row"><span>${escapeHtml(getBusinessFunction(feature))}</span>${vendorText}${dupText}</th><td>${escapeHtml(getBusinessValue(feature))}</td><td>${escapeHtml(feature.name)}</td>`
    : `<th scope="row"><span>${escapeHtml(feature.name)}</span>${vendorText}${dupText}</th>`;

  const noteCell = state.tableView === 'business' ? '' : `<td>${escapeHtml(feature.notes || '')}</td>`;

  return `<tr class="${rowClasses}" style="--depth: ${depth}">
      ${nameCell}
      <td><input class="manual-vendor" data-manual-vendor="${escapeHtml(key)}" type="search" list="vendor-options" value="${escapeHtml(manualVendor)}" aria-label="Manual vendor override for ${escapeHtml(feature.name)}" placeholder="Add vendor"></td>
      ${getVisiblePlans().map((plan) => coverageCell(feature, plan)).join('')}
      <td class="status-cell"><select data-status="${escapeHtml(key)}" aria-label="Status for ${escapeHtml(feature.name)}">${STATUSES.map((option) => `<option ${option === status ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></td>
      ${noteCell}
    </tr>`;
}

function bestCoverageValue(a, b) {
  if (a === true || b === true) return true;
  const aHas = typeof a === 'string' && a.trim().length > 0;
  const bHas = typeof b === 'string' && b.trim().length > 0;
  if (aHas) return a;
  if (bHas) return b;
  return false;
}

function occurrenceLabel(feature) {
  return [feature.category, feature.subCategory, feature.parentFeature]
    .filter((part) => part && part !== feature.name)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(' › ');
}

function dedupeFeaturesByName(features) {
  const byName = new Map();
  const order = [];
  for (const feature of features) {
    const existing = byName.get(feature.name);
    if (!existing) {
      const copy = { ...feature, coverage: { ...feature.coverage }, otherOccurrences: [] };
      byName.set(feature.name, copy);
      order.push(copy);
      continue;
    }
    for (const plan of Object.keys(feature.coverage || {})) {
      existing.coverage[plan] = bestCoverageValue(existing.coverage[plan], feature.coverage[plan]);
    }
    existing.otherOccurrences.push(occurrenceLabel(feature));
  }
  return order;
}

function getFeatureGroups() {
  const groups = [];
  const groupedByParent = new Map();

  for (const feature of visibleFeatures) {
    if (state.tableView === 'business') {
      const label = getBusinessCapability(feature);
      const key = `business::${label}`;
      if (!groupedByParent.has(key)) {
        const group = { key, label, features: [] };
        groupedByParent.set(key, group);
        groups.push(group);
      }
      groupedByParent.get(key).features.push(feature);
      continue;
    }

    if (!feature.parentFeature) {
      groups.push({ key: featureKey(feature), label: '', features: [feature] });
      continue;
    }

    if (!groupedByParent.has(feature.parentFeature)) {
      const group = { key: feature.parentFeature, label: feature.parentFeature, features: [] };
      groupedByParent.set(feature.parentFeature, group);
      groups.push(group);
    }

    groupedByParent.get(feature.parentFeature).features.push(feature);
  }

  for (const group of groups) {
    group.features = dedupeFeaturesByName(group.features);
  }

  return groups;
}

function getExpandedFeatures() {
  return getFeatureGroups().flatMap((group) => {
    if (group.label && collapsedParents.has(group.key)) return [];
    return group.features;
  });
}

function renderRows(matches) {
  const columnCount = getVisiblePlans().length + (state.tableView === 'business' ? 5 : 4);
  const renderedFeatureCount = getExpandedFeatures().length;

  elements.featureRows.innerHTML = getFeatureGroups().map((group) => {
    if (!group.label) {
      return featureRow(group.features[0], matches);
    }

    const isCollapsed = collapsedParents.has(group.key);
    const groupRows = isCollapsed
      ? ''
      : group.features.map((feature) => featureRow(feature, matches, true)).join('');

    return `<tr class="parent-row">
      <th scope="rowgroup" colspan="${columnCount}">
        <button type="button" class="collapse" data-parent="${escapeHtml(group.key)}" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${escapeHtml(group.label)}">
          <span aria-hidden="true">${isCollapsed ? '▸' : '▾'}</span>
          <span>${escapeHtml(group.label)}</span>
          <small>${group.features.length} ${group.features.length === 1 ? 'feature' : 'features'}</small>
        </button>
      </th>
    </tr>${groupRows}`;
  }).join('');
  elements.visibleCount.textContent = `${renderedFeatureCount} of ${features.length} features shown`;
}

function render() {
  const summary = summarizeCoverage(state.vendors, features, state.manualVendors);
  const matchedKeys = new Set(summary.matches.mapped.keys());
  visibleFeatures = filterFeatures(features, {
    category: state.activeCategory,
    query: elements.featureSearch.value,
    plan: state.activePlan,
    planDiff: state.activePlanDiff,
    availableOnly: elements.availableOnly.checked,
    visiblePlans: getVisiblePlans(),
    filledOnly: elements.filledOnly.checked
  }, matchedKeys);

  renderVendors(summary);
  renderSummary(summary);
  renderTabs();
  renderPlanVisibility();
  renderHeadings();
  renderRows(summary.matches);
}

function downloadCsv() {
  const exportedFeatures = getExpandedFeatures();
  const csv = exportFeaturesToCsv(exportedFeatures, state.vendors, state.statuses, new Date(), state.manualVendors, { view: state.tableView });
  const filterName = state.activeCategory !== 'All' ? state.activeCategory.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') : 'all-features';
  const suffix = exportedFeatures.length !== features.length ? `-${filterName}` : '';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `m365-consolidation${suffix}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindEvents() {
  elements.vendorForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addVendor(elements.vendorInput.value);
    elements.vendorInput.value = '';
  });

  elements.categoryTabs.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-category]');
    if (!button) return;
    state.activeCategory = button.dataset.category;
    persist();
    render();
  });

  elements.featureSearch.addEventListener('input', render);
  elements.planFilter.value = state.activePlan;
  elements.planFilter.addEventListener('change', () => {
    state.activePlan = elements.planFilter.value;
    persist();
    render();
  });
  elements.planDiffFilter.value = state.activePlanDiff;
  elements.planDiffFilter.addEventListener('change', () => {
    state.activePlanDiff = elements.planDiffFilter.value;
    persist();
    render();
  });
  elements.planVisibility.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    const hiddenPlans = new Set(state.hiddenPlans || []);
    if (checkbox.checked) hiddenPlans.delete(checkbox.value);
    else hiddenPlans.add(checkbox.value);
    state.hiddenPlans = PLANS.filter((plan) => hiddenPlans.has(plan));
    persist();
    render();
  });
  elements.tableViewToggle.addEventListener('change', () => {
    state.tableView = elements.tableViewToggle.checked ? 'business' : 'feature';
    persist();
    render();
  });
  elements.availableOnly.addEventListener('change', render);
  elements.filledOnly.addEventListener('change', render);

  elements.featureRows.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-parent]');
    if (!button) return;
    const parent = button.dataset.parent;
    if (collapsedParents.has(parent)) collapsedParents.delete(parent);
    else collapsedParents.add(parent);
    render();
  });

  elements.featureRows.addEventListener('change', (event) => {
    const manualVendorInput = event.target.closest('input[data-manual-vendor]');
    if (manualVendorInput) {
      const key = manualVendorInput.dataset.manualVendor;
      const manualVendor = parseVendorList(manualVendorInput.value).join('; ');
      state.manualVendors = { ...(state.manualVendors || {}) };
      if (manualVendor) state.manualVendors[key] = manualVendor;
      else delete state.manualVendors[key];
      persist();
      render();
      return;
    }

    const select = event.target.closest('select[data-status]');
    if (!select) return;
    state.statuses[select.dataset.status] = select.value;
    persist();
    render();
  });

  elements.exportCsv.addEventListener('click', downloadCsv);
  elements.resetData.addEventListener('click', () => {
    if (!confirm('Clear vendors, statuses, and filters stored in this browser?')) return;
    state = storage.reset();
    elements.featureSearch.value = '';
    elements.availableOnly.checked = false;
    elements.filledOnly.checked = false;
    elements.planFilter.value = state.activePlan;
    elements.planDiffFilter.value = state.activePlanDiff;
    elements.tableViewToggle.checked = state.tableView === 'business';
    render();
  });
  elements.themeToggle.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let serviceWorkerUrl = 'service-worker.js';
  try {
    const response = await fetch('version.json', { cache: 'no-store' });
    if (response.ok) {
      const version = await response.json();
      if (version.sha) serviceWorkerUrl = `service-worker.js?v=${encodeURIComponent(version.sha)}`;
    }
  } catch {
    serviceWorkerUrl = 'service-worker.js';
  }

  const registration = await navigator.serviceWorker.register(serviceWorkerUrl);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        worker.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

async function getDataVersion() {
  try {
    const response = await fetch(`version.json?cache=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return Date.now();
    const version = await response.json();
    return version.sha || version.builtAt || Date.now();
  } catch {
    return Date.now();
  }
}

function versionedUrl(url, version) {
  return `${url}?v=${encodeURIComponent(version)}`;
}

async function init() {
  const dataVersion = await getDataVersion();
  const [matrixResponse, metadataResponse, exclusionsResponse] = await Promise.all([
    fetch(versionedUrl('Microsoft-365-Matrix-Export.csv', dataVersion), { cache: 'no-store' }),
    fetch(versionedUrl('data/features.json', dataVersion), { cache: 'no-store' }),
    fetch(versionedUrl('data/exclusions.json', dataVersion), { cache: 'no-store' })
  ]);
  if (!matrixResponse.ok) throw new Error('Could not load Microsoft-365-Matrix-Export.csv');
  if (!metadataResponse.ok) throw new Error('Could not load feature metadata');

  const matrixCsv = await matrixResponse.text();
  const metadataFeatures = await metadataResponse.json();
  const excludedFeatureNames = exclusionsResponse.ok ? new Set(await exclusionsResponse.json()) : new Set();
  features = parseMatrixFeatures(matrixCsv, metadataFeatures, excludedFeatureNames);
  const exportDate = parseMatrixExportDate(matrixCsv);
  const dateLabel = document.getElementById('data-date');
  if (dateLabel && exportDate) {
    const display = (() => {
      const parsed = new Date(exportDate);
      if (Number.isNaN(parsed.getTime())) return exportDate;
      return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    })();
    dateLabel.textContent = display;
    dateLabel.setAttribute('datetime', exportDate);
  }
  if (state.activeCategory !== 'All' && !getFeatureCategories(features).includes(state.activeCategory)) {
    state.activeCategory = 'All';
    persist();
  }
  elements.vendorOptions.innerHTML = getKnownVendors(features).map((vendor) => `<option value="${vendor}"></option>`).join('');
  elements.planDiffFilter.innerHTML = PLAN_DIFFS.map((diff) => `<option value="${diff.value}">${diff.label}</option>`).join('');
  bindEvents();
  elements.tableViewToggle.checked = state.tableView === 'business';
  setTheme(state.theme || 'auto');
  render();
  registerServiceWorker().catch(() => {});
}

init().catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<div role="alert" class="load-error">Could not load feature data: ${error.message}</div>`);
});
