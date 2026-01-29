import {
  UseStatement,
  UseTree,
  UsePathSegment,
  ParseResult,
  Range,
} from './types';

/**
 * Token types for the lexer
 */
enum TokenType {
  Use = 'USE',
  Pub = 'PUB',
  As = 'AS',
  Self = 'SELF',
  Crate = 'CRATE',
  Super = 'SUPER',
  Identifier = 'IDENTIFIER',
  DoubleColon = 'DOUBLE_COLON',
  OpenBrace = 'OPEN_BRACE',
  CloseBrace = 'CLOSE_BRACE',
  Comma = 'COMMA',
  Semicolon = 'SEMICOLON',
  Star = 'STAR',
  OpenParen = 'OPEN_PAREN',
  CloseParen = 'CLOSE_PAREN',
  In = 'IN',
}

interface Token {
  type: TokenType;
  value: string;
  /** Line number (0-based, relative to the start of the use statement) */
  line: number;
  /** Start position in source (column only, line is always 0 for single-line parsing) */
  startCol: number;
  /** End position in source (exclusive) */
  endCol: number;
}

/**
 * Tokenize a use statement string
 * Tracks line numbers for multi-line use statements
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 0;
  let lineStartPos = 0;

  while (pos < input.length) {
    // Track newlines for line numbering
    if (input[pos] === '\n') {
      line++;
      lineStartPos = pos + 1;
      pos++;
      continue;
    }

    // Skip whitespace (except newline which we handled above)
    if (/\s/.test(input[pos])) {
      pos++;
      continue;
    }

    // Double colon
    if (input.slice(pos, pos + 2) === '::') {
      tokens.push({
        type: TokenType.DoubleColon,
        value: '::',
        line,
        startCol: pos - lineStartPos,
        endCol: pos - lineStartPos + 2,
      });
      pos += 2;
      continue;
    }

    // Single character tokens
    const singleCharTokens: Record<string, TokenType> = {
      '{': TokenType.OpenBrace,
      '}': TokenType.CloseBrace,
      ',': TokenType.Comma,
      ';': TokenType.Semicolon,
      '*': TokenType.Star,
      '(': TokenType.OpenParen,
      ')': TokenType.CloseParen,
    };

    if (singleCharTokens[input[pos]]) {
      tokens.push({
        type: singleCharTokens[input[pos]],
        value: input[pos],
        line,
        startCol: pos - lineStartPos,
        endCol: pos - lineStartPos + 1,
      });
      pos++;
      continue;
    }

    // Keywords and identifiers
    if (/[a-zA-Z_]/.test(input[pos])) {
      const startCol = pos - lineStartPos;
      let ident = '';
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
        ident += input[pos];
        pos++;
      }
      const endCol = pos - lineStartPos;

      const keywordMap: Record<string, TokenType> = {
        use: TokenType.Use,
        pub: TokenType.Pub,
        as: TokenType.As,
        self: TokenType.Self,
        crate: TokenType.Crate,
        super: TokenType.Super,
        in: TokenType.In,
      };

      if (keywordMap[ident]) {
        tokens.push({
          type: keywordMap[ident],
          value: ident,
          line,
          startCol,
          endCol,
        });
      } else {
        tokens.push({
          type: TokenType.Identifier,
          value: ident,
          line,
          startCol,
          endCol,
        });
      }
      continue;
    }

    // Unknown character, skip
    pos++;
  }

  return tokens;
}

/**
 * Parse tokens into a UseTree
 */
class UseTreeParser {
  private tokens: Token[];
  private pos: number = 0;
  /** Base line number in the source file */
  private baseLine: number;
  /** Base column offset (start of the use statement) */
  private baseCol: number;

  constructor(tokens: Token[], baseLine: number = 0, baseCol: number = 0) {
    this.tokens = tokens;
    this.baseLine = baseLine;
    this.baseCol = baseCol;
  }

  /** Convert token position to absolute range in source */
  private tokenToRange(token: Token): Range {
    return {
      start: {
        line: this.baseLine + token.line,
        column: this.baseCol + token.startCol,
      },
      end: {
        line: this.baseLine + token.line,
        column: this.baseCol + token.endCol,
      },
    };
  }

