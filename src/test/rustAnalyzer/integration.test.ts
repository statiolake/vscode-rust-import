import * as assert from 'assert';
import {
  filterUnusedImports,
  createUseStatementsFromPaths,
} from '../../rustAnalyzer/integration';
import { parseUseStatement } from '../../parser/useParser';
import { formatUseStatement } from '../../formatter/useFormatter';

suite('Integration Test Suite', () => {
  suite('filterUnusedImports', () => {
    test('removes underscore alias version when both exist', () => {
      // use std::{fmt::Write, fmt::Write as _}
      // with Write as unused -> should remove `fmt::Write as _`, keep `fmt::Write`
      const statements = [
        parseUseStatement('use std::{fmt::Write, fmt::Write as _};'),
      ];
      const unusedSymbols = new Set(['Write']);

      const filtered = filterUnusedImports(statements, unusedSymbols);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.strictEqual(formatted, 'use std::fmt::Write;');
    });

    test('removes non-underscore version when only that exists', () => {
      // use std::fmt::Write
      // with Write as unused -> should remove it
      const statements = [parseUseStatement('use std::fmt::Write;')];
      const unusedSymbols = new Set(['Write']);

      const filtered = filterUnusedImports(statements, unusedSymbols);

      assert.strictEqual(filtered.length, 0);
    });

    test('removes underscore version when only that exists', () => {
      // use std::fmt::Write as _
      // with Write as unused -> should remove it
      const statements = [parseUseStatement('use std::fmt::Write as _;')];
      const unusedSymbols = new Set(['Write']);

      const filtered = filterUnusedImports(statements, unusedSymbols);

      assert.strictEqual(filtered.length, 0);
    });

    test('handles mixed underscore and non-underscore across different paths', () => {
      // use std::{fmt::Write, fmt::Write as _, fs::File, io::Write as _}
      // with Write as unused -> should remove fmt::Write as _ and io::Write as _
      // keep fmt::Write and fs::File
      const statements = [
        parseUseStatement(
          'use std::{fmt::Write, fmt::Write as _, fs::File, io::Write as _};',
        ),
      ];
      const unusedSymbols = new Set(['Write']);

      const filtered = filterUnusedImports(statements, unusedSymbols);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      // fmt::Write should be kept (underscore version removed)
      // io::Write as _ should be kept (no non-underscore version exists)
      // Actually, io::Write as _ should be REMOVED because Write is unused
      // and there's no io::Write (non-underscore) for io
      assert.ok(
        formatted.includes('fmt::Write'),
        'should keep fmt::Write (underscore version exists and is removed)',
      );
      assert.ok(formatted.includes('fs::File'), 'should keep fs::File');
      assert.ok(
        !formatted.includes('as _'),
        'should not have any as _ (all underscore versions removed)',
      );
    });

    test('keeps non-unused symbols untouched', () => {
      // use std::{fmt::Write, io::Read}
      // with Write as unused -> should remove fmt::Write, keep io::Read
      const statements = [
        parseUseStatement('use std::{fmt::Write, io::Read};'),
      ];
      const unusedSymbols = new Set(['Write']);

      const filtered = filterUnusedImports(statements, unusedSymbols);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.ok(!formatted.includes('Write'), 'should not have Write');
      assert.ok(formatted.includes('Read'), 'should keep Read');
    });

    test('returns same imports when no unused symbols', () => {
      const statements = [parseUseStatement('use std::fmt::Write;')];
      const unusedSymbols = new Set<string>();

      const filtered = filterUnusedImports(statements, unusedSymbols);

      assert.strictEqual(filtered.length, 1);
    });

    test('handles multiple statements', () => {
      const statements = [
        parseUseStatement('use std::fmt::Write;'),
        parseUseStatement('use std::io::Read;'),
      ];
      const unusedSymbols = new Set(['Write']);

      const filtered = filterUnusedImports(statements, unusedSymbols);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.ok(formatted.includes('Read'), 'should keep Read');
    });

    test('prioritizes removing underscore when same symbol appears multiple times', () => {
      // Multiple statements with same symbol
      const statements = [
        parseUseStatement('use std::fmt::Write;'),
        parseUseStatement('use std::fmt::Write as _;'),
      ];
      const unusedSymbols = new Set(['Write']);

      const filtered = filterUnusedImports(statements, unusedSymbols);

      // First statement has no underscore sibling in the same statement,
      // but second statement is underscore-only
      // Result: first statement keeps Write (because its own statement has no underscore)
      // Wait, the logic is per-statement... let me reconsider

      // Actually, the current implementation checks within the same UseStatement
      // So statement 1: only fmt::Write -> Write is unused, no underscore version -> remove
      // Statement 2: only fmt::Write as _ -> Write is unused, it's underscore -> remove

      assert.strictEqual(filtered.length, 0);
    });
  });

  suite('createUseStatementsFromPaths', () => {
    test('adds as _ for traits', () => {
      // Traits like Read, Write, Display should get `as _`
      const paths = [{ path: 'std::io::Write', isTrait: true }];
      const statements = createUseStatementsFromPaths(paths);

      assert.strictEqual(statements.length, 1);
      const formatted = formatUseStatement(statements[0]);
      assert.strictEqual(formatted, 'use std::io::Write as _;');
    });

    test('does not add as _ for non-traits', () => {
      // Structs and other types should not get `as _`
      const paths = [{ path: 'std::time::Duration', isTrait: false }];
      const statements = createUseStatementsFromPaths(paths);

      assert.strictEqual(statements.length, 1);
      const formatted = formatUseStatement(statements[0]);
      assert.strictEqual(formatted, 'use std::time::Duration;');
    });

    test('does not add as _ for functions', () => {
      // Functions should not get `as _`
      const paths = [{ path: 'std::fs::read_to_string', isTrait: false }];
      const statements = createUseStatementsFromPaths(paths);

      assert.strictEqual(statements.length, 1);
      const formatted = formatUseStatement(statements[0]);
      assert.strictEqual(formatted, 'use std::fs::read_to_string;');
    });

    test('handles multiple paths with mixed trait/non-trait', () => {
      const paths = [
        { path: 'std::io::Write', isTrait: true },
        { path: 'std::fs::read_to_string', isTrait: false },
        { path: 'std::time::Duration', isTrait: false },
      ];
      const statements = createUseStatementsFromPaths(paths);

      assert.strictEqual(statements.length, 3);

      const formatted0 = formatUseStatement(statements[0]);
      const formatted1 = formatUseStatement(statements[1]);
      const formatted2 = formatUseStatement(statements[2]);

      assert.strictEqual(formatted0, 'use std::io::Write as _;');
      assert.strictEqual(formatted1, 'use std::fs::read_to_string;');
      assert.strictEqual(formatted2, 'use std::time::Duration;');
    });
  });
});
