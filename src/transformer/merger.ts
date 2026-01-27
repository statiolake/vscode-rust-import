import {
  UseStatement,
  UseTree,
  UsePathSegment,
  FlatImport,
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
 *   - ["std", "io"]        (from self)
 *   - ["std", "io", "Read"]
 *   - ["std", "io", "Write"]
 *   - ["std", "fs"]
 *
 * Note: `self` is converted to the parent path (canonical form).
 * `use std::env::{self}` and `use std::env;` both become `["std", "env"]`.
 */
export function expandToFlatImports(
  tree: UseTree,
  prefix: string[] = [],
): FlatImport[] {
  // Handle `self` keyword - it refers to the parent path
  // e.g., in `std::io::{self}`, self means "import std::io itself"
  if (tree.segment.name === 'self') {
    return [{ path: prefix, alias: tree.segment.alias }];
  }

  // Glob import
  if (tree.isGlob) {
    return [{ path: prefix, isGlob: true }];
  }

  const currentPath = [...prefix, tree.segment.name];
  const currentAlias = tree.segment.alias;

  // Terminal node (no children)
  if (!tree.children || tree.children.length === 0) {
    return [{ path: currentPath, alias: currentAlias }];
  }

  // Has children - recurse
  const result: FlatImport[] = [];
  for (const child of tree.children) {
    result.push(...expandToFlatImports(child, currentPath));
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
 * The tree structure is determined purely by the imports:
 * - A node is terminal if it has no children
 * - A node needs {self, ...} if it's imported AND has children
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
    isImported: boolean; // This path itself is imported (not just a prefix)
    isGlob: boolean;
  }

  const rootNode: TreeNode = {
    name: root,
    children: new Map(),
    isImported: false,
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
          isImported: false,
          isGlob: false,
        };
        current.children.set(segment, child);
      }

      // Last segment gets the alias and marks as imported
      if (i === imp.path.length - 1) {
        child.isImported = true;
        if (imp.alias) {
          child.alias = imp.alias;
        }
        if (imp.isGlob) {
          // Glob is a child of this node
          const globChild: TreeNode = {
            name: '*',
            children: new Map(),
            isImported: false,
            isGlob: true,
          };
          child.children.set('*', globChild);
        }
      }

      current = child;
    }

    // Handle root-level import (e.g., `use std;`)
    if (imp.path.length === 1) {
      rootNode.isImported = true;
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

    // If no children, it's a terminal node
    if (node.children.size === 0) {
      return tree;
    }

    const children: UseTree[] = [];

    // If this node is imported AND has children, we need {self, ...}
    if (node.isImported) {
      const selfSegment: UsePathSegment = { name: 'self' };
      if (node.alias) {
        selfSegment.alias = node.alias;
        // Clear alias from parent since it's now on self
        segment.alias = undefined;
      }
      children.push({ segment: selfSegment });
    }

    // Add regular children (sorted for consistent output)
    // Glob (*) should come last, so separate it
    const regularChildren: TreeNode[] = [];
    let hasGlob = false;

    for (const child of node.children.values()) {
      if (child.isGlob) {
        hasGlob = true;
      } else {
        regularChildren.push(child);
      }
    }

    // Sort regular children alphabetically
    regularChildren.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of regularChildren) {
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
    )!;
    const lastOnMaxLine = groupStmts.find(
      (s) => s.range.end.line === maxEndLine,
    )!;

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