  private current(): Token | undefined {
    return this.tokens[this.pos];
  }

  private advance(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const token = this.advance();
    if (!token || token.type !== type) {
      throw new Error(`Expected ${type} but got ${token?.type ?? 'EOF'}`);
    }
    return token;
  }

  private match(type: TokenType): boolean {
    return this.current()?.type === type;
  }

  /**
   * Parse visibility modifier (pub, pub(crate), pub(super), etc.)
   */
  parseVisibility(): string | undefined {
    if (!this.match(TokenType.Pub)) {
      return undefined;
    }
    this.advance(); // consume 'pub'

    if (!this.match(TokenType.OpenParen)) {
      return 'pub';
    }

    // Parse pub(crate), pub(super), pub(self), pub(in path)
    this.advance(); // consume '('
    let visibility = 'pub(';

    if (this.match(TokenType.In)) {
      this.advance(); // consume 'in'
      visibility += 'in ';
      // Parse path
      while (!this.match(TokenType.CloseParen) && this.current()) {
        const token = this.advance()!;
        visibility += token.value;
      }
    } else {
      const token = this.advance();
      if (token) {
        visibility += token.value;
      }
    }

    this.expect(TokenType.CloseParen);
    visibility += ')';
    return visibility;
  }

  /**
   * Parse a single path segment with optional alias
   */
  parseSegment(): UsePathSegment {
    const token = this.advance();
    if (!token) {
      throw new Error('Unexpected end of input');
    }

    const segment: UsePathSegment = {
      name: token.value,
      range: this.tokenToRange(token),
    };

    // Check for alias
    if (this.match(TokenType.As)) {
      this.advance(); // consume 'as'
      const aliasToken = this.advance();
      if (aliasToken) {
        segment.alias = aliasToken.value;
      }
    }

    return segment;
  }

  /**
   * Parse a use tree (handles nested braces)
   */
  parseUseTree(): UseTree {
    const token = this.current();

    if (!token) {
      throw new Error('Unexpected end of input');
    }

    // Handle glob
    if (token.type === TokenType.Star) {
      this.advance();
      return {
        segment: { name: '*', range: this.tokenToRange(token) },
        isGlob: true,
      };
    }

    // Handle self
    if (token.type === TokenType.Self) {
      this.advance();
      const segment: UsePathSegment = {
        name: 'self',
        range: this.tokenToRange(token),
      };
      // Check for alias on self
      if (this.match(TokenType.As)) {
        this.advance();
        const aliasToken = this.advance();
        if (aliasToken) {
          segment.alias = aliasToken.value;
        }
      }
      return {
        segment,
      };
    }

    // Parse segment
    const segment = this.parseSegment();
    const tree: UseTree = { segment };

    // Check for children
    if (this.match(TokenType.DoubleColon)) {
      this.advance(); // consume '::'

      if (this.match(TokenType.OpenBrace)) {
        this.advance(); // consume '{'
        tree.children = this.parseUseTreeList();
        this.expect(TokenType.CloseBrace);
      } else if (this.match(TokenType.Star)) {
        const starToken = this.current()!;
        this.advance();
        tree.children = [
          {
            segment: { name: '*', range: this.tokenToRange(starToken) },
            isGlob: true,
          },
        ];
      } else {
        // Single child
        const child = this.parseUseTree();
        tree.children = [child];
      }
    }

    return tree;
  }

  /**
   * Parse a comma-separated list of use trees
   */
  parseUseTreeList(): UseTree[] {
    const trees: UseTree[] = [];

    while (!this.match(TokenType.CloseBrace) && this.current()) {
      trees.push(this.parseUseTree());

      if (this.match(TokenType.Comma)) {
        this.advance(); // consume ','
      } else {
        break;
      }
    }

    return trees;
  }

