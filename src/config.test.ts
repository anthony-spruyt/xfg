import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, convertJsonToString } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, '..', 'fixtures');

describe('Config', () => {
  test('loadConfig parses YAML correctly', () => {
    const configPath = join(fixturesDir, 'test-repos-input.yaml');
    const config = loadConfig(configPath);

    assert.equal(config.fileName, 'my.config.json');
    assert.equal(Array.isArray(config.repos), true);
    assert.equal(config.repos.length >= 1, true);
    assert.equal(typeof config.repos[0].git, 'string');
    assert.equal(typeof config.repos[0].json, 'object');
  });

  test('convertJsonToString produces valid JSON', () => {
    const input = { key: 'value', nested: { foo: 'bar' } };
    const result = convertJsonToString(input);
    const parsed = JSON.parse(result);

    assert.deepEqual(parsed, input);
  });

  test('YAML to JSON conversion matches expected output', () => {
    const configPath = join(fixturesDir, 'test-repos-input.yaml');
    const expectedPath = join(fixturesDir, 'test-repo-output.json');

    const config = loadConfig(configPath);
    const actualJson = convertJsonToString(config.repos[0].json);
    const expectedJson = readFileSync(expectedPath, 'utf-8').trim();

    // Parse both to compare as objects (ignoring whitespace differences)
    const actual = JSON.parse(actualJson);
    const expected = JSON.parse(expectedJson);

    assert.deepEqual(actual, expected,
      `Conversion mismatch:\nActual: ${JSON.stringify(actual, null, 2)}\nExpected: ${JSON.stringify(expected, null, 2)}`
    );
  });
});
