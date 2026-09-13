import * as assert from 'assert';
import { computeImportsEdit, ImportsEdit } from '../../commands/importsEdit';
import { parseRustFile } from '../../parser/useParser';

/**
 * Apply an edit (line/column based) to the document text
 */
function applyEdit(content: string, edit: ImportsEdit): string {
  const lines = content.split('\n');
  const offsetOf = (line: number, column: number) =>
    lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + column;
  const start = offsetOf(edit.range.start.line, edit.range.start.column);
  const end = offsetOf(edit.range.end.line, edit.range.end.column);
  return content.slice(0, start) + edit.text + content.slice(end);
}

/**
 * Run the edit computation on `content` with the given formatted imports
 * and return the resulting document text
 */
function organize(content: string, formattedImports: string): string {
  const edit = computeImportsEdit(
    content,
    parseRustFile(content),
    formattedImports,
  );
  return edit ? applyEdit(content, edit) : content;
}

suite('computeImportsEdit Test Suite', () => {
  suite('existing imports', () => {
    test('keeps a single blank line before following code', () => {
      const content = 'use std::io;\nuse std::fs;\n\nfn main() {}\n';
      assert.strictEqual(
        organize(content, 'use std::fs;\nuse std::io;\n'),
        'use std::fs;\nuse std::io;\n\nfn main() {}\n',
      );
    });

    test('inserts a single blank line when code follows directly', () => {
      const content = 'use std::io;\nfn main() {}\n';
      assert.strictEqual(
        organize(content, 'use std::io;\n'),
        'use std::io;\n\nfn main() {}\n',
      );
    });

    test('does not add blank lines when imports are at end of file', () => {
      const content = 'use std::io;\n';
      assert.strictEqual(organize(content, 'use std::io;\n'), 'use std::io;\n');
    });

    test('collapses multiple blank lines after imports into one', () => {
      const content = 'use std::io;\n\n\n\nfn main() {}\n';
      assert.strictEqual(
        organize(content, 'use std::io;\n'),
        'use std::io;\n\nfn main() {}\n',
      );
    });

    test('removes trailing blank lines when imports are at end of file', () => {
      const content = 'use std::io;\n\n\n';
      assert.strictEqual(organize(content, 'use std::io;\n'), 'use std::io;\n');
    });

    test('removes following blank lines when all imports are removed', () => {
      const content = 'use std::io;\n\nfn main() {}\n';
      assert.strictEqual(organize(content, ''), 'fn main() {}\n');
    });

    test('separates code on the same line after imports', () => {
      const content = 'use std::io; fn main() {}\n';
      assert.strictEqual(
        organize(content, 'use std::io;\n'),
        'use std::io;\n\nfn main() {}\n',
      );
    });
  });

  suite('inserting imports into a file without imports', () => {
    test('inserts a single blank line before following code', () => {
      const content = 'fn main() {}\n';
      assert.strictEqual(
        organize(content, 'use std::io;\n'),
        'use std::io;\n\nfn main() {}\n',
      );
    });

    test('inserts a single blank line before mod declarations', () => {
      const content = 'mod foo;\n\nfn main() {}\n';
      assert.strictEqual(
        organize(content, 'use std::io;\n'),
        'use std::io;\n\nmod foo;\n\nfn main() {}\n',
      );
    });

    test('inserts after module doc comments with a single blank line', () => {
      const content = '//! doc\n\nfn main() {}\n';
      assert.strictEqual(
        organize(content, 'use std::io;\n'),
        '//! doc\n\nuse std::io;\n\nfn main() {}\n',
      );
    });
  });

  suite('idempotency', () => {
    const cases: [string, string, string][] = [
      ['existing imports', 'use std::io;\nfn main() {}\n', 'use std::io;\n'],
      ['inserted imports', 'fn main() {}\n', 'use std::io;\n'],
      ['inserted after doc', '//! doc\n\nfn main() {}\n', 'use std::io;\n'],
    ];

    for (const [name, content, formattedImports] of cases) {
      test(`produces no edit on second run (${name})`, () => {
        const once = organize(content, formattedImports);
        assert.strictEqual(
          computeImportsEdit(once, parseRustFile(once), formattedImports),
          null,
        );
      });
    }
  });
});
