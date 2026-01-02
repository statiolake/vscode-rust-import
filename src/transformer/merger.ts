import { UseStatement, UseTree, UsePathSegment } from '../parser/types';
import { getRootPath } from '../parser/useParser';

/**
 * Trie node for building merged import trees
 */
interface TrieNode {
  segment: UsePathSegment;
  children: Map<string, TrieNode>;
  isTerminal: boolean;
  isSelf: boolean;
  isGlob: boolean;
}

/**
 * Create a new trie node
 */
function createTrieNode(segment: UsePathSegment): TrieNode {
  return {
    segment,
    children: new Map(),
    isTerminal: false,
    isSelf: false,
    isGlob: false,
  };
}

/**
 * Insert a use tree into a trie
 */
function insertIntoTrie(root: TrieNode, tree: UseTree): void {
  let current = root;

  // Handle the root segment specially (it should match the trie root)
  if (tree.segment.name !== root.segment.name) {
    // Root mismatch - this shouldn't happen if grouping is done correctly
    return;
  }

  // Copy alias if present
  if (tree.segment.alias) {
    current.segment.alias = tree.segment.alias;
  }

  // Process children
  if (!tree.children || tree.children.length === 0) {
    // Terminal node
    current.isTerminal = true;
    return;
  }

  for (const child of tree.children) {
    insertChildIntoTrie(current, child);
  }
}

/**
 * Insert a child tree into a trie node
 */
function insertChildIntoTrie(parent: TrieNode, tree: UseTree): void {
  if (tree.isSelf) {
    // Self import - mark parent as having self
    parent.isSelf = true;
    return;
  }

  if (tree.isGlob) {
    // Glob import
    parent.isGlob = true;
    return;
  }

  const key = tree.segment.name;
  let node = parent.children.get(key);

  if (!node) {
    node = createTrieNode({ ...tree.segment });
    parent.children.set(key, node);
  } else if (tree.segment.alias && !node.segment.alias) {
    // Update alias if the new one has it
    node.segment.alias = tree.segment.alias;
  }

  if (!tree.children || tree.children.length === 0) {
    // Terminal node - if this node already has children, we need to add self
    if (node.children.size > 0 || node.isSelf || node.isGlob) {
      node.isSelf = true;
    } else {
      node.isTerminal = true;
    }
    return;
  }

  // If this node was previously terminal and now has children, convert to self
  if (node.isTerminal) {
    node.isTerminal = false;
    node.isSelf = true;
  }

  for (const child of tree.children) {
    insertChildIntoTrie(node, child);
  }
}

/**
 * Convert a trie back to a UseTree
 */
function trieToUseTree(node: TrieNode): UseTree {
  const tree: UseTree = {
    segment: { ...node.segment },
  };

  const children: UseTree[] = [];

  // Add self first if present
  if (node.isSelf) {
    children.push({
      segment: { name: 'self' },
      isSelf: true,
    });
  }

  // Add regular children
  for (const child of node.children.values()) {
    if (child.isTerminal && child.children.size === 0 && !child.isSelf && !child.isGlob) {
      // Leaf node - just add the segment
      children.push({
        segment: { ...child.segment },
      });
    } else {
      // Non-leaf node - recurse
      children.push(trieToUseTree(child));
    }
  }

  // Add glob last if present
  if (node.isGlob) {
    children.push({
      segment: { name: '*' },
      isGlob: true,
    });
  }

  if (children.length > 0) {
    tree.children = children;
  }

  return tree;
}

/**
 * Merge multiple use statements with the same root into one
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
    if (groupStmts.length === 1) {
      result.push(groupStmts[0]);
      continue;
    }

    // Build a trie from all statements in the group
    const firstStmt = groupStmts[0];
    const root = createTrieNode({ ...firstStmt.tree.segment });

    for (const stmt of groupStmts) {
      insertIntoTrie(root, stmt.tree);
    }

    // Convert trie back to UseTree
    const mergedTree = trieToUseTree(root);

    // Create merged statement (take visibility from first, no attributes for merged)
    // Compute the merged range from all statements in the group
    const minStartLine = Math.min(...groupStmts.map(s => s.range.start.line));
    const maxEndLine = Math.max(...groupStmts.map(s => s.range.end.line));
    const firstOnMinLine = groupStmts.find(s => s.range.start.line === minStartLine)!;
    const lastOnMaxLine = groupStmts.find(s => s.range.end.line === maxEndLine)!;

    result.push({
      visibility: firstStmt.visibility,
      tree: mergedTree,
      range: {
        start: { line: minStartLine, column: firstOnMinLine.range.start.column },
        end: { line: maxEndLine, column: lastOnMaxLine.range.end.column },
      },
    });
  }

  return result;
}

/**
 * Merge statements within each group
 */
export function mergeGroupedStatements(statements: UseStatement[]): UseStatement[] {
  // Group by visibility (different visibility = different statement)
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
 * Check if a use tree needs braces (has multiple children or special cases)
 */
export function needsBraces(tree: UseTree): boolean {
  if (!tree.children) {
    return false;
  }
  // Single child that is self or glob needs braces
  if (tree.children.length === 1) {
    const child = tree.children[0];
    return child.isSelf === true || child.isGlob === true;
  }
  return tree.children.length > 1;
}

/**
 * Count total imports in a use tree
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