  /**
   * Parse a complete use statement
   */
  parse(): { visibility?: string; tree: UseTree } {
    const visibility = this.parseVisibility();

    if (this.match(TokenType.Use)) {
      this.advance(); // consume 'use'
    }

    const tree = this.parseUseTree();
    return { visibility, tree };
  }
}

/**
 * Extract attributes from lines preceding a use statement
 */
function extractAttributes(lines: string[], useLineIndex: number): string[] {
  const attributes: string[] = [];
  let i = useLineIndex - 1;

  while (i >= 0) {
    const line = lines[i].trim();
    if (line.startsWith('#[')) {
      attributes.unshift(line);
      i--;
    } else if (line === '' || line.startsWith('//')) {
      i--;
    } else {
      break;
    }
  }

  return attributes;
}

/**
 * Find the start line of a use statement (including attributes)
 */
function findStartLine(lines: string[], useLineIndex: number): number {
  let i = useLineIndex - 1;
  let lastAttrLine = useLineIndex;

  while (i >= 0) {
    const line = lines[i].trim();
    if (line.startsWith('#[')) {
      lastAttrLine = i;
      i--;
    } else if (line === '' || line.startsWith('//')) {
      i--;
    } else {
      break;
    }
  }

  return lastAttrLine;
}

/**
 * Parse a single use statement from its string representation
 * @param useStr The use statement string
 * @param attributes Attributes attached to the use statement
 * @param range Range of the use statement in the source file
 */
export function parseUseStatement(
  useStr: string,
  attributes: string[] = [],
  range: Range = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
): UseStatement {
  const tokens = tokenize(useStr);
  // Pass base position to parser for calculating segment ranges
  const parser = new UseTreeParser(
    tokens,
    range.start.line,
    range.start.column,
  );
  const { visibility, tree } = parser.parse();

  return {
    visibility,
    tree,
    attributes,
    range,
  };
}

/**
 * Find the end of a use statement in a line, tracking brace count
 * Returns the column after the semicolon, or -1 if not found
 */
function findUseEndInLine(
  line: string,
  startCol: number,
  braceCount: number,
): { endCol: number; braceCount: number } {
  let col = startCol;
  let count = braceCount;

  while (col < line.length) {
    const ch = line[col];
    if (ch === '{') {
      count++;
    } else if (ch === '}') {
      count--;
    } else if (ch === ';' && count === 0) {
      return { endCol: col + 1, braceCount: count };
    }
    col++;
  }

  return { endCol: -1, braceCount: count };
}

/**
 * Find the start column of a use statement in a line
 */
function findUseStartInLine(line: string): number {
  // Match pub/pub(...) use or just use
  const match = line.match(/(pub\s*(\([^)]*\))?\s*)?use\s+/);
  if (match) {
    return line.indexOf(match[0]);
  }
  return 0;
}

/**
 * Find all use statements in a Rust file
 */
