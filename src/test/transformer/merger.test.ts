import * as assert from 'assert';
import { mergeUseStatements, mergeGroupedStatements, needsBraces, countImports } from '../../transformer/merger';
import { parseUseStatement } from '../../parser/useParser';

suite('Merger Test Suite', () => {
  suite('mergeUseStatements', () => {
    test('merges two imports with same root', () => {
      const statements = [
        parseUseStatement('use std::io;'),
        parseUseStatement('use std::fs;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].tree.segment.name, 'std');
      assert.strictEqual(merged[0].tree.children?.length, 2);
    });

    test('creates self when merging parent and child imports', () => {
      const statements = [
        parseUseStatement('use std::io;'),
        parseUseStatement('use std::io::Read;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 1);
      const ioNode = merged[0].tree.children?.[0];
      assert.strictEqual(ioNode?.segment.name, 'io');
      assert.strictEqual(ioNode?.children?.length, 2);

      // Should have self and Read
      const selfChild = ioNode?.children?.find(c => c.isSelf);
      const readChild = ioNode?.children?.find(c => c.segment.name === 'Read');
      assert.ok(selfChild, 'should have self');
      assert.ok(readChild, 'should have Read');
    });

    test('preserves aliases', () => {
      const statements = [
        parseUseStatement('use std::io;'),
        parseUseStatement('use std::result::Result as StdResult;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 1);
      const resultChild = merged[0].tree.children?.find(c => c.segment.name === 'result');
      assert.strictEqual(resultChild?.children?.[0].segment.alias, 'StdResult');
    });

    test('handles deeply nested merging', () => {
      const statements = [
        parseUseStatement('use std::io::Read;'),
        parseUseStatement('use std::io::Write;'),
        parseUseStatement('use std::fs::File;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].tree.children?.length, 2); // fs and io

      const ioNode = merged[0].tree.children?.find(c => c.segment.name === 'io');
      assert.strictEqual(ioNode?.children?.length, 2); // Read and Write
    });

    test('preserves globs', () => {
      const statements = [
        parseUseStatement('use std::io::*;'),
        parseUseStatement('use std::fs;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 1);
      const ioNode = merged[0].tree.children?.find(c => c.segment.name === 'io');
      assert.ok(ioNode?.isGlob || ioNode?.children?.some(c => c.isGlob));
    });

    test('does not merge different roots', () => {
      const statements = [
        parseUseStatement('use std::io;'),
        parseUseStatement('use serde::Deserialize;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 2);
    });

    test('handles single import', () => {
      const statements = [
        parseUseStatement('use std::io;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].tree.segment.name, 'std');
    });

    test('handles empty input', () => {
      const merged = mergeUseStatements([]);
      assert.strictEqual(merged.length, 0);
    });

    test('merges complex nested imports', () => {
      const statements = [
        parseUseStatement('use std::collections::HashMap;'),
        parseUseStatement('use std::collections::BTreeMap;'),
        parseUseStatement('use std::io::{Read, Write};'),
        parseUseStatement('use std::fs::File;'),
      ];

      const merged = mergeUseStatements(statements);

      assert.strictEqual(merged.length, 1);

      const collectionsNode = merged[0].tree.children?.find(c => c.segment.name === 'collections');
      assert.strictEqual(collectionsNode?.children?.length, 2);

      const ioNode = merged[0].tree.children?.find(c => c.segment.name === 'io');
      assert.strictEqual(ioNode?.children?.length, 2);
    });
  });

  suite('mergeGroupedStatements', () => {
    test('separates by visibility', () => {
      const statements = [
        parseUseStatement('use std::io;'),
        parseUseStatement('pub use std::fs;'),
      ];

      const merged = mergeGroupedStatements(statements);

      // Should be separate because of different visibility
      assert.strictEqual(merged.length, 2);
    });

    test('merges same visibility together', () => {
      const statements = [
        parseUseStatement('pub use std::io;'),
        parseUseStatement('pub use std::fs;'),
      ];

      const merged = mergeGroupedStatements(statements);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].visibility, 'pub');
    });
  });

  suite('needsBraces', () => {
    test('returns false for simple path', () => {
      const stmt = parseUseStatement('use std::io;');
      assert.strictEqual(needsBraces(stmt.tree.children![0]), false);
    });

    test('returns true for multiple children', () => {
      const stmt = parseUseStatement('use std::{io, fs};');
      assert.strictEqual(needsBraces(stmt.tree), true);
    });

    test('returns true for self', () => {
      const stmt = parseUseStatement('use std::io::{self};');
      const ioNode = stmt.tree.children?.[0];
      assert.strictEqual(needsBraces(ioNode!), true);
    });

    test('returns true for glob', () => {
      const stmt = parseUseStatement('use std::io::{*};');
      const ioNode = stmt.tree.children?.[0];
      assert.strictEqual(needsBraces(ioNode!), true);
    });
  });

  suite('countImports', () => {
    test('counts single import', () => {
      const stmt = parseUseStatement('use std::io;');
      assert.strictEqual(countImports(stmt.tree), 1);
    });

    test('counts nested imports', () => {
      const stmt = parseUseStatement('use std::{io, fs};');
      assert.strictEqual(countImports(stmt.tree), 2);
    });

    test('counts deeply nested imports', () => {
      const stmt = parseUseStatement('use std::{io::{Read, Write}, fs};');
      assert.strictEqual(countImports(stmt.tree), 3);
    });

    test('counts self as one import', () => {
      const stmt = parseUseStatement('use std::io::{self, Read};');
      assert.strictEqual(countImports(stmt.tree), 2);
    });

    test('counts glob as one import', () => {
      const stmt = parseUseStatement('use std::io::*;');
      assert.strictEqual(countImports(stmt.tree), 1);
    });
  });
});
