import {
  UseStatement,
  ImportCategory,
  GroupedImports,
  CargoDependencies,
} from '../parser/types';
import { getRootPath } from '../parser/useParser';
import {
  isStdLibrary,
  isInternalImport,
  isDependency,
} from '../parser/cargoParser';

/**
 * Categorize a use statement based on its root path
 */
export function categorizeImport(
  stmt: UseStatement,
  cargoDeps: CargoDependencies,
): ImportCategory {
  // Attributed imports go to their own group
  if (stmt.attributes && stmt.attributes.length > 0) {
    return ImportCategory.Attributed;
  }

  const rootPath = getRootPath(stmt.tree);

  // Standard library
  if (isStdLibrary(rootPath)) {
    return ImportCategory.Std;
  }

  // Internal (crate/super/self)
  if (isInternalImport(rootPath)) {
    return ImportCategory.Internal;
  }

  // Check if it's in Cargo.toml dependencies
  if (isDependency(rootPath, cargoDeps)) {
    return ImportCategory.External;
  }

  // Default: treat as external (for cases like proc-macro crates or unknown deps)
  return ImportCategory.External;
}

/**
 * Get a unique key for an import's attributes (for grouping same attributes together)
 */
function getAttributeKey(attributes: string[] | undefined): string {
  if (!attributes || attributes.length === 0) {
    return '';
  }
  // Sort for consistent ordering
  return [...attributes].sort().join('\n');
}

/**
 * Group imports by category
 */
export function groupImports(
  imports: UseStatement[],
  cargoDeps: CargoDependencies,
): GroupedImports[] {
  const groups: Map<ImportCategory, UseStatement[]> = new Map();
  // Attributed imports are grouped by their attribute content
  const attributedGroups: Map<string, UseStatement[]> = new Map();

  // Initialize non-attributed groups
  groups.set(ImportCategory.Std, []);
  groups.set(ImportCategory.External, []);
  groups.set(ImportCategory.Internal, []);

  // Categorize each import
  for (const stmt of imports) {
    const category = categorizeImport(stmt, cargoDeps);
    if (category === ImportCategory.Attributed) {
      // Group attributed imports by their attribute content
      const key = getAttributeKey(stmt.attributes);
      const existing = attributedGroups.get(key) || [];
      existing.push(stmt);
      attributedGroups.set(key, existing);
    } else {
      groups.get(category)!.push(stmt);
    }
  }

  // Convert to array and filter out empty groups
  const result: GroupedImports[] = [];

  for (const category of [
    ImportCategory.Std,
    ImportCategory.External,
    ImportCategory.Internal,
  ]) {
    const categoryImports = groups.get(category)!;
    if (categoryImports.length > 0) {
      result.push({
        category,
        imports: categoryImports,
      });
    }
  }

  // Add attributed groups (each unique attribute combination is a separate group)
  for (const [, attrImports] of attributedGroups) {
    result.push({
      category: ImportCategory.Attributed,
      imports: attrImports,
    });
  }

  return result;
}

/**
 * Get a human-readable name for an import category
 */
export function getCategoryName(category: ImportCategory): string {
  switch (category) {
    case ImportCategory.Std:
      return 'Standard Library';
    case ImportCategory.External:
      return 'External Crates';
    case ImportCategory.Internal:
      return 'Internal Modules';
    case ImportCategory.Attributed:
      return 'Conditional Imports';
    default:
      return 'Unknown';
  }
}
