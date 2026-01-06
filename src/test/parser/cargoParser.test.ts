import * as assert from 'assert';
import * as path from 'path';
import {
  parseCargoDependencies,
  normalizeCrateName,
  isDependency,
  isStdLibrary,
  isInternalImport,
} from '../../parser/cargoParser';

suite('CargoParser Test Suite', () => {
  const fixturesPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'src',
    'test',
    'fixtures',
  );
  const cargoTomlPath = path.join(fixturesPath, 'Cargo.toml');

  suite('parseCargoDependencies', () => {
    test('parses regular dependencies', () => {
      const result = parseCargoDependencies(cargoTomlPath);
      assert.ok(result.dependencies.has('serde'));
      assert.ok(result.dependencies.has('tokio'));
      assert.ok(result.dependencies.has('reqwest'));
    });

    test('handles renamed packages', () => {
      const result = parseCargoDependencies(cargoTomlPath);
      // my-custom-crate = { package = "actual-crate-name" }
      // The actual import name is actual_crate_name
      assert.ok(result.dependencies.has('actual_crate_name'));
    });

    test('normalizes crate names with hyphens', () => {
      const result = parseCargoDependencies(cargoTomlPath);
      // my-custom-crate -> my_custom_crate (but this one is renamed to actual-crate-name)
      // The key is normalized too when package attribute is present
      assert.ok(result.dependencies.has('actual_crate_name'));
    });

    test('parses dev-dependencies', () => {
      const result = parseCargoDependencies(cargoTomlPath);
      assert.ok(result.devDependencies.has('mockall'));
      assert.ok(result.devDependencies.has('test_case'));
    });

    test('parses build-dependencies', () => {
      const result = parseCargoDependencies(cargoTomlPath);
      assert.ok(result.buildDependencies.has('cc'));
    });

    test('returns empty sets for non-existent file', () => {
      const result = parseCargoDependencies('/non/existent/path/Cargo.toml');
      assert.strictEqual(result.dependencies.size, 0);
      assert.strictEqual(result.devDependencies.size, 0);
      assert.strictEqual(result.buildDependencies.size, 0);
    });
  });

  suite('normalizeCrateName', () => {
    test('replaces hyphens with underscores', () => {
      assert.strictEqual(normalizeCrateName('my-crate'), 'my_crate');
    });

    test('handles multiple hyphens', () => {
      assert.strictEqual(normalizeCrateName('my-cool-crate'), 'my_cool_crate');
    });

    test('leaves names without hyphens unchanged', () => {
      assert.strictEqual(normalizeCrateName('serde'), 'serde');
    });
  });

  suite('isDependency', () => {
    test('returns true for regular dependencies', () => {
      const deps = parseCargoDependencies(cargoTomlPath);
      assert.ok(isDependency('serde', deps));
      assert.ok(isDependency('tokio', deps));
    });

    test('returns true for dev-dependencies', () => {
      const deps = parseCargoDependencies(cargoTomlPath);
      assert.ok(isDependency('mockall', deps));
    });

    test('returns true for build-dependencies', () => {
      const deps = parseCargoDependencies(cargoTomlPath);
      assert.ok(isDependency('cc', deps));
    });

    test('returns false for unknown crates', () => {
      const deps = parseCargoDependencies(cargoTomlPath);
      assert.ok(!isDependency('unknown_crate', deps));
    });
  });

  suite('isStdLibrary', () => {
    test('returns true for std', () => {
      assert.ok(isStdLibrary('std'));
    });

    test('returns true for core', () => {
      assert.ok(isStdLibrary('core'));
    });

    test('returns true for alloc', () => {
      assert.ok(isStdLibrary('alloc'));
    });

    test('returns false for other crates', () => {
      assert.ok(!isStdLibrary('serde'));
      assert.ok(!isStdLibrary('tokio'));
    });
  });

  suite('isInternalImport', () => {
    test('returns true for crate', () => {
      assert.ok(isInternalImport('crate'));
    });

    test('returns true for super', () => {
      assert.ok(isInternalImport('super'));
    });

    test('returns true for self', () => {
      assert.ok(isInternalImport('self'));
    });

    test('returns false for external crates', () => {
      assert.ok(!isInternalImport('std'));
      assert.ok(!isInternalImport('serde'));
    });
  });
});
