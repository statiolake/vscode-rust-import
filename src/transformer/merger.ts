import {
  UseStatement,
  UseTree,
  UsePathSegment,
  FlatImport,
  Range,
} from '../parser/types';
import { getRootPath } from '../parser/useParser';

// Debug logging
let logFn: ((msg: string) => void) | null = null;

export function setMergerLogger(fn: (msg: string) => void): void {
  logFn = fn;
}

function log(msg: string): void {
  if (logFn) {
    logFn(`[merger] ${msg}`);
  }
}

function flatImportToString(imp: FlatImport): string {
  let s = imp.path.join('::');
  if (imp.alias) {
    s += ` as ${imp.alias}`;
  }
  if (imp.isGlob) {
    s += ' (glob)';
  }
  return s;
}

/**
 * Expand a UseTree into flat imports (canonical form).
 * e.g., `std::{io::{self, Read, Write}, fs}` becomes:
 *   - ["std", "io", "self"]        (explicit self keyword)
 *   - ["std", "io", "Read", ""]    (terminal marker)
 *   - ["std", "io", "Write", ""]   (terminal marker)
 *   - ["std", "fs", ""]            (terminal marker)
 *
 * Note: Explicit `self` is kept as "self", while terminal nodes use "" as marker.
 * This allows distinguishing between:
 * - An explicit `self` keyword that can be reported as unused
 * - A terminal import marker that shouldn't match "self" unused reports
 *
 * Each FlatImport includes spans - the source ranges for each segment.
 * For `use std::env::{self, args}`:
 * - "std::env" (self) has spans for [std, env, self]
 * - "std::env::args" has spans for [std, env, args]
 */
export function expandToFlatImports(
  tree: UseTree,
  prefix: string[] = [],
  prefixSpans: Range[] = [],
): FlatImport[] {
  // Collect span for current segment if available
  const currentSpan = tree.segment.range;

  // Handle explicit `self` keyword - keep as "self" in path
  // e.g., in `std::io::{self}`, self means "import std::io itself"
  if (tree.segment.name === 'self') {
    const spans = currentSpan
      ? [...prefixSpans, currentSpan]
      : [...prefixSpans];
    return [{ path: [...prefix, 'self'], alias: tree.segment.alias, spans }];
  }

  // Glob import - add "*" to the path
  if (tree.isGlob) {
    const spans = currentSpan
      ? [...prefixSpans, currentSpan]
      : [...prefixSpans];
    return [{ path: [...prefix, '*'], isGlob: true, spans }];
  }

  const currentPath = [...prefix, tree.segment.name];
  const currentSpans = currentSpan
    ? [...prefixSpans, currentSpan]
    : [...prefixSpans];
  const currentAlias = tree.segment.alias;

  // Terminal node (no children) - add "" as terminal marker
  if (!tree.children || tree.children.length === 0) {
    return [
      { path: [...currentPath, ''], alias: currentAlias, spans: currentSpans },
    ];
  }

  // Has children - recurse
  const result: FlatImport[] = [];
  for (const child of tree.children) {
    result.push(...expandToFlatImports(child, currentPath, currentSpans));
  }
  return result;
}

/**
 * Get a unique key for a flat import (for deduplication).
 */
function getFlatImportKey(imp: FlatImport): string {
  let key = imp.path.join('::');
  if (imp.isGlob) {
    key += '::*';
  }
  return key;
}

/**
 * Merge alias with priority: explicit alias > no alias > underscore alias ("_").
 */
