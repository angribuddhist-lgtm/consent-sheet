const PROFILE_STORAGE_KEY = 'consent-sheet-user-profiles-v1';
const LEGACY_SELECTION_KEYS = ['kink-sheet-v3-density-selections', 'kink-sheet-v3-selections', 'kink-sheet-v2-selections', 'kink-sheet-v1-selections'];
const DATA_URL = './sheet-data.json';
const RESIZE_DEBOUNCE_MS = 120;

const appShell = document.querySelector('.app-shell');
const statusEl = document.getElementById('status');
const gridEl = document.getElementById('sheetGrid');
const legendEl = document.getElementById('legend');
const titleEl = document.getElementById('sheetTitle');
const tooltipEl = document.getElementById('tooltip');
const profileSelect = document.getElementById('profileSelect');
const newProfileBtn = document.getElementById('newProfileBtn');
const renameProfileBtn = document.getElementById('renameProfileBtn');
const deleteProfileBtn = document.getElementById('deleteProfileBtn');
const resetBtn = document.getElementById('resetBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importInput = document.getElementById('importInput');
const screenshotBtn = document.getElementById('screenshotBtn');

let sheetData = null;
let profileStore = loadProfileStore();
let resizeTimer = null;

init();

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${DATA_URL}`);
    sheetData = await response.json();

    migrateLegacySelections();
    cleanAllProfiles();
    renderProfileSelect();
    renderSheet(sheetData);
    setStatus('', '');
  } catch (error) {
    setStatus(`${error.message}. GitHub Pages must serve this folder over HTTPS for the JSON file to load.`, 'warn');
    console.error(error);
  }
}

function renderSheet(data) {
  applyDisplaySettings(data);
  titleEl.textContent = data.title || 'Consent Sheet';
  const displayStates = getDisplayStates(data.states || []);
  renderLegend(displayStates);
  renderPackedCategories(data.categories || [], displayStates);
}

function getDisplayStates(states) {
  return [...states].reverse();
}

function renderLegend(states) {
  legendEl.innerHTML = '';
  for (const state of states) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="--state-color:${state.color}"></span><span>${escapeHtml(getCompactStateLabel(state.label))}</span>`;
    legendEl.appendChild(item);
  }
}

function renderPackedCategories(categories, states = getDisplayStates(sheetData?.states || [])) {
  applyDisplaySettings(sheetData);
  gridEl.innerHTML = '';

  const columnCount = getManualColumnCount(sheetData);
  applySheetContentWidth(sheetData, columnCount);
  gridEl.style.setProperty('--column-count', columnCount);
  appShell.style.setProperty('--column-count', columnCount);
  gridEl.dataset.columns = String(columnCount);

  const columns = Array.from({ length: columnCount }, (_, index) => createColumn(index));
  const ordered = getManualCategoryOrder(categories, columnCount);

  for (const category of ordered) {
    const columnIndex = getCategoryColumnIndex(category, columnCount);
    columns[columnIndex].appendChild(renderCategoryCard(category, states));
  }

  for (const column of columns) gridEl.appendChild(column);
}

function createColumn(index) {
  const column = document.createElement('div');
  column.className = 'sheet-column';
  column.dataset.column = String(index + 1);
  return column;
}

function renderCategoryCard(category, states) {
  const card = document.createElement('article');
  const isDouble = normalizeCategoryLayout(category.layout) === 'double';
  const modes = getChoiceModes(category);
  card.className = `category-card ${getCategorySizeClass(category)} ${getCategoryLayoutClass(category)}`;
  card.dataset.categoryId = category.id;
  card.dataset.layout = normalizeCategoryLayout(category.layout);

  const headerModes = isDouble ? modes.slice(0, 2) : getSingleHeaderModes(category);
  const headerLabels = headerModes
    .map(mode => `<span class="pip-column-label">${escapeHtml(mode.label)}</span>`)
    .join('');

  card.innerHTML = `
    <header class="category-header ${headerLabels ? 'has-pip-columns' : ''}">
      <div class="category-title">${escapeHtml(category.name)}</div>
      ${headerLabels ? `<div class="pip-column-headers" style="--pip-column-count:${headerModes.length}">${headerLabels}</div>` : ''}
    </header>
    <div class="items"></div>
  `;

  const itemsEl = card.querySelector('.items');
  for (const item of category.items || []) {
    itemsEl.appendChild(renderItem(item, states, category));
  }

  return card;
}

