import * as assert from 'assert';
import { sortUseStatements, sortUseTree } from '../../transformer/sorter';
import { parseUseStatement } from '../../parser/useParser';

suite('Sorter Test Suite', () => {
  suite('sortUseStatements', () => {
    test('sorts alphabetically', () => {
      const statements = [
        parseUseStatement('use std::fs;'),
        parseUseStatement('use std::collections;'),
        parseUseStatement('use std::io;'),
      ];

      const sorted = sortUseStatements(statements);

      assert.strictEqual(sorted[0].tree.children?.[0].segment.name, 'collections');
      assert.strictEqual(sorted[1].tree.children?.[0].segment.name, 'fs');
      assert.strictEqual(sorted[2].tree.children?.[0].segment.name, 'io');
    });

    test('sorts by full path', () => {
      const statements = [
        parseUseStatement('use std::io::Write;'),
        parseUseStatement('use std::io::Read;'),
        parseUseStatement('use std::fs::File;'),
      ];

      const sorted = sortUseStatements(statements);

      // std::fs::File < std::io::Read < std::io::Write
      assert.strictEqual(sorted[0].tree.children?.[0].segment.name, 'fs');
      assert.strictEqual(sorted[1].tree.children?.[0].children?.[0].segment.name, 'Read');
      assert.strictEqual(sorted[2].tree.children?.[0].children?.[0].segment.name, 'Write');
    });
  });

  suite('sortUseTree', () => {
    test('self comes first', () => {
      const stmt = parseUseStatement('use std::io::{Read, self, Write};');
      const sorted = sortUseTree(stmt.tree);

      const ioChildren = sorted.children?.[0].children;
      assert.strictEqual(ioChildren?.[0].isSelf, true);
      assert.strictEqual(ioChildren?.[1].segment.name, 'Read');
      assert.strictEqual(ioChildren?.[2].segment.name, 'Write');
    });

    test('glob comes last', () => {
      const stmt = parseUseStatement('use std::io::{*, Read, Write};');
      const sorted = sortUseTree(stmt.tree);

      const ioChildren = sorted.children?.[0].children;
      assert.strictEqual(ioChildren?.[0].segment.name, 'Read');
      assert.strictEqual(ioChildren?.[1].segment.name, 'Write');
      assert.strictEqual(ioChildren?.[2].isGlob, true);
    });

    test('sorts children alphabetically', () => {
      const stmt = parseUseStatement('use std::{io, fs, collections};');
      const sorted = sortUseTree(stmt.tree);

      assert.strictEqual(sorted.children?.[0].segment.name, 'collections');
      assert.strictEqual(sorted.children?.[1].segment.name, 'fs');
      assert.strictEqual(sorted.children?.[2].segment.name, 'io');
    });

    test('sorts nested children recursively', () => {
      const stmt = parseUseStatement('use std::io::{Write, BufRead, Read};');
      const sorted = sortUseTree(stmt.tree);

      const ioChildren = sorted.children?.[0].children;
      assert.strictEqual(ioChildren?.[0].segment.name, 'BufRead');
      assert.strictEqual(ioChildren?.[1].segment.name, 'Read');
      assert.strictEqual(ioChildren?.[2].segment.name, 'Write');
    });

    test('handles deeply nested structures', () => {
      const stmt = parseUseStatement('use std::{io::{Write, Read}, collections::{HashMap, BTreeMap}};');
      const sorted = sortUseTree(stmt.tree);

      // collections < io
      assert.strictEqual(sorted.children?.[0].segment.name, 'collections');
      assert.strictEqual(sorted.children?.[1].segment.name, 'io');

      // BTreeMap < HashMap
      const collectionsChildren = sorted.children?.[0].children;
      assert.strictEqual(collectionsChildren?.[0].segment.name, 'BTreeMap');
      assert.strictEqual(collectionsChildren?.[1].segment.name, 'HashMap');

      // Read < Write
      const ioChildren = sorted.children?.[1].children;
      assert.strictEqual(ioChildren?.[0].segment.name, 'Read');
      assert.strictEqual(ioChildren?.[1].segment.name, 'Write');
    });

    test('self before alphabetical, glob after', () => {
      const stmt = parseUseStatement('use foo::{*, Bar, self, Aaa};');
      const sorted = sortUseTree(stmt.tree);

      const children = sorted.children;
      assert.strictEqual(children?.[0].isSelf, true);
      assert.strictEqual(children?.[1].segment.name, 'Aaa');
      assert.strictEqual(children?.[2].segment.name, 'Bar');
      assert.strictEqual(children?.[3].isGlob, true);
    });
  });
});
