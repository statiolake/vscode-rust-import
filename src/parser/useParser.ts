import { UseStatement, UseTree, UsePathSegment, ParseResult } from './types';

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
}

/**
 * Tokenize a use statement string
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip whitespace
    if (/\s/.test(input[pos])) {
      pos++;
      continue;
    }

    // Double colon
    if (input.slice(pos, pos + 2) === '::') {
      tokens.push({ type: TokenType.DoubleColon, value: '::' });
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
      tokens.push({ type: singleCharTokens[input[pos]], value: input[pos] });
      pos++;
      continue;
    }

    // Keywords and identifiers
    if (/[a-zA-Z_]/.test(input[pos])) {
      let ident = '';
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
        ident += input[pos];
        pos++;
      }

      const keywordMap: Record<string, TokenType> = {
        'use': TokenType.Use,
        'pub': TokenType.Pub,
        'as': TokenType.As,
        'self': TokenType.Self,
        'crate': TokenType.Crate,
        'super': TokenType.Super,
        'in': TokenType.In,
      };

      if (keywordMap[ident]) {
        tokens.push({ type: keywordMap[ident], value: ident });
      } else {
        tokens.push({ type: TokenType.Identifier, value: ident });
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

  constructor(tokens: Token[]) {
    this.tokens = tokens;
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

    const segment: UsePathSegment = { name: token.value };

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
        segment: { name: '*' },
        isGlob: true,
      };
    }

    // Handle self
    if (token.type === TokenType.Self) {
      this.advance();
      const segment: UsePathSegment = { name: 'self' };
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
        isSelf: true,
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
        this.advance();
        tree.children = [{
          segment: { name: '*' },
          isGlob: true,
        }];
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
 */
export function parseUseStatement(
  useStr: string,
  attributes: string[] = [],
  startLine: number = 0,
  startCol?: number,
  endLine: number = 0,
  endCol?: number
): UseStatement {
  const tokens = tokenize(useStr);
  const parser = new UseTreeParser(tokens);
  const { visibility, tree } = parser.parse();

  return {
    visibility,
    tree,
    attributes,
    startLine,
    startCol,
    endLine,
    endCol,
  };
}

/**
 * Find the end of a use statement in a line, tracking brace count
 * Returns the column after the semicolon, or -1 if not found
 */
function findUseEndInLine(line: string, startCol: number, braceCount: number): { endCol: number; braceCount: number } {
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
  let firstImportLine = -1;
  let firstImportStartCol: number | undefined;
  let lastImportLine = -1;
  let lastImportEndCol: number | undefined;
  let inUseStatement = false;
  let currentUseLines: string[] = [];
  let currentUseStartLine = 0;
  let currentUseStartCol = 0;
  let braceCount = 0;

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

    // Skip empty lines and comments when not in a use statement
    if (!inUseStatement) {
      if (trimmedLine === '' || trimmedLine.startsWith('//')) {
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
          currentUseLines = [useStr];
          const attributes = extractAttributes(lines, i);
          const startLine = currentUseStartLine;
          const startCol = currentUseStartCol > 0 ? currentUseStartCol : undefined;

          try {
            const endCol = result.endCol < line.length ? result.endCol : undefined;
            const useStmt = parseUseStatement(useStr, attributes, startLine, startCol, i, endCol);
            imports.push(useStmt);

            if (firstImportLine === -1) {
              firstImportLine = startLine;
              firstImportStartCol = startCol;
            }
            lastImportLine = i;
            lastImportEndCol = endCol;
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
      const startCol = currentUseStartCol > 0 ? currentUseStartCol : undefined;

      try {
        const endCol = result.endCol < line.length ? result.endCol : undefined;
        const useStmt = parseUseStatement(fullUseStr, attributes, currentUseStartLine, startCol, i, endCol);
        imports.push(useStmt);

        if (firstImportLine === -1) {
          firstImportLine = currentUseStartLine;
          firstImportStartCol = startCol;
        }
        lastImportLine = i;
        lastImportEndCol = endCol;
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

  // Build result
  const beforeImports = firstImportLine >= 0
    ? lines.slice(0, firstImportLine).join('\n')
    : content;

  const afterImports = lastImportLine >= 0
    ? lines.slice(lastImportLine + 1).join('\n')
    : '';

  // Check if there's a blank line after imports
  // True if: no code after imports, or next line after imports is blank
  let hasBlankLineAfterImports = true;
  if (lastImportLine >= 0 && lastImportLine + 1 < lines.length) {
    // If there's code after the semicolon on the same line, no blank line needed (handled separately)
    if (lastImportEndCol === undefined) {
      // Check the line after imports
      const nextLine = lines[lastImportLine + 1].trim();
      hasBlankLineAfterImports = nextLine === '';
    }
  }

  return {
    imports,
    beforeImports: beforeImports.length > 0 ? beforeImports + '\n' : '',
    afterImports: afterImports.length > 0 ? '\n' + afterImports : '',
    importStartLine: firstImportLine,
    importStartCol: firstImportStartCol,
    importEndLine: lastImportLine,
    lastImportEndCol,
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
export function flattenUseTree(tree: UseTree, prefix: string[] = []): string[][] {
  const currentPath = [...prefix, tree.segment.name];

  if (tree.isGlob) {
    return [currentPath];
  }

  if (tree.isSelf) {
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
