import { UseStatement, UseTree, GroupedImports } from '../parser/types';
import { sortUseTree } from '../transformer/sorter';

/**
 * Format a use tree as a string (handles nested structures)
 */
export function formatUseTree(tree: UseTree, indent: string = ''): string {
  if (tree.isGlob) {
    return '*';
  }

  if (tree.isSelf) {
    if (tree.segment.alias) {
      return `self as ${tree.segment.alias}`;
    }
    return 'self';
  }

  let result = tree.segment.name;

  if (tree.segment.alias) {
    result += ` as ${tree.segment.alias}`;
  }

  if (tree.children && tree.children.length > 0) {
    // Sort children before formatting
    const sortedTree = sortUseTree(tree);
    result += '::';

    if (sortedTree.children!.length === 1) {
      // Single child - inline it
      const child = sortedTree.children![0];
      result += formatUseTree(child, indent);
    } else {
      // Multiple children - use braces with multi-line format
      result += formatBracedChildren(sortedTree.children!, indent);
    }
  }

  return result;
}

/**
 * Format multiple children in braces (multi-line format)
 */
function formatBracedChildren(children: UseTree[], indent: string): string {
  const childIndent = indent + '    ';
  const lines: string[] = ['{'];

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childStr = formatUseTree(child, childIndent);
    const comma = i < children.length - 1 ? ',' : ',';
    lines.push(`${childIndent}${childStr}${comma}`);
  }

  lines.push(`${indent}}`);
  return lines.join('\n');
}

/**
 * Format a single use statement
 */
export function formatUseStatement(stmt: UseStatement): string {
  const lines: string[] = [];

  // Add attributes first
  if (stmt.attributes && stmt.attributes.length > 0) {
    lines.push(...stmt.attributes);
  }

  // Build the use statement
  let useStr = '';

  if (stmt.visibility) {
    useStr += stmt.visibility + ' ';
  }

  useStr += 'use ';

  // Sort the tree before formatting
  const sortedTree = sortUseTree(stmt.tree);

  // Format the tree
  if (sortedTree.children && sortedTree.children.length > 0) {
    useStr += sortedTree.segment.name + '::';

    if (sortedTree.children.length === 1) {
      // Single child
      const child = sortedTree.children[0];
      useStr += formatUseTree(child, '');
    } else {
      // Multiple children - always use multi-line
      useStr += formatBracedChildren(sortedTree.children, '');
    }
  } else {
    // Single path without children
    useStr += sortedTree.segment.name;
    if (sortedTree.segment.alias) {
      useStr += ` as ${sortedTree.segment.alias}`;
    }
  }

  useStr += ';';
  lines.push(useStr);

  return lines.join('\n');
}

/**
 * Format all grouped imports
 */
export function formatGroupedImports(groups: GroupedImports[]): string {
  const sections: string[] = [];

  for (const group of groups) {
    const formattedImports = group.imports.map((stmt) =>
      formatUseStatement(stmt),
    );
    sections.push(formattedImports.join('\n'));
  }

  // Join groups with blank lines
  return sections.join('\n\n');
}

/**
 * Format imports to replace in a file
 */
export function formatImportsForFile(groups: GroupedImports[]): string {
  if (groups.length === 0) {
    return '';
  }

  const formatted = formatGroupedImports(groups);
  return formatted + '\n';
}