function renderItem(item, states, category) {
  const row = document.createElement('div');
  const layout = normalizeCategoryLayout(category?.layout);
  const modes = getChoiceModes(category);
  const isDouble = layout === 'double';

  row.className = `item-row ${isDouble ? 'layout-double' : 'layout-single'}`;
  row.dataset.categoryId = category.id;
  row.dataset.itemId = item.id;

  const label = document.createElement('div');
  label.className = 'item-label';
  label.textContent = item.label;

  if (item.description) {
    label.tabIndex = 0;
    label.setAttribute('aria-describedby', 'tooltip');
    label.addEventListener('mouseenter', event => showTooltip(event, item.description));
    label.addEventListener('mousemove', moveTooltip);
    label.addEventListener('mouseleave', hideTooltip);
    label.addEventListener('focus', event => showTooltip(event, item.description));
    label.addEventListener('blur', hideTooltip);
  }

  if (isDouble) {
    const modeChoices = document.createElement('div');
    modeChoices.className = 'mode-choice-set';
    modeChoices.setAttribute('aria-label', `${item.label} paired preferences`);

    for (const mode of modes) {
      const modeGroup = document.createElement('div');
      modeGroup.className = 'mode-choice';
      modeGroup.dataset.modeId = mode.id;
      modeGroup.appendChild(renderChoices(category, item, states, mode));
      modeChoices.appendChild(modeGroup);
    }

    row.append(label, modeChoices);
    return row;
  }

  row.append(label, renderChoices(category, item, states, null));
  return row;
}

function renderChoices(category, item, states, mode) {
  const choices = document.createElement('div');
  choices.className = 'choice-set';

  const labelText = mode ? `${item.label} ${mode.label} preference` : `${item.label} preference`;
  choices.setAttribute('aria-label', labelText);

  for (const state of states) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'choice';
    button.style.setProperty('--state-color', state.color);
    button.title = state.label;
    button.setAttribute('aria-label', `${labelText}: ${state.label}`);
    button.dataset.stateId = state.id;
    button.addEventListener('click', () => toggleSelection(category.id, item.id, state.id, choices, mode?.key || null));
    choices.appendChild(button);
  }

  applySelection(choices, getSelectedState(category.id, item.id, mode?.key || null));
  return choices;
}

function toggleSelection(categoryId, itemId, stateId, choicesEl, modeKey = null) {
  const profile = getActiveProfile();
  profile.selections[categoryId] ||= {};

  if (modeKey) {
    const current = profile.selections[categoryId][itemId] && typeof profile.selections[categoryId][itemId] === 'object'
      ? { ...profile.selections[categoryId][itemId] }
      : {};

    if (current[modeKey] === stateId) {
      delete current[modeKey];
    } else {
      current[modeKey] = stateId;
    }

    if (Object.keys(current).length === 0) {
      delete profile.selections[categoryId][itemId];
    } else {
      profile.selections[categoryId][itemId] = current;
    }

    pruneEmptyCategory(profile.selections, categoryId);
    touchActiveProfile();
    saveProfileStore();
    applySelection(choicesEl, current[modeKey] || null);
    return;
  }

  const current = profile.selections[categoryId][itemId];
  if (current === stateId) {
    delete profile.selections[categoryId][itemId];
  } else {
    profile.selections[categoryId][itemId] = stateId;
  }

  pruneEmptyCategory(profile.selections, categoryId);
  touchActiveProfile();
  saveProfileStore();
  applySelection(choicesEl, getSelectedState(categoryId, itemId, null));
}

function applySelection(choicesEl, selectedState) {
  for (const choice of choicesEl.querySelectorAll('.choice')) {
    const selected = choice.dataset.stateId === selectedState;
    choice.classList.toggle('is-selected', selected);
    choice.setAttribute('aria-pressed', String(selected));
  }
}

function getSelectedState(categoryId, itemId, modeKey = null) {
  const categorySelections = getActiveProfile().selections?.[categoryId];
  const value = categorySelections?.[itemId];
  if (!modeKey) return typeof value === 'string' ? value : null;
  return value && typeof value === 'object' && !Array.isArray(value) ? value[modeKey] || null : null;
}

function loadProfileStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || 'null');
    if (isValidProfileStore(stored)) return stored;
  } catch {
    return createDefaultProfileStore();
  }
  return createDefaultProfileStore();
}

function isValidProfileStore(store) {
  return store
    && store.version === 1
    && typeof store.activeProfileId === 'string'
    && Array.isArray(store.profiles)
    && store.profiles.length > 0;
}

function createDefaultProfileStore() {
  const now = new Date().toISOString();
  return {
    version: 1,
    activeProfileId: 'default',
    profiles: [{
      id: 'default',
      name: 'Default',
      createdAt: now,
      updatedAt: now,
      selections: {}
    }]
  };
}

function saveProfileStore() {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileStore));
}

function getActiveProfile() {
  let profile = profileStore.profiles.find(entry => entry.id === profileStore.activeProfileId);
  if (!profile) {
    profile = profileStore.profiles[0];
    profileStore.activeProfileId = profile.id;
  }
  profile.selections ||= {};
  return profile;
}

function touchActiveProfile() {
  getActiveProfile().updatedAt = new Date().toISOString();
}

function renderProfileSelect() {
  profileSelect.innerHTML = '';
  for (const profile of profileStore.profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name || 'Untitled';
    option.selected = profile.id === profileStore.activeProfileId;
    profileSelect.appendChild(option);
  }
  deleteProfileBtn.disabled = profileStore.profiles.length <= 1;
}

function createProfile(name, selections = {}) {
  const now = new Date().toISOString();
  const profile = {
    id: uniqueProfileId(),
    name: uniqueProfileName(name || 'New Profile'),
    createdAt: now,
    updatedAt: now,
    selections
  };
  profileStore.profiles.push(profile);
  profileStore.activeProfileId = profile.id;
  saveProfileStore();
  renderProfileSelect();
  renderPackedCategories(sheetData.categories || []);
  return profile;
}

