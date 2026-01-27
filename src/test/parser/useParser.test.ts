import * as assert from 'assert';
import {
  parseUseStatement,
  parseRustFile,
  getRootPath,
  flattenUseTree,
} from '../../parser/useParser';

suite('UseParser Test Suite', () => {
  suite('parseUseStatement', () => {
    test('parses simple use statement', () => {
      const result = parseUseStatement('use std::io;');
      assert.strictEqual(result.tree.segment.name, 'std');
      assert.strictEqual(result.tree.children?.length, 1);
      assert.strictEqual(result.tree.children?.[0].segment.name, 'io');
    });

    test('parses nested use statement', () => {
      const result = parseUseStatement('use std::{io, fs};');
      assert.strictEqual(result.tree.segment.name, 'std');
      assert.strictEqual(result.tree.children?.length, 2);
      assert.strictEqual(result.tree.children?.[0].segment.name, 'io');
      assert.strictEqual(result.tree.children?.[1].segment.name, 'fs');
    });

    test('parses deeply nested use statement', () => {
      const result = parseUseStatement(
        'use std::{io::{Read, Write}, fs::File};',
      );
      assert.strictEqual(result.tree.segment.name, 'std');
      assert.strictEqual(result.tree.children?.length, 2);

      const ioChild = result.tree.children?.[0];
      assert.strictEqual(ioChild?.segment.name, 'io');
      assert.strictEqual(ioChild?.children?.length, 2);
      assert.strictEqual(ioChild?.children?.[0].segment.name, 'Read');
      assert.strictEqual(ioChild?.children?.[1].segment.name, 'Write');

      const fsChild = result.tree.children?.[1];
      assert.strictEqual(fsChild?.segment.name, 'fs');
      assert.strictEqual(fsChild?.children?.length, 1);
      assert.strictEqual(fsChild?.children?.[0].segment.name, 'File');
    });

    test('parses use with alias', () => {
      const result = parseUseStatement('use std::result::Result as StdResult;');
      assert.strictEqual(result.tree.segment.name, 'std');
      const resultChild = result.tree.children?.[0].children?.[0];
      assert.strictEqual(resultChild?.segment.name, 'Result');
      assert.strictEqual(resultChild?.segment.alias, 'StdResult');
    });

    test('parses pub use', () => {
      const result = parseUseStatement('pub use crate::module::Type;');
      assert.strictEqual(result.visibility, 'pub');
      assert.strictEqual(result.tree.segment.name, 'crate');
    });

    test('parses pub(crate) use', () => {
      const result = parseUseStatement('pub(crate) use super::module;');
      assert.strictEqual(result.visibility, 'pub(crate)');
      assert.strictEqual(result.tree.segment.name, 'super');
    });

    test('parses glob import', () => {
      const result = parseUseStatement('use std::io::*;');
      assert.strictEqual(result.tree.segment.name, 'std');
      const globChild = result.tree.children?.[0].children?.[0];
      assert.strictEqual(globChild?.isGlob, true);
    });

    test('parses self in nested import', () => {
      const result = parseUseStatement('use std::io::{self, Read};');
      assert.strictEqual(result.tree.segment.name, 'std');
      const ioChild = result.tree.children?.[0];
      assert.strictEqual(ioChild?.segment.name, 'io');
      assert.strictEqual(ioChild?.children?.[0].segment.name, 'self');
      assert.strictEqual(ioChild?.children?.[1].segment.name, 'Read');
    });

    test('parses crate root import', () => {
      const result = parseUseStatement('use crate::utils::helper;');
      assert.strictEqual(result.tree.segment.name, 'crate');
      assert.strictEqual(result.tree.children?.[0].segment.name, 'utils');
    });

    test('parses super import', () => {
      const result = parseUseStatement('use super::parent_module;');
      assert.strictEqual(result.tree.segment.name, 'super');
      assert.strictEqual(
        result.tree.children?.[0].segment.name,
        'parent_module',
      );
    });
  });

  suite('parseRustFile', () => {
    test('parses file with single import', () => {
      const content = `use std::io;

fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      assert.strictEqual(result.imports[0].tree.segment.name, 'std');
    });

    test('parses file with multiple imports', () => {
      const content = `use std::io;
use std::fs;
use serde::Deserialize;

fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 3);
      assert.strictEqual(result.imports[0].tree.segment.name, 'std');
      assert.strictEqual(result.imports[1].tree.segment.name, 'std');
      assert.strictEqual(result.imports[2].tree.segment.name, 'serde');
    });

    test('parses file with attributes on imports', () => {
      const content = `use std::io;
#[cfg(test)]
use crate::test_utils;

fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 2);
      assert.strictEqual(result.imports[1].attributes?.length, 1);
      assert.strictEqual(result.imports[1].attributes?.[0], '#[cfg(test)]');
    });

    test('parses file with multi-line import', () => {
      const content = `use std::{
    io::{Read, Write},
    fs::File,
};

fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      assert.strictEqual(result.imports[0].tree.segment.name, 'std');
      assert.strictEqual(result.imports[0].tree.children?.length, 2);
    });

    test('tracks import range correctly', () => {
      const content = `// Comment
#![allow(dead_code)]

use std::io;

fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      assert.ok(result.importsRange !== null);
      assert.strictEqual(result.importsRange?.start.line, 3);
      assert.strictEqual(result.importsRange?.end.line, 3);
    });

    test('tracks multi-import range correctly', () => {
      const content = `use std::io;
use std::fs;

fn main() {
    println!("Hello");
}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 2);
      assert.ok(result.importsRange !== null);
      assert.strictEqual(result.importsRange?.start.line, 0);
      assert.strictEqual(result.importsRange?.end.line, 1);
    });

    test('handles file with no imports', () => {
      const content = `fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 0);
    });

    test('handles use statement with code after semicolon on same line', () => {
      const content = `use std::io;const X: usize = 4;

fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      assert.strictEqual(result.imports[0].tree.segment.name, 'std');
      // range.end.column should be set to the position after the semicolon
      assert.strictEqual(result.imports[0].range.end.column, 12);
      assert.strictEqual(result.importsRange?.end.column, 12);
    });

    test('handles use statement with code before on same line', () => {
      const content = `fn foo() {} use std::io;

fn main() {}`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      assert.strictEqual(result.imports[0].tree.segment.name, 'std');
      // range.start.column should be set to the position of 'use'
      assert.strictEqual(result.imports[0].range.start.column, 12);
      assert.strictEqual(result.importsRange?.start.column, 12);
    });

    test('handles use statement with code before and after on same line', () => {
      const content = `fn foo() {} use std::io; const X: usize = 4;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      assert.strictEqual(result.imports[0].tree.segment.name, 'std');
      assert.strictEqual(result.imports[0].range.start.column, 12);
      assert.strictEqual(result.imports[0].range.end.column, 24);
    });

    test('handles multiple use statements where last has code after', () => {
      const content = `use std::fs;
use std::io;const X: usize = 4;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 2);
      // First import ends at end of line (column = line length)
      assert.strictEqual(result.imports[0].range.end.column, 12);
      assert.strictEqual(result.imports[1].range.end.column, 12);
      assert.strictEqual(result.importsRange?.end.column, 12);
    });

    test('detects when there is no blank line after imports', () => {
      const content = `use std::io;
const X: usize = 4;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      // The next line is code, not blank
      assert.strictEqual(result.hasBlankLineAfterImports, false);
    });

    test('detects when there is a blank line after imports', () => {
      const content = `use std::io;

const X: usize = 4;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      assert.strictEqual(result.hasBlankLineAfterImports, true);
    });

    test('hasBlankLineAfterImports is true when imports at end of file', () => {
      const content = `use std::io;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 1);
      // No code after imports, so blank line not needed
      assert.strictEqual(result.hasBlankLineAfterImports, true);
    });

    test('assigns different block IDs when comment separates imports', () => {
      const content = `use std::io;
// External imports
use serde::Deserialize;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 2);
      // Imports separated by comment should have different block IDs
      assert.notStrictEqual(
        result.imports[0].blockId,
        result.imports[1].blockId,
        'imports separated by comment should be in different blocks',
      );
    });

    test('assigns same block ID for consecutive imports', () => {
      const content = `use std::io;
use std::fs;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 2);
      // Consecutive imports should have same block ID
      assert.strictEqual(
        result.imports[0].blockId,
        result.imports[1].blockId,
        'consecutive imports should be in same block',
      );
    });

    test('ignores blank lines for block separation', () => {
      const content = `use std::io;

use std::fs;`;
      const result = parseRustFile(content);
      assert.strictEqual(result.imports.length, 2);
      // Blank lines should not separate blocks (only comments do)
      assert.strictEqual(
        result.imports[0].blockId,
        result.imports[1].blockId,
        'blank lines should not create new blocks',
      );
    });
  });

  suite('getRootPath', () => {
    test('returns root segment name', () => {
      const result = parseUseStatement('use std::io::Read;');
      assert.strictEqual(getRootPath(result.tree), 'std');
    });

    test('returns crate for internal imports', () => {
      const result = parseUseStatement('use crate::module::Type;');
      assert.strictEqual(getRootPath(result.tree), 'crate');
    });
  });

  suite('flattenUseTree', () => {
    test('flattens simple import', () => {
      const result = parseUseStatement('use std::io;');
      const paths = flattenUseTree(result.tree);
      assert.strictEqual(paths.length, 1);
      assert.deepStrictEqual(paths[0], ['std', 'io']);
    });

    test('flattens nested import', () => {
      const result = parseUseStatement('use std::{io, fs};');
      const paths = flattenUseTree(result.tree);
      assert.strictEqual(paths.length, 2);
      assert.deepStrictEqual(paths[0], ['std', 'io']);
      assert.deepStrictEqual(paths[1], ['std', 'fs']);
    });

    test('flattens deeply nested import', () => {
      const result = parseUseStatement('use std::{io::{Read, Write}, fs};');
      const paths = flattenUseTree(result.tree);
      assert.strictEqual(paths.length, 3);
      assert.deepStrictEqual(paths[0], ['std', 'io', 'Read']);
      assert.deepStrictEqual(paths[1], ['std', 'io', 'Write']);
      assert.deepStrictEqual(paths[2], ['std', 'fs']);
    });
  });
});
