import * as assert from 'assert';
import {
  filterUnusedImports,
  createUseStatementsFromPaths,
  type UnusedImportDiagnostic,
} from '../../rustAnalyzer/integration';
import { parseUseStatement } from '../../parser/useParser';
import { formatUseStatement } from '../../formatter/useFormatter';

/**
 * Create an UnusedImportDiagnostic by finding a symbol's position in the use statement string.
 * Uses indexOf to find the column position (assumes line 0).
 * @param startIndex - optional start index for searching (to handle duplicate symbols)
 */
function diagAt(
  useStr: string,
  symbolName: string,
  startIndex: number = 0,
): UnusedImportDiagnostic {
  const idx = useStr.indexOf(symbolName, startIndex);
  if (idx === -1) {
    throw new Error(
      `Symbol "${symbolName}" not found in "${useStr}" starting at ${startIndex}`,
    );
  }
  return {
    range: {
      start: { line: 0, column: idx },
      end: { line: 0, column: idx + symbolName.length },
    },
  };
}

suite('Integration Test Suite', () => {
  suite('filterUnusedImports', () => {
    test('removes underscore alias version when both exist', () => {
      // use std::{fmt::Write, fmt::Write as _}
      // with Write as _ unused -> should remove `fmt::Write as _`, keep `fmt::Write`
      const useStr = 'use std::{fmt::Write, fmt::Write as _};';
      const statements = [parseUseStatement(useStr)];

      // Point diagnostic at the second "Write" (the `as _` one)
      const firstWriteEnd = useStr.indexOf('Write') + 'Write'.length;
      const diags = [diagAt(useStr, 'Write', firstWriteEnd)];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.strictEqual(formatted, 'use std::fmt::Write;');
    });

    test('removes non-underscore version when only that exists', () => {
      // use std::fmt::Write
      // with Write as unused -> should remove it
      const useStr = 'use std::fmt::Write;';
      const statements = [parseUseStatement(useStr)];
      const diags = [diagAt(useStr, 'Write')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 0);
    });

    test('removes underscore version when only that exists', () => {
      // use std::fmt::Write as _
      // with Write as unused -> should remove it
      const useStr = 'use std::fmt::Write as _;';
      const statements = [parseUseStatement(useStr)];
      const diags = [diagAt(useStr, 'Write')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 0);
    });

    test('handles mixed underscore and non-underscore across different paths', () => {
      // use std::{fmt::Write, fmt::Write as _, fs::File, io::Write as _}
      // Diagnostics point at: fmt::Write as _ and io::Write as _
      const useStr =
        'use std::{fmt::Write, fmt::Write as _, fs::File, io::Write as _};';
      const statements = [parseUseStatement(useStr)];

      // Find the second Write (fmt::Write as _) and the third Write (io::Write as _)
      const firstEnd = useStr.indexOf('Write') + 'Write'.length;
      const secondEnd = useStr.indexOf('Write', firstEnd) + 'Write'.length;

      const diags = [
        diagAt(useStr, 'Write', firstEnd), // fmt::Write as _
        diagAt(useStr, 'Write', secondEnd), // io::Write as _
      ];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.ok(formatted.includes('fmt::Write'), 'should keep fmt::Write');
      assert.ok(formatted.includes('fs::File'), 'should keep fs::File');
      assert.ok(!formatted.includes('as _'), 'should not have any as _');
    });

    test('keeps non-unused symbols untouched', () => {
      // use std::{fmt::Write, io::Read}
      // with Write unused -> should remove fmt::Write, keep io::Read
      const useStr = 'use std::{fmt::Write, io::Read};';
      const statements = [parseUseStatement(useStr)];
      const diags = [diagAt(useStr, 'Write')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.ok(!formatted.includes('Write'), 'should not have Write');
      assert.ok(formatted.includes('Read'), 'should keep Read');
    });

    test('returns same imports when no unused diagnostics', () => {
      const statements = [parseUseStatement('use std::fmt::Write;')];
      const diags: UnusedImportDiagnostic[] = [];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 1);
    });

    test('handles multiple statements', () => {
      const useStr1 = 'use std::fmt::Write;';
      const useStr2 = 'use std::io::Read;';
      const statements = [
        parseUseStatement(useStr1),
        parseUseStatement(useStr2),
      ];
      // Only Write is unused
      const diags = [diagAt(useStr1, 'Write')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.ok(formatted.includes('Read'), 'should keep Read');
    });

    test('removes all when both statements have unused', () => {
      const useStr1 = 'use std::fmt::Write;';
      const useStr2 = 'use std::fmt::Write as _;';
      const statements = [
        parseUseStatement(useStr1),
        parseUseStatement(useStr2),
      ];
      const diags = [diagAt(useStr1, 'Write'), diagAt(useStr2, 'Write')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 0);
    });

    test('ignores diagnostics that do not match any span', () => {
      // Diagnostic at a location that doesn't match any import span
      const useStr = 'use std::fmt::Write;';
      const statements = [parseUseStatement(useStr)];
      const diags: UnusedImportDiagnostic[] = [
        {
          range: {
            start: { line: 5, column: 0 },
            end: { line: 5, column: 10 },
          },
        },
      ];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(
        filtered.length,
        1,
        'should keep all imports when diagnostic does not match',
      );
    });

    test('handles self in use group - only self unused', () => {
      // use std::env::{self, args}
      // Diagnostic points at "self" -> remove self, keep args
      const useStr = 'use std::env::{self, args};';
      const statements = [parseUseStatement(useStr)];
      const diags = [diagAt(useStr, 'self')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.ok(formatted.includes('args'), 'should keep args');
      assert.ok(!formatted.includes('self'), 'should not have self');
    });

    test('handles self in use group - only args unused', () => {
      // use std::env::{self, args}
      // Diagnostic points at "args" -> remove args, keep self (as env)
      const useStr = 'use std::env::{self, args};';
      const statements = [parseUseStatement(useStr)];
      const diags = [diagAt(useStr, 'args')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 1);
      const formatted = formatUseStatement(filtered[0]);
      assert.strictEqual(formatted, 'use std::env;');
    });

    test('handles self in use group - both unused', () => {
      // use std::env::{self, args}
      // Both self and args are unused -> remove entire statement
      const useStr = 'use std::env::{self, args};';
      const statements = [parseUseStatement(useStr)];
      const diags = [diagAt(useStr, 'self'), diagAt(useStr, 'args')];

      const filtered = filterUnusedImports(statements, diags);

      assert.strictEqual(filtered.length, 0, 'should remove entire statement');
    });

    test('handles simple use - diagnostic points at segment', () => {
      // use std::env;
      // Diagnostic points at "env" -> remove entire statement
      const useStr = 'use std::env;';
      const statements = [parseUseStatement(useStr)];
      const diags = [diagAt(useStr, 'env')];

      const filtered = filterUnusedImports(statements, diags);

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
