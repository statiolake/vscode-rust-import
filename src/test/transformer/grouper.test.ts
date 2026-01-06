import * as assert from 'assert';
import * as path from 'path';
import { categorizeImport, groupImports } from '../../transformer/grouper';
import { parseUseStatement } from '../../parser/useParser';
import { parseCargoDependencies } from '../../parser/cargoParser';
import { ImportCategory, CargoDependencies } from '../../parser/types';

suite('Grouper Test Suite', () => {
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
  let cargoDeps: CargoDependencies;

  suiteSetup(() => {
    cargoDeps = parseCargoDependencies(cargoTomlPath);
  });

  suite('categorizeImport', () => {
    test('categorizes std as Std', () => {
      const stmt = parseUseStatement('use std::io;');
      assert.strictEqual(categorizeImport(stmt, cargoDeps), ImportCategory.Std);
    });

    test('categorizes core as Std', () => {
      const stmt = parseUseStatement('use core::fmt;');
      assert.strictEqual(categorizeImport(stmt, cargoDeps), ImportCategory.Std);
    });

    test('categorizes alloc as Std', () => {
      const stmt = parseUseStatement('use alloc::vec::Vec;');
      assert.strictEqual(categorizeImport(stmt, cargoDeps), ImportCategory.Std);
    });

    test('categorizes crate as Internal', () => {
      const stmt = parseUseStatement('use crate::module;');
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.Internal,
      );
    });

    test('categorizes super as Internal', () => {
      const stmt = parseUseStatement('use super::parent;');
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.Internal,
      );
    });

    test('categorizes self as Internal', () => {
      const stmt = parseUseStatement('use self::child;');
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.Internal,
      );
    });

    test('categorizes known dependency as External', () => {
      const stmt = parseUseStatement('use serde::Deserialize;');
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.External,
      );
    });

    test('categorizes tokio as External', () => {
      const stmt = parseUseStatement('use tokio::sync::mpsc;');
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.External,
      );
    });

    test('categorizes unknown crate as External', () => {
      const stmt = parseUseStatement('use unknown_crate::module;');
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.External,
      );
    });

    test('categorizes attributed import as Attributed', () => {
      const stmt = parseUseStatement('use crate::test_utils;', [
        '#[cfg(test)]',
      ]);
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.Attributed,
      );
    });

    test('categorizes multiple attributes as Attributed', () => {
      const stmt = parseUseStatement('use std::io;', [
        '#[cfg(test)]',
        '#[allow(unused)]',
      ]);
      assert.strictEqual(
        categorizeImport(stmt, cargoDeps),
        ImportCategory.Attributed,
      );
    });
  });

  suite('groupImports', () => {
    test('groups imports correctly', () => {
      const imports = [
        parseUseStatement('use std::io;'),
        parseUseStatement('use serde::Deserialize;'),
        parseUseStatement('use crate::module;'),
        parseUseStatement('use std::fs;'),
        parseUseStatement('use tokio::runtime;'),
        parseUseStatement('use super::parent;'),
      ];

      const groups = groupImports(imports, cargoDeps);

      // Should have 3 groups: Std, External, Internal
      assert.strictEqual(groups.length, 3);

      // First group: Std (std::io, std::fs)
      assert.strictEqual(groups[0].category, ImportCategory.Std);
      assert.strictEqual(groups[0].imports.length, 2);

      // Second group: External (serde, tokio)
      assert.strictEqual(groups[1].category, ImportCategory.External);
      assert.strictEqual(groups[1].imports.length, 2);

      // Third group: Internal (crate::, super::)
      assert.strictEqual(groups[2].category, ImportCategory.Internal);
      assert.strictEqual(groups[2].imports.length, 2);
    });

    test('separates attributed imports', () => {
      const imports = [
        parseUseStatement('use std::io;'),
        parseUseStatement('use crate::test_utils;', ['#[cfg(test)]']),
        parseUseStatement('use crate::module;'),
      ];

      const groups = groupImports(imports, cargoDeps);

      // Should have 3 groups: Std, Internal, Attributed
      assert.strictEqual(groups.length, 3);

      assert.strictEqual(groups[0].category, ImportCategory.Std);
      assert.strictEqual(groups[1].category, ImportCategory.Internal);
      assert.strictEqual(groups[2].category, ImportCategory.Attributed);
      assert.strictEqual(groups[2].imports.length, 1);
    });

    test('omits empty groups', () => {
      const imports = [
        parseUseStatement('use std::io;'),
        parseUseStatement('use std::fs;'),
      ];

      const groups = groupImports(imports, cargoDeps);

      // Should only have Std group
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].category, ImportCategory.Std);
    });

    test('handles empty imports', () => {
      const groups = groupImports([], cargoDeps);
      assert.strictEqual(groups.length, 0);
    });

    test('maintains correct group order', () => {
      const imports = [
        parseUseStatement('use crate::internal;'),
        parseUseStatement('use serde::Deserialize;'),
        parseUseStatement('use std::io;'),
        parseUseStatement('use crate::test;', ['#[cfg(test)]']),
      ];

      const groups = groupImports(imports, cargoDeps);

      // Order should be: Std, External, Internal, Attributed
      assert.strictEqual(groups[0].category, ImportCategory.Std);
      assert.strictEqual(groups[1].category, ImportCategory.External);
      assert.strictEqual(groups[2].category, ImportCategory.Internal);
      assert.strictEqual(groups[3].category, ImportCategory.Attributed);
    });
  });
});
