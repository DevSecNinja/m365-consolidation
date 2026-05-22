import {
  CATEGORIES,
  PLANS,
  STATUSES,
  TARGET_PLANS,
  createStorageAdapter,
  exportFeaturesToCsv,
  featureKey,
  filterFeatures,
  getCoverageLabel,
  getKnownVendors,
  groupParents,
  isCoveredValue,
  matchVendorsToFeatures,
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
  planVisibility: document.querySelector('#plan-visibility'),
  featureHeadings: document.querySelector('#feature-headings'),
  e5Uplift: document.querySelector('#e5-uplift'),
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
  elements.summaryCards.innerHTML = TARGET_PLANS.map((plan) => {
    const planSummary = summary.plans[plan];
    const inclusions = planSummary.notableInclusions.length ? planSummary.notableInclusions.join(', ') : 'Add vendors to see matches';
    return `<article class="summary-card"><p class="eyebrow">${plan}</p><strong>${planSummary.percent}% covered</strong><span>${planSummary.coveredCount} of ${planSummary.totalCount} tools mapped</span><small>${inclusions}</small></article>`;
  }).join('');

  elements.categorySummary.innerHTML = CATEGORIES.map((category) => {
    const scores = TARGET_PLANS.map((plan) => `<span><strong>${plan}</strong> ${summary.categories[category][plan]}</span>`).join('');
    return `<article><h3>${category}</h3><div>${scores}</div></article>`;
  }).join('');
}

function renderTabs() {
  const categories = ['All', ...CATEGORIES];
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
  elements.featureHeadings.innerHTML = [
    '<th scope="col">Feature</th>',
    '<th scope="col">Manual vendor</th>',
    ...getVisiblePlans().map((plan) => `<th scope="col">${plan}</th>`),
    '<th scope="col">Status</th>',
    '<th scope="col">Notes</th>'
  ].join('');
}

function coverageCell(feature, plan) {
  const value = feature.coverage?.[plan];
  const label = getCoverageLabel(value);
  let tone = 'not-included';
  if (value === true) tone = 'included';
  else if (isCoveredValue(value)) tone = 'partial';
  return `<td><span class="coverage ${tone}">${label}</span></td>`;
}

function renderRows(matches) {
  const parentCounts = groupParents(features);
  elements.featureRows.innerHTML = visibleFeatures.map((feature) => {
    const key = featureKey(feature);
    const matchedVendors = matches.mapped.get(key) || [];
    const manualVendor = state.manualVendors?.[key] || '';
    const hasChildren = parentCounts.get(feature.name) > 0;
    const rowClasses = [matchedVendors.length ? 'matched-row' : '', statusClass(state.statuses[key] || 'unchecked')].filter(Boolean).join(' ');
    const vendorText = matchedVendors.length ? `<small>Matches: ${escapeHtml(matchedVendors.join(', '))}</small>` : '';
    const collapseButton = hasChildren
      ? `<button type="button" class="collapse" data-parent="${feature.name}" aria-expanded="${!collapsedParents.has(feature.name)}">${collapsedParents.has(feature.name) ? '▸' : '▾'}</button>`
      : '<span class="collapse-spacer"></span>';
    const status = state.statuses[key] || 'unchecked';
    return `<tr class="${rowClasses}">
      <th scope="row">${collapseButton}<span>${escapeHtml(feature.name)}</span>${vendorText}</th>
      <td><input class="manual-vendor" data-manual-vendor="${escapeHtml(key)}" type="search" list="vendor-options" value="${escapeHtml(manualVendor)}" aria-label="Manual vendor override for ${escapeHtml(feature.name)}" placeholder="Add vendor"></td>
      ${getVisiblePlans().map((plan) => coverageCell(feature, plan)).join('')}
      <td><select data-status="${escapeHtml(key)}" aria-label="Status for ${escapeHtml(feature.name)}">${STATUSES.map((option) => `<option ${option === status ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></td>
      <td>${escapeHtml(feature.notes || '')}</td>
    </tr>`;
  }).join('');
  elements.visibleCount.textContent = `${visibleFeatures.length} of ${features.length} features shown`;
}

function render() {
  const summary = summarizeCoverage(state.vendors, features, state.manualVendors);
  const matchedKeys = new Set(summary.matches.mapped.keys());
  visibleFeatures = filterFeatures(features, {
    category: state.activeCategory,
    query: elements.featureSearch.value,
    plan: state.activePlan,
    e5UpliftOnly: elements.e5Uplift.checked,
    filledOnly: elements.filledOnly.checked,
    collapsedParents
  }, matchedKeys);

  renderVendors(summary);
  renderSummary(summary);
  renderTabs();
  renderPlanVisibility();
  renderHeadings();
  renderRows(summary.matches);
}

function downloadCsv() {
  const csv = exportFeaturesToCsv(visibleFeatures, state.vendors, state.statuses, new Date(), state.manualVendors);
  const filterName = state.activeCategory !== 'All' ? state.activeCategory.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') : 'all-features';
  const suffix = visibleFeatures.length !== features.length ? `-${filterName}` : '';
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
  elements.e5Uplift.addEventListener('change', render);
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
    elements.e5Uplift.checked = false;
    elements.filledOnly.checked = false;
    elements.planFilter.value = state.activePlan;
    render();
  });
  elements.themeToggle.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register('service-worker.js');
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        worker.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

async function init() {
  const response = await fetch('data/features.json', { cache: 'no-cache' });
  features = await response.json();
  elements.vendorOptions.innerHTML = getKnownVendors(features).map((vendor) => `<option value="${vendor}"></option>`).join('');
  bindEvents();
  setTheme(state.theme || 'auto');
  render();
  registerServiceWorker().catch(() => {});
}

init().catch((error) => {
  document.body.insertAdjacentHTML('afterbegin', `<div role="alert" class="load-error">Could not load feature data: ${error.message}</div>`);
});
