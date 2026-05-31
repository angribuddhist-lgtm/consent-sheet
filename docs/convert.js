const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'sheet-data.json');
const targetPath = path.join(__dirname, 'sheet-data.json');

main();

function main() {
  const source = readJson(sourcePath);
  const errors = validateSheet(source);

  if (errors.length > 0) {
    console.error('Conversion stopped. Fix these sheet-data.json issues first:\n');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  const output = createRuntimeSheet(source);
  fs.writeFileSync(targetPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const categoryCount = output.categories.length;
  const itemCount = output.categories.reduce((total, category) => total + category.items.length, 0);
  const modeCount = output.categories.reduce((total, category) => total + (category.modes || []).length, 0);

  console.log(`Validated ${categoryCount} categories, ${itemCount} items, and ${modeCount} modes.`);
  console.log(`Wrote ${path.relative(rootDir, targetPath)}.`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${filePath}: ${error.message}`);
    process.exit(1);
  }
}

function createRuntimeSheet(source) {
  return {
    schemaVersion: source.schemaVersion,
    title: source.title,
    audience: source.audience,
    states: source.states,
    categories: source.categories,
    displaySettings: source.displaySettings || {},
    projectVersion: source.projectVersion || null,
    projectRevision: source.projectRevision || 0,
    generatedAt: new Date().toISOString()
  };
}

function validateSheet(sheetData) {
  const errors = [];
  const ids = new Map();
  const stateIds = new Set();

  if (!sheetData || typeof sheetData !== 'object') return ['Sheet data must be a JSON object.'];
  if (!sheetData.schemaVersion) errors.push('schemaVersion is missing.');
  if (!Array.isArray(sheetData.states) || sheetData.states.length === 0) errors.push('states array is missing or empty.');
  if (!Array.isArray(sheetData.categories)) errors.push('categories array is missing.');

  for (const state of sheetData.states || []) {
    if (!state.id) errors.push('A state is missing an id.');
    if (state.id && stateIds.has(state.id)) errors.push(`Duplicate state id "${state.id}".`);
    if (state.id) stateIds.add(state.id);
    if (!state.label) errors.push(`State "${state.id || '(missing id)'}" is missing a label.`);
    if (!state.color) errors.push(`State "${state.id || '(missing id)'}" is missing a color.`);
  }

  for (const category of sheetData.categories || []) {
    trackId(category.id, `Category "${category.name || '(unnamed)'}"`, errors, ids);
    if (!isOpaqueId(category.id, 'cat')) errors.push(`Category "${category.name || category.id}" should use a stable opaque cat_ id.`);
    if (!category.name) errors.push(`Category "${category.id || '(missing id)'}" is missing a name.`);
    if (!Array.isArray(category.items)) errors.push(`Category "${category.name || category.id}" has no items array.`);

    for (const mode of category.modes || []) {
      trackId(mode.id, `Mode "${mode.label || '(unnamed)'}" in category "${category.name || category.id}"`, errors, ids);
      if (!isOpaqueId(mode.id, 'mode')) errors.push(`Mode "${mode.label || mode.id}" should use a stable opaque mode_ id.`);
      if (!mode.label) errors.push(`Mode "${mode.id || '(missing id)'}" is missing a label.`);
    }

    for (const item of category.items || []) {
      trackId(item.id, `Item "${item.label || '(unnamed)'}" in category "${category.name || category.id}"`, errors, ids);
      if (!isOpaqueId(item.id, 'itm')) errors.push(`Item "${item.label || item.id}" should use a stable opaque itm_ id.`);
      if (!item.label) errors.push(`Item "${item.id || '(missing id)'}" is missing a label.`);
      if (item.defaultState && !stateIds.has(item.defaultState)) {
        errors.push(`Item "${item.label || item.id}" uses unknown defaultState "${item.defaultState}".`);
      }
    }
  }

  return errors;
}

function trackId(id, label, errors, ids) {
  if (!id) {
    errors.push(`${label} is missing an id.`);
    return;
  }
  if (ids.has(id)) {
    errors.push(`Duplicate id "${id}" used by ${ids.get(id)} and ${label}.`);
    return;
  }
  ids.set(id, label);
}

function isOpaqueId(id, prefix) {
  return typeof id === 'string' && new RegExp(`^${prefix}_[a-z0-9]{8,}$`).test(id);
}
