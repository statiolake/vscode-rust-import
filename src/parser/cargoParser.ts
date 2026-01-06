import * as fs from 'fs';
import * as path from 'path';
import * as TOML from 'toml';
import { CargoDependencies } from './types';

/**
 * Parse Cargo.toml and extract all dependency names
 */
export function parseCargoDependencies(
  cargoTomlPath: string,
): CargoDependencies {
  const result: CargoDependencies = {
    dependencies: new Set<string>(),
    devDependencies: new Set<string>(),
    buildDependencies: new Set<string>(),
  };

  if (!fs.existsSync(cargoTomlPath)) {
    return result;
  }

  try {
    const content = fs.readFileSync(cargoTomlPath, 'utf-8');
    const parsed = TOML.parse(content);

    // Extract dependencies
    extractDependencies(parsed.dependencies, result.dependencies);
    extractDependencies(parsed['dev-dependencies'], result.devDependencies);
    extractDependencies(parsed['build-dependencies'], result.buildDependencies);

    // Handle workspace dependencies if this is a workspace member
    if (parsed.workspace?.dependencies) {
      extractDependencies(parsed.workspace.dependencies, result.dependencies);
    }
  } catch (e) {
    // Return empty result on parse error
  }

  return result;
}

/**
 * Extract dependency names from a TOML dependencies section
 */
function extractDependencies(
  deps: Record<string, unknown> | undefined,
  target: Set<string>,
): void {
  if (!deps || typeof deps !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(deps)) {
    // Handle renamed packages: { package = "actual-name", ... }
    if (value && typeof value === 'object' && 'package' in value) {
      const packageName = (value as { package: string }).package;
      // Normalize crate name: replace - with _
      target.add(normalizeCrateName(packageName));
    } else {
      // Normalize crate name: replace - with _
      target.add(normalizeCrateName(key));
    }
  }
}

/**
 * Normalize a crate name for import matching
 * Rust crates use - in Cargo.toml but _ in import paths
 */
export function normalizeCrateName(name: string): string {
  return name.replace(/-/g, '_');
}

/**
 * Find Cargo.toml by traversing up from a Rust file path
 */
export function findCargoToml(rustFilePath: string): string | null {
  let dir = path.dirname(rustFilePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const cargoPath = path.join(dir, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
      return cargoPath;
    }
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Check if a crate name is a known dependency
 */
export function isDependency(
  crateName: string,
  cargoDeps: CargoDependencies,
): boolean {
  const normalized = normalizeCrateName(crateName);
  return (
    cargoDeps.dependencies.has(normalized) ||
    cargoDeps.devDependencies.has(normalized) ||
    cargoDeps.buildDependencies.has(normalized)
  );
}

/**
 * Check if a crate name is from the standard library
 */
export function isStdLibrary(crateName: string): boolean {
  return ['std', 'core', 'alloc'].includes(crateName);
}

/**
 * Check if a crate name is an internal import
 */
export function isInternalImport(crateName: string): boolean {
  return ['crate', 'super', 'self'].includes(crateName);
}