function mergeAlias(
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined {
  // If incoming has no alias
  if (!incoming) {
    // Remove underscore alias if existing has it
    if (existing === '_') {
      return undefined;
    }
    return existing;
  }

  // If incoming is underscore, never override existing
  if (incoming === '_') {
    return existing;
  }

  // Incoming is explicit alias - prefer it over underscore
  if (existing === '_') {
    return incoming;
  }

  // Both explicit or existing undefined - prefer incoming
  return incoming;
}

/**
 * Merge flat imports by deduplicating paths.
 * Handles alias priority: explicit > none > underscore.
 */
export function mergeFlatImports(imports: FlatImport[]): FlatImport[] {
  log(`mergeFlatImports called with ${imports.length} imports:`);
  for (const imp of imports) {
    log(`  input: ${flatImportToString(imp)}`);
  }

  const byKey = new Map<string, FlatImport>();

  for (const imp of imports) {
    const key = getFlatImportKey(imp);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...imp });
      log(`  new key "${key}": ${flatImportToString(imp)}`);
    } else {
      const oldAlias = existing.alias;
      existing.alias = mergeAlias(existing.alias, imp.alias);
      log(
        `  merge key "${key}": alias ${oldAlias} + ${imp.alias} = ${existing.alias}`,
      );
      // Merge isGlob
      if (imp.isGlob) {
        existing.isGlob = true;
      }
    }
  }

  const result = Array.from(byKey.values());
  log(`mergeFlatImports result (${result.length} imports):`);
  for (const imp of result) {
    log(`  output: ${flatImportToString(imp)}`);
  }

  return result;
}

/**
 * Build a UseTree from flat imports.
 * Groups imports by common prefixes to create nested structure.
 *
 * Flat imports use markers:
 * - ["std", "env", "self"] - explicit self keyword (use std::env::{self})
 * - ["std", "env", "args", ""] - terminal marker (use std::env::args)
 *
 * When building the tree:
 * - A "" child alone means this is a terminal import (output as simple path)
 * - A "self" child represents explicit self keyword
 * - A "" child with other children means the parent is also imported
 */
export function buildUseTree(imports: FlatImport[]): UseTree | null {
  if (imports.length === 0) {
    return null;
  }

  // All imports should share the same root
  const root = imports[0].path[0];

  // Build tree using a simple trie-like structure
  interface TreeNode {
    name: string;
    alias?: string;
    children: Map<string, TreeNode>;
    isGlob: boolean;
  }

  const rootNode: TreeNode = {
    name: root,
    children: new Map(),
    isGlob: false,
  };

  for (const imp of imports) {
    let current = rootNode;

    // Walk the path (skip root which is already in rootNode)
    for (let i = 1; i < imp.path.length; i++) {
      const segment = imp.path[i];
      let child = current.children.get(segment);

      if (!child) {
        child = {
          name: segment,
          children: new Map(),
          isGlob: false,
        };
        current.children.set(segment, child);
      }

      // Last segment gets the alias
      if (i === imp.path.length - 1) {
        if (imp.alias) {
          child.alias = imp.alias;
        }
        if (imp.isGlob) {
          child.isGlob = true;
        }
      }

      current = child;
    }

    // Handle root-level import (e.g., `use std;` -> ["std", "self"])
    if (imp.path.length === 1) {
      if (imp.alias) {
        rootNode.alias = imp.alias;
      }
      if (imp.isGlob) {
        rootNode.isGlob = true;
      }
    }
  }

  // Convert TreeNode to UseTree
  function nodeToUseTree(node: TreeNode): UseTree {
    const segment: UsePathSegment = { name: node.name };
    if (node.alias) {
      segment.alias = node.alias;
    }

    const tree: UseTree = { segment };

    if (node.isGlob) {
      tree.isGlob = true;
      return tree;
    }

    // Check for terminal marker (empty string child) and self child
    const terminalChild = node.children.get('');
    const selfChild = node.children.get('self');
    const otherChildren: TreeNode[] = [];
    let hasGlob = false;

    for (const [name, child] of node.children) {
      if (name === '' || name === 'self') {
        continue; // Handle terminal and self separately
      }
      if (child.isGlob) {
        hasGlob = true;
      } else {
        otherChildren.push(child);
      }
    }

    // If only terminal child exists (no self, no other children, no glob), it's a terminal import
    if (terminalChild && !selfChild && otherChildren.length === 0 && !hasGlob) {
      // Transfer alias from terminalChild to segment if present
      if (terminalChild.alias) {
        segment.alias = terminalChild.alias;
      }
      return tree;
    }

    // If only self child exists (no terminal, no other children, no glob), it's also a terminal import
    // (self as only child means "import this path itself", which is a simple path)
    if (selfChild && !terminalChild && otherChildren.length === 0 && !hasGlob) {
      // Transfer alias from selfChild if present
      if (selfChild.alias) {
        segment.alias = selfChild.alias;
      }
      return tree;
    }

    // If no children at all, return as-is (shouldn't happen with new format)
    if (node.children.size === 0) {
      return tree;
    }

    const children: UseTree[] = [];

    // If self child exists or terminal child with other content, add {self, ...}
    if (selfChild || (terminalChild && (otherChildren.length > 0 || hasGlob))) {
      const selfSegment: UsePathSegment = { name: 'self' };
      if (selfChild?.alias) {
        selfSegment.alias = selfChild.alias;
      }
      children.push({ segment: selfSegment });
    }

    // Sort other children alphabetically
    otherChildren.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of otherChildren) {
      children.push(nodeToUseTree(child));
    }

    // Add glob last if present
    if (hasGlob) {
      children.push({ segment: { name: '*' }, isGlob: true });
    }

    if (children.length > 0) {
      tree.children = children;
    }

    return tree;
  }

  return nodeToUseTree(rootNode);
}