function uniqueProfileId() {
  const existing = new Set(profileStore.profiles.map(profile => profile.id));
  let id;
  do {
    id = `profile_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
  } while (existing.has(id));
  return id;
}

function uniqueProfileName(baseName, ignoreProfileId = null) {
  const base = String(baseName || 'Profile').trim() || 'Profile';
  const existing = new Set(
    profileStore.profiles
      .filter(profile => profile.id !== ignoreProfileId)
      .map(profile => profile.name)
  );
  if (!existing.has(base)) return base;

  let index = 2;
  while (existing.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

function exportActiveProfile() {
  const profile = getActiveProfile();
  const saveFile = {
    kind: 'consent-sheet-profile',
    version: 1,
    sheetId: getSheetId(sheetData),
    sheetTitle: sheetData.title || 'Consent Sheet',
    sourceProjectVersion: sheetData.projectVersion || null,
    sourceProjectRevision: sheetData.projectRevision || null,
    profileName: profile.name,
    savedAt: new Date().toISOString(),
    selections: profile.selections || {}
  };

  const blob = new Blob([JSON.stringify(saveFile, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slugifyFilename(profile.name)}-consent-sheet.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importProfileFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const imported = parseImportedProfile(parsed);
    const name = prompt('Profile name', imported.profileName || file.name.replace(/\.json$/i, ''));
    if (name === null) return;

    const result = sanitizeSelections(imported.selections);
    createProfile(name, result.selections);

    const ignored = result.ignoredCount > 0 ? ` Ignored ${result.ignoredCount} unknown saved value(s).` : '';
    setStatus(`Imported "${name}".${ignored}`, result.ignoredCount > 0 ? 'warn' : 'ok');
  } catch (error) {
    alert(`Could not import that file: ${error.message}`);
  }
}

function parseImportedProfile(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('The file is not a JSON object.');
  if (parsed.kind && parsed.kind !== 'consent-sheet-profile') throw new Error('The file is not a consent sheet profile.');
  if (!parsed.selections || typeof parsed.selections !== 'object' || Array.isArray(parsed.selections)) {
    throw new Error('The file does not contain profile selections.');
  }
  return {
    profileName: typeof parsed.profileName === 'string' ? parsed.profileName : 'Imported Profile',
    selections: parsed.selections
  };
}

function sanitizeSelections(rawSelections) {
  const stateIds = new Set((sheetData.states || []).map(state => state.id));
  const result = {};
  let ignoredCount = 0;

  for (const category of sheetData.categories || []) {
    const rawCategorySelections = rawSelections[category.id];
    if (!rawCategorySelections || typeof rawCategorySelections !== 'object' || Array.isArray(rawCategorySelections)) continue;

    for (const item of category.items || []) {
      const rawValue = rawCategorySelections[item.id];
      if (typeof rawValue === 'string') {
        if (stateIds.has(rawValue)) {
          result[category.id] ||= {};
          result[category.id][item.id] = rawValue;
        } else {
          ignoredCount += 1;
        }
        continue;
      }

      if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        const modeIds = new Set(getChoiceModes(category).map(mode => mode.id));
        const modeResult = {};
        for (const [modeId, stateId] of Object.entries(rawValue)) {
          if (modeIds.has(modeId) && stateIds.has(stateId)) {
            modeResult[modeId] = stateId;
          } else {
            ignoredCount += 1;
          }
        }
        if (Object.keys(modeResult).length > 0) {
          result[category.id] ||= {};
          result[category.id][item.id] = modeResult;
        }
      }
    }
  }

  return { selections: result, ignoredCount };
}

function cleanAllProfiles() {
  if (!sheetData) return;
  for (const profile of profileStore.profiles) {
    profile.selections = sanitizeSelections(profile.selections || {}).selections;
  }
  saveProfileStore();
}

function migrateLegacySelections() {
  if (!sheetData || localStorage.getItem(PROFILE_STORAGE_KEY)) return;

  for (const key of LEGACY_SELECTION_KEYS) {
    try {
      const legacy = JSON.parse(localStorage.getItem(key) || 'null');
      if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) continue;

      const converted = convertLegacySelections(legacy);
      if (Object.keys(converted).length === 0) continue;

      getActiveProfile().selections = converted;
      saveProfileStore();
      return;
    } catch {
      continue;
    }
  }
}

function convertLegacySelections(legacy) {
  const converted = {};
  for (const category of sheetData.categories || []) {
    for (const item of category.items || []) {
      const value = legacy[item.id];
      if (value === undefined) continue;
      converted[category.id] ||= {};
      converted[category.id][item.id] = value;
    }
  }
  return sanitizeSelections(converted).selections;
}

function pruneEmptyCategory(selections, categoryId) {
  if (selections[categoryId] && Object.keys(selections[categoryId]).length === 0) {
    delete selections[categoryId];
  }
}

function getSheetId(data) {
  return data?.id || slugifyFilename(data?.title || 'consent-sheet');
}

function setStatus(message, tone = '') {
  statusEl.textContent = message;
  statusEl.hidden = !message;
  statusEl.classList.toggle('is-ok', tone === 'ok');
  statusEl.classList.toggle('is-warn', tone === 'warn');
}

function getManualColumnCount(data) {
  const configured = Number(data?.displaySettings?.columnCount);
  if (Number.isFinite(configured)) return Math.max(1, Math.min(12, Math.round(configured)));
  return getResponsiveColumnCount();
}

function getCategoryColumnIndex(category, columnCount) {
  const column = Number(category?.column || category?.layoutPosition?.column || 1);
  if (!Number.isFinite(column)) return 0;
  return Math.max(0, Math.min(columnCount - 1, Math.round(column) - 1));
}

function getCategorySortOrder(category, fallbackIndex) {
  const order = Number(category?.order ?? category?.layoutPosition?.order ?? fallbackIndex + 1);
  return Number.isFinite(order) ? order : fallbackIndex + 1;
}

function getManualCategoryOrder(categories, columnCount) {
  return [...categories]
    .map((category, index) => ({ category, index }))
    .sort((a, b) => {
      const colDiff = getCategoryColumnIndex(a.category, columnCount) - getCategoryColumnIndex(b.category, columnCount);
      if (colDiff !== 0) return colDiff;
      const orderDiff = getCategorySortOrder(a.category, a.index) - getCategorySortOrder(b.category, b.index);
      return orderDiff !== 0 ? orderDiff : a.index - b.index;
    })
    .map(entry => entry.category);
}

function applySheetContentWidth(data, columnCount) {
  const settings = data?.displaySettings || {};
  const columnWidth = clampNumber(settings.columnWidthPx, 0, 900, 0);

  if (columnWidth <= 0) {
    appShell.style.setProperty('--sheet-content-width', '100%');
    return;
  }

  const columnGap = clampNumber(settings.columnGapPx, 0, 80, 5);
  const outerPadding = clampNumber(settings.outerColumnPaddingPx, 0, 120, 5);
  const safeColumnCount = Math.max(1, Math.min(12, Math.round(Number(columnCount) || 1)));
  const totalWidth = (safeColumnCount * columnWidth) + ((safeColumnCount - 1) * columnGap) + (outerPadding * 2);

  appShell.style.setProperty('--sheet-content-width', `${totalWidth}px`);
}

function applyDisplaySettings(data) {
  const settings = data?.displaySettings || {};
  const headerPt = clampNumber(settings.headerTextPt, 6, 24, 10.5);
  const bodyPt = clampNumber(settings.bodyTextPt, 6, 24, 8.5);
  const headerHeight = clampNumber(settings.headerHeightPx, 10, 80, 20);
  const bodyLineHeight = clampNumber(settings.bodyLineHeightPx, 8, 60, 17);
  const pipSize = clampNumber(settings.pipSizePx ?? settings.circleSizePx, 5, 30, 11);
  const columnGap = clampNumber(settings.columnGapPx, 0, 80, 5);
  const outerPadding = clampNumber(settings.outerColumnPaddingPx, 0, 120, 5);
  const columnWidth = clampNumber(settings.columnWidthPx, 0, 900, 0);
  const categoryGap = clampNumber(settings.categoryGapPx, 0, 60, 5);
  const pairedPipGap = clampNumber(settings.pairedPipGapPx, 0, 80, 12);
  const pipGap = clampNumber(settings.pipGapPx, 0, 20, 1);
  const bodyTextPaddingLeft = clampNumber(settings.bodyTextPaddingLeftPx, 0, 40, 1);
  const categoryTitleColor = normalizeHexColor(settings.categoryHeaderTitleColor, '#ffffff');
  const modeLabelPt = clampNumber(settings.modeLabelTextPt, 5, 18, 8);
  const titlebarPaddingTop = clampNumber(settings.titlebarPaddingTopPx, 0, 120, 0);
  const titlebarPaddingBottom = clampNumber(settings.titlebarPaddingBottomPx, 0, 120, 5);

  appShell.style.setProperty('--category-header-pt', `${headerPt}pt`);
  appShell.style.setProperty('--body-text-pt', `${bodyPt}pt`);
  appShell.style.setProperty('--mode-label-text-pt', `${modeLabelPt}pt`);
  appShell.style.setProperty('--category-header-height', `${headerHeight}px`);
  appShell.style.setProperty('--row-min', `${bodyLineHeight}px`);
  appShell.style.setProperty('--circle', `${pipSize}px`);
  appShell.style.setProperty('--column-gap', `${columnGap}px`);
  appShell.style.setProperty('--outer-column-padding', `${outerPadding}px`);
  appShell.style.setProperty('--category-gap', `${categoryGap}px`);
  appShell.style.setProperty('--paired-pip-gap', `${pairedPipGap}px`);
  appShell.style.setProperty('--pip-gap', `${pipGap}px`);
  appShell.style.setProperty('--body-text-padding-left', `${bodyTextPaddingLeft}px`);
  appShell.style.setProperty('--category-title-color', categoryTitleColor);
  appShell.style.setProperty('--titlebar-padding-top', `${titlebarPaddingTop}px`);
  appShell.style.setProperty('--titlebar-padding-bottom', `${titlebarPaddingBottom}px`);
  appShell.style.setProperty('--column-width', columnWidth > 0 ? `${columnWidth}px` : 'minmax(0, 1fr)');
}

function normalizeHexColor(value, fallback = '#ffffff') {
  const text = String(value || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(text) || /^#[0-9a-fA-F]{6}$/.test(text)) return text;
  return fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function getResponsiveColumnCount() {
  const width = gridEl.clientWidth || window.innerWidth;
  if (width >= 1700) return 6;
  if (width >= 1450) return 5;
  if (width >= 1150) return 4;
  if (width >= 900) return 3;
  if (width >= 680) return 2;
  return 1;
}

function normalizeCategoryLayout(layout) {
  return ['single', 'double'].includes(layout) ? layout : 'auto';
}

function getCategoryLayoutClass(category) {
  return normalizeCategoryLayout(category.layout) === 'double' ? 'layout-double' : 'layout-single';
}

function getCategorySizeClass(category) {
  const count = category.items?.length || 0;
  if (count >= 15) return 'size-xl';
  if (count >= 10) return 'size-large';
  if (count >= 6) return 'size-medium';
  return 'size-small';
}

function getCategoryModeLabels(category) {
  if (Array.isArray(category?.modes) && category.modes.length > 0) {
    return category.modes.map(mode => mode.label).filter(Boolean);
  }
  return (category?.modeLabels || []).filter(Boolean);
}

function getSingleHeaderModes(category) {
  const labels = getCategoryModeLabels(category);
  const label = labels[0] || 'General';
  const id = Array.isArray(category?.modes) && category.modes[0]?.id ? category.modes[0].id : slugifyModeKey(label, 0);
  return [{ id, key: id, label }];
}

function getChoiceModes(category) {
  if (Array.isArray(category?.modes) && category.modes.length >= 2) {
    return category.modes.slice(0, 2).map((mode, index) => ({
      id: mode.id || `mode_${index + 1}`,
      key: mode.id || `mode_${index + 1}`,
      label: mode.label || `Mode ${index + 1}`
    }));
  }

  const labels = (category?.modeLabels || []).filter(Boolean);
  const activeLabels = labels.length >= 2 ? labels.slice(0, 2) : ['First', 'Second'];
  return activeLabels.map((label, index) => ({
    id: slugifyModeKey(label, index),
    key: slugifyModeKey(label, index),
    label
  }));
}

function slugifyModeKey(label, index) {
  const key = String(label || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return key || `mode-${index + 1}`;
}

function showTooltip(event, text) {
  tooltipEl.textContent = text;
  tooltipEl.hidden = false;
  moveTooltip(event);
}

function moveTooltip(event) {
  const x = Math.min(event.clientX + 14, window.innerWidth - tooltipEl.offsetWidth - 12);
  const y = Math.min(event.clientY + 16, window.innerHeight - tooltipEl.offsetHeight - 12);
  tooltipEl.style.left = `${Math.max(8, x)}px`;
  tooltipEl.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

function getCompactStateLabel(label) {
  const labels = {
    Favorite: 'Fav',
    Like: 'Like',
    Indifferent: 'Indif',
    Maybe: 'Maybe',
    Limit: 'Limit'
  };
  return labels[label] || label;
}

function slugifyFilename(value) {
  return String(value || 'profile')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'profile';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

profileSelect.addEventListener('change', () => {
  profileStore.activeProfileId = profileSelect.value;
  saveProfileStore();
  renderPackedCategories(sheetData.categories || []);
});

newProfileBtn.addEventListener('click', () => {
  const name = prompt('Profile name', 'New Profile');
  if (name === null) return;
  createProfile(name);
});

renameProfileBtn.addEventListener('click', () => {
  const profile = getActiveProfile();
  const name = prompt('Profile name', profile.name);
  if (name === null) return;
  profile.name = uniqueProfileName(name, profile.id);
  touchActiveProfile();
  saveProfileStore();
  renderProfileSelect();
});

deleteProfileBtn.addEventListener('click', () => {
  if (profileStore.profiles.length <= 1) return;
  const profile = getActiveProfile();
  if (!confirm(`Delete profile "${profile.name}" from this browser?`)) return;

  profileStore.profiles = profileStore.profiles.filter(entry => entry.id !== profile.id);
  profileStore.activeProfileId = profileStore.profiles[0].id;
  saveProfileStore();
  renderProfileSelect();
  renderPackedCategories(sheetData.categories || []);
});

resetBtn.addEventListener('click', () => {
  const profile = getActiveProfile();
  if (!confirm(`Reset all pips for "${profile.name}"?`)) return;
  profile.selections = {};
  touchActiveProfile();
  saveProfileStore();
  renderPackedCategories(sheetData.categories || []);
});

exportBtn.addEventListener('click', exportActiveProfile);
importBtn.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', importProfileFile);

screenshotBtn.addEventListener('click', () => {
  appShell.dataset.mode = 'screenshot';
  setStatus('', '');
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && appShell.dataset.mode === 'screenshot') {
    appShell.dataset.mode = 'normal';
  }
});

window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (sheetData) renderPackedCategories(sheetData.categories || []);
  }, RESIZE_DEBOUNCE_MS);
});
