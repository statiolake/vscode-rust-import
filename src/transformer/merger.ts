import {
  UseStatement,
  UseTree,
  UsePathSegment,
  FlatImport,
} from '../parser/types';
import { getRootPath } from '../parser/useParser';

/**
 * Expand a UseTree into flat imports.
 * e.g., `std::{io::{Read, Write}, fs}` becomes:
 *   - ["std", "io", "Read"]
 *   - ["std", "io", "Write"]
 *   - ["std", "fs"]
 */
export function expandToFlatImports(
  tree: UseTree,
  prefix: string[] = [],
): FlatImport[] {
  // Self import - refers to parent path
  // e.g., `std::io::{self}` means "import std::io itself"
  if (tree.isSelf) {
    return [{ path: prefix, isSelf: true }];
  }

  // Glob import - refers to parent path with glob
  // e.g., `std::io::*` means "import everything from std::io"
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
 * Note: `use X;` and `use X::{self};` are equivalent, so isSelf is not included in key.
 */
function getFlatImportKey(imp: FlatImport): string {
  let key = imp.path.join('::');
  if (imp.isGlob) key += '::*';
  // isSelf is NOT included - `X` and `X::{self}` should merge
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
  const byKey = new Map<string, FlatImport>();

  for (const imp of imports) {
    const key = getFlatImportKey(imp);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...imp });
    } else {
      // Merge alias with priority
      existing.alias = mergeAlias(existing.alias, imp.alias);
      // Merge isSelf: if either is self, result is self
      // (terminal `X` and `X::{self}` both mean "import X itself")
      if (imp.isSelf) {
        existing.isSelf = true;
      }
      // Merge isGlob
      if (imp.isGlob) {
        existing.isGlob = true;
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Build a UseTree from flat imports.
 * Groups imports by common prefixes to create nested structure.
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
    isTerminal: boolean;
    isSelf: boolean;
    isGlob: boolean;
  }

  const rootNode: TreeNode = {
    name: root,
    children: new Map(),
    isTerminal: false,
    isSelf: false,
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
          isTerminal: false,
          isSelf: false,
          isGlob: false,
        };
        current.children.set(segment, child);
      }

      // Last segment gets the alias and flags
      if (i === imp.path.length - 1) {
        if (imp.alias) {
          child.alias = imp.alias;
        }
        if (imp.isGlob) {
          // Glob is a child of this node, not a property of this node
          // Create a glob child node
          const globChild: TreeNode = {
            name: '*',
            children: new Map(),
            isTerminal: false,
            isSelf: false,
            isGlob: true,
          };
          child.children.set('*', globChild);
        } else if (imp.isSelf) {
          child.isSelf = true;
        } else {
          // Mark as terminal, but if it already has children, convert to self
          if (child.children.size > 0 || child.isSelf) {
            child.isSelf = true;
          } else {
            child.isTerminal = true;
          }
        }
      }

      // If this node was terminal and now has children, convert to self
      if (child.isTerminal && i < imp.path.length - 1) {
        child.isTerminal = false;
        child.isSelf = true;
      }

      current = child;
    }

    // Handle root-level terminal (e.g., `use std;`)
    if (imp.path.length === 1) {
      if (imp.isGlob) {
        rootNode.isGlob = true;
      } else if (imp.isSelf) {
        rootNode.isSelf = true;
      } else {
        rootNode.isTerminal = true;
        if (imp.alias) {
          rootNode.alias = imp.alias;
        }
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

    if (node.isSelf && node.children.size === 0) {
      tree.isSelf = true;
      return tree;
    }

    const children: UseTree[] = [];

    // Add self first if present
    if (node.isSelf) {
      children.push({ segment: { name: 'self' }, isSelf: true });
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
 */
export function needsBraces(tree: UseTree): boolean {
  if (!tree.children) {
    return false;
  }
  if (tree.children.length === 1) {
    const child = tree.children[0];
    return child.isSelf === true || child.isGlob === true;
  }
  return tree.children.length > 1;
}

/**
 * Count total imports in a use tree.
 */
export function countImports(tree: UseTree): number {
  if (tree.isGlob || tree.isSelf) {
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