/**
 * Merge multiple use statements with the same root into one.
 */
export function mergeUseStatements(statements: UseStatement[]): UseStatement[] {
  if (statements.length === 0) {
    return [];
  }

  // Group by root path
  const groups = new Map<string, UseStatement[]>();

  for (const stmt of statements) {
    const root = getRootPath(stmt.tree);
    const existing = groups.get(root) || [];
    existing.push(stmt);
    groups.set(root, existing);
  }

  // Merge each group
  const result: UseStatement[] = [];

  for (const [, groupStmts] of groups) {
    const firstStmt = groupStmts[0];

    // Expand all statements to flat imports
    const flatImports: FlatImport[] = [];
    for (const stmt of groupStmts) {
      flatImports.push(...expandToFlatImports(stmt.tree));
    }

    // Merge (deduplicate) flat imports
    const mergedFlat = mergeFlatImports(flatImports);

    // Build tree from flat imports
    const mergedTree = buildUseTree(mergedFlat);

    if (!mergedTree) {
      continue;
    }

    // Compute range
    const minStartLine = Math.min(...groupStmts.map((s) => s.range.start.line));
    const maxEndLine = Math.max(...groupStmts.map((s) => s.range.end.line));
    const firstOnMinLine = groupStmts.find(
      (s) => s.range.start.line === minStartLine,
    );
    const lastOnMaxLine = groupStmts.find(
      (s) => s.range.end.line === maxEndLine,
    );

    // These should always be found since groupStmts is non-empty
    if (!firstOnMinLine || !lastOnMaxLine) {
      continue;
    }

    // Preserve attributes only for single statements
    const attributes =
      groupStmts.length === 1 ? firstStmt.attributes : undefined;

    result.push({
      visibility: firstStmt.visibility,
      attributes,
      tree: mergedTree,
      range: {
        start: {
          line: minStartLine,
          column: firstOnMinLine.range.start.column,
        },
        end: { line: maxEndLine, column: lastOnMaxLine.range.end.column },
      },
    });
  }

  return result;
}

/**
 * Merge statements within each group (by visibility).
 */
export function mergeGroupedStatements(
  statements: UseStatement[],
): UseStatement[] {
  const byVisibility = new Map<string, UseStatement[]>();

  for (const stmt of statements) {
    const vis = stmt.visibility || '';
    const existing = byVisibility.get(vis) || [];
    existing.push(stmt);
    byVisibility.set(vis, existing);
  }

  const result: UseStatement[] = [];

  for (const [, visStmts] of byVisibility) {
    result.push(...mergeUseStatements(visStmts));
  }

  return result;
}

/**
 * Check if a use tree needs braces.
 * Braces are needed when:
 * - There are multiple children
 * - The single child is `self` or `*`
 */
export function needsBraces(tree: UseTree): boolean {
  if (!tree.children) {
    return false;
  }
  if (tree.children.length === 1) {
    const child = tree.children[0];
    return child.segment.name === 'self' || child.isGlob === true;
  }
  return tree.children.length > 1;
}

/**
 * Count total imports in a use tree.
 */
export function countImports(tree: UseTree): number {
  if (tree.isGlob) {
    return 1;
  }

  if (!tree.children || tree.children.length === 0) {
    return 1;
  }

  let count = 0;
  for (const child of tree.children) {
    count += countImports(child);
  }
  return count;
}
