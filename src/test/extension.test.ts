import * as assert from 'assert';
import * as path from 'path';
import { parseRustFile } from '../parser/useParser';
import { parseCargoDependencies } from '../parser/cargoParser';
import { groupImports } from '../transformer/grouper';
import { mergeGroupedStatements } from '../transformer/merger';
import { sortUseStatements } from '../transformer/sorter';
import { formatImportsForFile } from '../formatter/useFormatter';
import { GroupedImports } from '../parser/types';

suite('Extension Test Suite', () => {
  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});

suite('Integration Test Suite', () => {
  const fixturesPath = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'test',
    'fixtures',
  );
  const cargoTomlPath = path.join(fixturesPath, 'Cargo.toml');

  test('full pipeline: parse -> group -> merge -> sort -> format', () => {
    const input = `use serde::{Deserialize, Serialize};
use std::io::Read;
use crate::utils::helper;
use std::collections::HashMap;
use tokio::sync::mpsc;
use super::parent_module;
use std::io::Write;
#[cfg(test)]
use crate::test_helpers;

fn main() {}`;

    // Parse
    const parseResult = parseRustFile(input);
    assert.strictEqual(parseResult.imports.length, 8);

    // Get dependencies
    const cargoDeps = parseCargoDependencies(cargoTomlPath);

    // Group
    const groups = groupImports(parseResult.imports, cargoDeps);
    assert.ok(groups.length >= 3); // Std, External, Internal, Attributed

    // Merge and sort each group
    const processedGroups: GroupedImports[] = groups.map((group) => ({
      category: group.category,
      imports: sortUseStatements(mergeGroupedStatements(group.imports)),
    }));

    // Format
    const formatted = formatImportsForFile(processedGroups);

    // Verify output structure
    assert.ok(formatted.includes('use std::'), 'should include std imports');
    assert.ok(
      formatted.includes('use serde::'),
      'should include serde imports',
    );
    assert.ok(
      formatted.includes('use tokio::'),
      'should include tokio imports',
    );
    assert.ok(
      formatted.includes('use crate::'),
      'should include crate imports',
    );
    assert.ok(
      formatted.includes('use super::'),
      'should include super imports',
    );
    assert.ok(
      formatted.includes('#[cfg(test)]'),
      'should include cfg(test) attribute',
    );

    // Verify std imports are merged
    const stdSection = formatted.split('\n\n')[0];
    assert.ok(
      stdSection.includes('collections::HashMap'),
      'std should include HashMap',
    );
    assert.ok(stdSection.includes('io::'), 'std should include io');

    // Verify group separation
    const groupCount = (formatted.match(/\n\n/g) || []).length;
    assert.ok(
      groupCount >= 2,
      'should have multiple groups separated by blank lines',
    );
  });

  test('handles file with single import', () => {
    const input = `use std::io;

fn main() {}`;

    const parseResult = parseRustFile(input);
    assert.strictEqual(parseResult.imports.length, 1);

    const cargoDeps = parseCargoDependencies(cargoTomlPath);
    const groups = groupImports(parseResult.imports, cargoDeps);
    const formatted = formatImportsForFile(groups);

    assert.ok(formatted.includes('use std::io;'));
  });

  test('handles file with no imports', () => {
    const input = `fn main() {}`;

    const parseResult = parseRustFile(input);
    assert.strictEqual(parseResult.imports.length, 0);
  });

  test('correctly merges io imports', () => {
    const input = `use std::io::Read;
use std::io::Write;
use std::io;

fn main() {}`;

    const parseResult = parseRustFile(input);
    const cargoDeps = parseCargoDependencies(cargoTomlPath);
    const groups = groupImports(parseResult.imports, cargoDeps);
    const processedGroups: GroupedImports[] = groups.map((group) => ({
      category: group.category,
      imports: sortUseStatements(mergeGroupedStatements(group.imports)),
    }));
    const formatted = formatImportsForFile(processedGroups);

    // Should be merged into single statement with self
    assert.ok(formatted.includes('self'), 'should include self for std::io');
    assert.ok(formatted.includes('Read'), 'should include Read');
    assert.ok(formatted.includes('Write'), 'should include Write');
  });

  test('preserves pub visibility', () => {
    const input = `pub use crate::module::Type;
use std::io;

fn main() {}`;

    const parseResult = parseRustFile(input);
    const cargoDeps = parseCargoDependencies(cargoTomlPath);
    const groups = groupImports(parseResult.imports, cargoDeps);
    const formatted = formatImportsForFile(groups);

    assert.ok(formatted.includes('pub use'), 'should preserve pub visibility');
  });
});
