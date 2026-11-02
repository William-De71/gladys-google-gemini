// -----------------------------------------------------------------------------
// Non-regression of everything users store: every key of the manifest a
// scene, a widget or a saved configuration refers to — the configuration keys
// and the values of its selects (a stored model id), the button, the widget,
// the triggers (fields, options, variables), the scene actions (none yet:
// fields, outputs). An AI provider publishes no device.
//
// test/fixtures/manifest.baseline.json was generated from version 0.1.0 (the
// first release). A failure here means existing users would lose a setting, a
// scene or a widget: never update the baseline without a documented migration
// (UPDATE_BASELINE=1 npm test rewrites it, on purpose only).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const keys = (list) => (list ?? []).map((item) => item.key);
const byKey = (list) => new Map((list ?? []).map((item) => [item.key, item]));
const optionsOf = (field) => (field.options ?? []).map((option) => option.value);

/**
 * @description The keys of the manifest users store.
 * @returns {object} The keys.
 */
export function manifestKeys() {
  return {
    config_schema: manifest.config_schema.map((field) => ({
      key: field.key,
      type: field.type,
      options: optionsOf(field),
    })),
    actions: keys(manifest.actions),
    widgets: manifest.widgets.map((w) => ({ key: w.key, settings: keys(w.settings) })),
    scene_triggers: manifest.scene_triggers.map((trigger) => ({
      key: trigger.key,
      fields: (trigger.fields ?? []).map((field) => ({
        key: field.key,
        options: optionsOf(field),
      })),
      variables: (trigger.variables ?? []).map(({ key, type }) => ({ key, type })),
    })),
    scene_actions: (manifest.scene_actions ?? []).map((action) => ({
      key: action.key,
      fields: action.fields.map(({ key, type, required }) => ({
        key,
        type,
        required: required === true,
      })),
      outputs: action.outputs.map(({ key, type }) => ({ key, type })),
    })),
  };
}

if (process.env.UPDATE_BASELINE === '1') {
  writeFileSync(
    new URL('./fixtures/manifest.baseline.json', import.meta.url),
    `${JSON.stringify(manifestKeys(), null, 2)}\n`,
  );
}
const baseline = read('./fixtures/manifest.baseline.json');

test('no configuration key, select value or button disappears', () => {
  const config = byKey(manifest.config_schema);
  for (const { key, type, options } of baseline.config_schema) {
    const field = config.get(key);
    assert.equal(field?.type, type, `config_schema.${key}`);
    options.forEach((value) => assert.ok(optionsOf(field).includes(value), `${key}: ${value}`));
  }
  baseline.actions.forEach((key) => assert.ok(keys(manifest.actions).includes(key), key));
});

test('the widget and the scene triggers keep their keys, options and variables', () => {
  const widgets = byKey(manifest.widgets);
  for (const widget of baseline.widgets) {
    assert.ok(widgets.has(widget.key), widget.key);
    widget.settings.forEach((key) =>
      assert.ok(keys(widgets.get(widget.key).settings).includes(key)),
    );
  }
  const triggers = byKey(manifest.scene_triggers);
  for (const trigger of baseline.scene_triggers) {
    const now = triggers.get(trigger.key);
    assert.ok(now, trigger.key);
    const fields = byKey(now.fields);
    for (const { key, options } of trigger.fields) {
      assert.ok(fields.has(key), `${trigger.key}.${key}`);
      options.forEach((value) =>
        assert.ok(optionsOf(fields.get(key)).includes(value), `${key}: ${value}`),
      );
    }
    const variables = byKey(now.variables);
    for (const { key, type } of trigger.variables) {
      assert.equal(variables.get(key)?.type, type, `${trigger.key}.variables.${key}`);
    }
  }
});

test('the scene action keeps its fields and outputs, and gains no required field', () => {
  const actions = byKey(manifest.scene_actions);
  for (const action of baseline.scene_actions) {
    const now = actions.get(action.key);
    assert.ok(now, action.key);
    const fields = byKey(now.fields);
    for (const { key, type } of action.fields) {
      assert.equal(fields.get(key)?.type, type, `${action.key}.${key}`);
    }
    // A new required field without default would break the saved scenes.
    const known = new Set(action.fields.map((field) => field.key));
    for (const field of now.fields.filter((f) => !known.has(f.key))) {
      assert.ok(
        field.required !== true || field.default !== undefined,
        `${action.key}.${field.key}`,
      );
    }
    const outputs = byKey(now.outputs);
    for (const { key, type } of action.outputs) {
      assert.equal(outputs.get(key)?.type, type, `${action.key}.outputs.${key}`);
    }
  }
});
