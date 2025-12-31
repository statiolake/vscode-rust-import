import { UseStatement, ImportCategory, GroupedImports, CargoDependencies } from '../parser/types';
import { getRootPath } from '../parser/useParser';
import { isStdLibrary, isInternalImport, isDependency } from '../parser/cargoParser';

/**
 * Categorize a use statement based on its root path
 */
export function categorizeImport(
  stmt: UseStatement,
  cargoDeps: CargoDependencies
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
 * Group imports by category
 */
export function groupImports(
  imports: UseStatement[],
  cargoDeps: CargoDependencies
): GroupedImports[] {
  const groups: Map<ImportCategory, UseStatement[]> = new Map();

  // Initialize all groups
  groups.set(ImportCategory.Std, []);
  groups.set(ImportCategory.External, []);
  groups.set(ImportCategory.Internal, []);
  groups.set(ImportCategory.Attributed, []);

  // Categorize each import
  for (const stmt of imports) {
    const category = categorizeImport(stmt, cargoDeps);
    groups.get(category)!.push(stmt);
  }

  // Convert to array and filter out empty groups
  const result: GroupedImports[] = [];

  for (const category of [
    ImportCategory.Std,
    ImportCategory.External,
    ImportCategory.Internal,
    ImportCategory.Attributed,
  ]) {
    const categoryImports = groups.get(category)!;
    if (categoryImports.length > 0) {
      result.push({
        category,
        imports: categoryImports,
      });
    }
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
