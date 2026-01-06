import { UseTree, UseStatement } from '../parser/types';

/**
 * Sort use statements alphabetically by their full path
 */
export function sortUseStatements(statements: UseStatement[]): UseStatement[] {
  return [...statements].sort((a, b) => {
    const pathA = getFullPath(a.tree);
    const pathB = getFullPath(b.tree);
    return pathA.localeCompare(pathB);
  });
}

/**
 * Sort children within a use tree
 * Rules:
 * - 'self' comes first
 * - Then alphabetical order
 * - Globs (*) come last
 */
export function sortUseTree(tree: UseTree): UseTree {
  if (!tree.children || tree.children.length === 0) {
    return tree;
  }

  const sortedChildren = [...tree.children]
    .map((child) => sortUseTree(child))
    .sort((a, b) => {
      // self comes first
      if (a.isSelf && !b.isSelf) {
        return -1;
      }
      if (!a.isSelf && b.isSelf) {
        return 1;
      }

      // globs come last
      if (a.isGlob && !b.isGlob) {
        return 1;
      }
      if (!a.isGlob && b.isGlob) {
        return -1;
      }

      // alphabetical order
      return a.segment.name.localeCompare(b.segment.name);
    });

  return {
    ...tree,
    children: sortedChildren,
  };
}

/**
 * Get the full path of a use tree as a string for sorting
 */
function getFullPath(tree: UseTree): string {
  const parts: string[] = [tree.segment.name];

  if (tree.children && tree.children.length > 0) {
    // Use the first child for sorting (after they're sorted)
    const sortedTree = sortUseTree(tree);
    if (sortedTree.children && sortedTree.children.length > 0) {
      parts.push(getFullPath(sortedTree.children[0]));
    }
  }

  return parts.join('::');
}

/**
 * Compare two use statements for sorting
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export function compareUseStatements(a: UseStatement, b: UseStatement): number {
  return getFullPath(a.tree).localeCompare(getFullPath(b.tree));
}
