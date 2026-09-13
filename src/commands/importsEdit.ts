import { ParseResult, Position, Range } from '../parser/types';

/**
 * A text replacement that places organized imports into a document
 */
export interface ImportsEdit {
  range: Range;
  text: string;
}

/**
 * Compute the edit that replaces the existing imports (or inserts new ones)
 * with `formattedImports`, including the surrounding blank lines.
 *
 * Spacing rule: the whitespace following the imports is always replaced, so
 * the imports are followed by exactly one blank line when code follows, and
 * by a single newline at end of file.
 *
 * Returns null when the document already has the expected text.
 */
export function computeImportsEdit(
  content: string,
  parseResult: ParseResult,
  formattedImports: string,
): ImportsEdit | null {
  const lines = content.split('\n');

  let start: Position;
  let importsEnd: Position;

  if (parseResult.importsRange) {
    // There are existing imports - replace them
    start = parseResult.importsRange.start;
    importsEnd = parseResult.importsRange.end;
  } else if (formattedImports) {
    // No existing imports but we have new ones - insert them
    start = { line: findImportInsertionLine(lines), column: 0 };
    importsEnd = start;
  } else {
    // No imports at all
    return null;
  }

  const end = skipWhitespace(lines, importsEnd);
  const hasCodeBefore = start.column > 0;
  const hasCodeAfter = end.line < lines.length;

  const imports = formattedImports.trimEnd();
  let text = imports;
  if (imports && hasCodeBefore) {
    text = `\n\n${text}`;
  }
  if (imports || hasCodeBefore) {
    text += hasCodeAfter ? '\n\n' : '\n';
  }

  const range: Range = {
    start,
    end: hasCodeAfter ? end : endOfDocument(lines),
  };

  if (textInRange(lines, range) === text) {
    return null;
  }

  return { range, text };
}

/**
 * Return the position of the first non-whitespace character at or after `pos`.
 * Returns a position with `line === lines.length` when only whitespace remains.
 */
function skipWhitespace(lines: string[], pos: Position): Position {
  let column = pos.column;
  for (let line = pos.line; line < lines.length; line++) {
    const offset = lines[line].slice(column).search(/\S/);
    if (offset !== -1) {
      return { line, column: column + offset };
    }
    column = 0;
  }
  return { line: lines.length, column: 0 };
}

function endOfDocument(lines: string[]): Position {
  const line = lines.length - 1;
  return { line, column: lines[line].length };
}

function textInRange(lines: string[], range: Range): string {
  if (range.start.line === range.end.line) {
    return lines[range.start.line].slice(range.start.column, range.end.column);
  }
  return [
    lines[range.start.line].slice(range.start.column),
    ...lines.slice(range.start.line + 1, range.end.line),
    lines[range.end.line].slice(0, range.end.column),
  ].join('\n');
}

/**
 * Find the line to insert imports when there are no existing imports
 */
function findImportInsertionLine(lines: string[]): number {
  let insertLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.startsWith('#![') || // inner attribute
      line.startsWith('//!') || // module doc comment
      line.startsWith('extern crate') // extern crate
    ) {
      insertLine = i + 1;
    } else if (line === '' || line.startsWith('//')) {
      // Skip empty lines and regular comments at the top
      if (insertLine === i) {
        insertLine = i + 1;
      }
    } else if (line.startsWith('mod ')) {
      // Found mod, insert before it
      insertLine = i;
      break;
    } else if (line.length > 0 && !line.startsWith('#[')) {
      // Found other code
      break;
    }
  }

  return insertLine;
}