export function parseRustFile(content: string): ParseResult {
  const lines = content.split('\n');
  const imports: UseStatement[] = [];

  let i = 0;
  let inUseStatement = false;
  let currentUseLines: string[] = [];
  let currentUseStartLine = 0;
  let currentUseStartCol = 0;
  let braceCount = 0;
  let currentBlockId = 0;
  let hasImportsInCurrentBlock = false;

  // Skip initial attributes and comments at file level (like #![...])
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('//') || line.startsWith('#![')) {
      i++;
      continue;
    }
    break;
  }

  // Find use statements
  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Handle empty lines and comments when not in a use statement
    if (!inUseStatement) {
      // Empty lines don't create new blocks
      if (trimmedLine === '') {
        i++;
        continue;
      }

      // Comments create new blocks (if we had imports before)
      if (trimmedLine.startsWith('//')) {
        if (hasImportsInCurrentBlock) {
          currentBlockId++;
          hasImportsInCurrentBlock = false;
        }
        i++;
        continue;
      }

      // Check for attribute (possibly for the next use statement)
      if (trimmedLine.startsWith('#[')) {
        i++;
        continue;
      }

      // Check if this line contains a use statement (can be anywhere in the line)
      const useMatch = line.match(/(pub\s*(\([^)]*\))?\s*)?use\s+/);
      if (useMatch) {
        inUseStatement = true;
        currentUseStartLine = findStartLine(lines, i);
        currentUseStartCol = findUseStartInLine(line);
        braceCount = 0;

        // Find use statement end in this line (start searching from beginning)
        const result = findUseEndInLine(line, currentUseStartCol, braceCount);
        braceCount = result.braceCount;

        if (result.endCol !== -1) {
          // Use statement ends in this line
          const useStr = line.substring(currentUseStartCol, result.endCol);
          const attributes = extractAttributes(lines, i);
          const range: Range = {
            start: { line: currentUseStartLine, column: currentUseStartCol },
            end: { line: i, column: result.endCol },
          };

          try {
            const useStmt = parseUseStatement(useStr, attributes, range);
            useStmt.blockId = currentBlockId;
            imports.push(useStmt);
            hasImportsInCurrentBlock = true;
          } catch (e) {
            // Skip malformed use statements
          }

          inUseStatement = false;
          currentUseLines = [];
        } else {
          // Use statement continues to next line
          currentUseLines = [line.substring(currentUseStartCol)];
        }

        i++;
        continue;
      }

      // Non-import line encountered - stop if we've already found imports
      if (imports.length > 0) {
        break;
      }
      i++;
      continue;
    }

    // Continue multi-line use statement
    const result = findUseEndInLine(line, 0, braceCount);
    braceCount = result.braceCount;

    if (result.endCol !== -1) {
      // Use statement ends in this line
      currentUseLines.push(line.substring(0, result.endCol));
      const fullUseStr = currentUseLines.join('\n');
      const attributes = extractAttributes(lines, currentUseStartLine);
      const range: Range = {
        start: { line: currentUseStartLine, column: currentUseStartCol },
        end: { line: i, column: result.endCol },
      };

      try {
        const useStmt = parseUseStatement(fullUseStr, attributes, range);
        useStmt.blockId = currentBlockId;
        imports.push(useStmt);
        hasImportsInCurrentBlock = true;
      } catch (e) {
        // Skip malformed use statements
      }

      inUseStatement = false;
      currentUseLines = [];
    } else {
      // Continue accumulating
      currentUseLines.push(line);
    }

    i++;
  }

  // Build importsRange from first and last import
  let importsRange: Range | null = null;
  if (imports.length > 0) {
    const first = imports[0];
    const last = imports[imports.length - 1];
    importsRange = {
      start: first.range.start,
      end: last.range.end,
    };
  }

  // Check if there's a blank line after imports
  let hasBlankLineAfterImports = true;
  if (imports.length > 0) {
    const lastImport = imports[imports.length - 1];
    const lastLine = lastImport.range.end.line;
    const lastCol = lastImport.range.end.column;

    // If the use statement doesn't end at end of line, there's code after it
    if (lastCol < lines[lastLine].length) {
      // There's code after the semicolon on the same line - no blank line needed
      hasBlankLineAfterImports = true;
    } else if (lastLine + 1 < lines.length) {
      // Check the line after imports
      const nextLine = lines[lastLine + 1].trim();
      hasBlankLineAfterImports = nextLine === '';
    }
  }

  return {
    imports,
    importsRange,
    hasBlankLineAfterImports,
  };
}

/**
 * Get the root path of a use tree (e.g., "std" from "use std::io")
 */
export function getRootPath(tree: UseTree): string {
  return tree.segment.name;
}

/**
 * Flatten a use tree into individual import paths
 */
export function flattenUseTree(
  tree: UseTree,
  prefix: string[] = [],
): string[][] {
  // Handle `self` - it refers to the parent path
  if (tree.segment.name === 'self') {
    return [prefix];
  }

  const currentPath = [...prefix, tree.segment.name];

  if (tree.isGlob) {
    return [currentPath];
  }

  if (!tree.children || tree.children.length === 0) {
    return [currentPath];
  }

  const paths: string[][] = [];
  for (const child of tree.children) {
    const childPaths = flattenUseTree(child, currentPath);
    paths.push(...childPaths);
  }
  return paths;
}
