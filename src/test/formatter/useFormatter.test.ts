import * as assert from 'assert';
import {
  formatUseStatement,
  formatGroupedImports,
  formatUseTree,
} from '../../formatter/useFormatter';
import { parseUseStatement } from '../../parser/useParser';
import { ImportCategory, GroupedImports } from '../../parser/types';

suite('UseFormatter Test Suite', () => {
  suite('formatUseTree', () => {
    test('formats simple path', () => {
      const stmt = parseUseStatement('use std::io;');
      const ioTree = stmt.tree.children![0];
      assert.strictEqual(formatUseTree(ioTree), 'io');
    });

    test('formats glob', () => {
      const stmt = parseUseStatement('use std::io::*;');
      const globTree = stmt.tree.children![0].children![0];
      assert.strictEqual(formatUseTree(globTree), '*');
    });

    test('formats self', () => {
      const stmt = parseUseStatement('use std::io::{self};');
      const selfTree = stmt.tree.children![0].children![0];
      assert.strictEqual(formatUseTree(selfTree), 'self');
    });

    test('formats alias', () => {
      const stmt = parseUseStatement('use std::result::Result as StdResult;');
      const resultTree = stmt.tree.children![0].children![0];
      assert.strictEqual(formatUseTree(resultTree), 'Result as StdResult');
    });
  });

  suite('formatUseStatement', () => {
    test('formats simple use statement', () => {
      const stmt = parseUseStatement('use std::io;');
      const formatted = formatUseStatement(stmt);
      assert.strictEqual(formatted, 'use std::io;');
    });

    test('formats nested use statement with multiple children', () => {
      const stmt = parseUseStatement('use std::{io, fs};');
      const formatted = formatUseStatement(stmt);
      // Should be multi-line and sorted
      assert.ok(formatted.includes('use std::{'));
      assert.ok(formatted.includes('    fs,'));
      assert.ok(formatted.includes('    io,'));
      assert.ok(formatted.includes('}'));
    });

    test('formats with visibility', () => {
      const stmt = parseUseStatement('pub use crate::module;');
      const formatted = formatUseStatement(stmt);
      assert.ok(formatted.startsWith('pub use '));
    });

    test('formats with pub(crate)', () => {
      const stmt = parseUseStatement('pub(crate) use super::module;');
      const formatted = formatUseStatement(stmt);
      assert.ok(formatted.startsWith('pub(crate) use '));
    });

    test('formats with attributes', () => {
      const stmt = parseUseStatement('use crate::test_utils;', [
        '#[cfg(test)]',
      ]);
      const formatted = formatUseStatement(stmt);
      assert.ok(formatted.startsWith('#[cfg(test)]'));
      assert.ok(formatted.includes('use crate::test_utils;'));
    });

    test('formats deeply nested structure', () => {
      const stmt = parseUseStatement('use std::{io::{Read, Write}, fs::File};');
      const formatted = formatUseStatement(stmt);
      // Should have proper nesting
      assert.ok(formatted.includes('use std::'));
      assert.ok(formatted.includes('fs::File'));
      assert.ok(formatted.includes('io::'));
    });

    test('formats self in nested import', () => {
      const stmt = parseUseStatement('use std::io::{self, Read};');
      const formatted = formatUseStatement(stmt);
      assert.ok(formatted.includes('self,'));
      assert.ok(formatted.includes('Read,'));
    });

    test('sorts children alphabetically with self first', () => {
      const stmt = parseUseStatement('use std::{zz, aa, mm};');
      const formatted = formatUseStatement(stmt);
      // Check the order in the formatted string
      const aaIndex = formatted.indexOf('aa');
      const mmIndex = formatted.indexOf('mm');
      const zzIndex = formatted.indexOf('zz');
      assert.ok(aaIndex < mmIndex, 'aa should come before mm');
      assert.ok(mmIndex < zzIndex, 'mm should come before zz');
    });
  });

  suite('formatGroupedImports', () => {
    test('formats single group', () => {
      const groups: GroupedImports[] = [
        {
          category: ImportCategory.Std,
          imports: [
            parseUseStatement('use std::io;'),
            parseUseStatement('use std::fs;'),
          ],
        },
      ];

      const formatted = formatGroupedImports(groups);
      assert.ok(formatted.includes('use std::io;'));
      assert.ok(formatted.includes('use std::fs;'));
    });

    test('separates groups with blank lines', () => {
      const groups: GroupedImports[] = [
        {
          category: ImportCategory.Std,
          imports: [parseUseStatement('use std::io;')],
        },
        {
          category: ImportCategory.External,
          imports: [parseUseStatement('use serde::Deserialize;')],
        },
      ];

      const formatted = formatGroupedImports(groups);
      // Should have a blank line between groups
      assert.ok(formatted.includes('\n\n'));
    });

    test('handles empty groups array', () => {
      const formatted = formatGroupedImports([]);
      assert.strictEqual(formatted, '');
    });

    test('formats attributed imports correctly', () => {
      const groups: GroupedImports[] = [
        {
          category: ImportCategory.Attributed,
          imports: [
            parseUseStatement('use crate::test_utils;', ['#[cfg(test)]']),
          ],
        },
      ];

      const formatted = formatGroupedImports(groups);
      assert.ok(formatted.includes('#[cfg(test)]'));
      assert.ok(formatted.includes('use crate::test_utils;'));
    });

    test('preserves group order', () => {
      const groups: GroupedImports[] = [
        {
          category: ImportCategory.Std,
          imports: [parseUseStatement('use std::io;')],
        },
        {
          category: ImportCategory.External,
          imports: [parseUseStatement('use serde::Deserialize;')],
        },
        {
          category: ImportCategory.Internal,
          imports: [parseUseStatement('use crate::module;')],
        },
      ];

      const formatted = formatGroupedImports(groups);
      const stdIndex = formatted.indexOf('std::io');
      const serdeIndex = formatted.indexOf('serde');
      const crateIndex = formatted.indexOf('crate::module');

      assert.ok(stdIndex < serdeIndex, 'std should come before serde');
      assert.ok(serdeIndex < crateIndex, 'serde should come before crate');
    });
  });
});
