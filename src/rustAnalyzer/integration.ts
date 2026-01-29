import * as vscode from 'vscode';
import { parseUseStatement } from '../parser/useParser';
import type { UseStatement, FlatImport, Range } from '../parser/types';
import { expandToFlatImports, buildUseTree } from '../transformer/merger';

const OUTPUT_CHANNEL = vscode.window.createOutputChannel(
  'Rust Import Organizer',
);

function log(message: string): void {
  OUTPUT_CHANNEL.appendLine(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Check if Rust Analyzer extension is installed and active
 */
export async function isRustAnalyzerAvailable(): Promise<boolean> {
  const rustAnalyzer = vscode.extensions.getExtension(
    'rust-lang.rust-analyzer',
  );
  if (!rustAnalyzer) {
    log('Rust Analyzer extension not found');
    return false;
  }

  if (!rustAnalyzer.isActive) {
    try {
      log('Activating Rust Analyzer extension...');
      await rustAnalyzer.activate();
      log('Rust Analyzer activated');
    } catch (error) {
      log(`Failed to activate Rust Analyzer: ${error}`);
      return false;
    }
  }

  log('Rust Analyzer is available');
  return true;
}

/**
 * Extract full import path from Code Action title
 * e.g., "Import `std::time::Duration`" -> "std::time::Duration"
 * Returns null if title doesn't contain full path (e.g., "Import Duration")
 */
function extractImportPath(title: string): string | null {
  // Match "Import `full::path::Name`" pattern
  const match = title.match(/^Import `([^`]+)`$/);
  if (!match) {
    return null;
  }

  const path = match[1];
  // Must contain :: to be a full path (not just "Import Duration")
  if (!path.includes('::')) {
    return null;
  }

  return path;
}

export interface AutoImportPath {
  path: string;
  isTrait: boolean;
}

/**
 * Check if a diagnostic's relatedInformation indicates a trait import
 * Looks for patterns like: "trait `Write` which provides..."
 */
function isTraitFromDiagnostic(diagnostic: vscode.Diagnostic): Set<string> {
  const traitNames = new Set<string>();

  if (!diagnostic.relatedInformation) {
    return traitNames;
  }

  for (const info of diagnostic.relatedInformation) {
    // Match "trait `TraitName` which provides" pattern
    const match = info.message.match(/trait `(\w+)` which provides/);
    if (match) {
      traitNames.add(match[1]);
    }
  }

  return traitNames;
}

/**
 * Get auto-import paths from diagnostics (without generating edits)
 * Returns paths to import that have exactly one suggestion
 * Also detects if the import is for a trait (should use `as _`)
 */
export async function getAutoImportPaths(
  document: vscode.TextDocument,
): Promise<AutoImportPath[]> {
  log(`\n=== getAutoImportPaths started ===`);

  // Collect all import suggestions: Map from symbol name to set of possible paths
  const symbolToImports = new Map<string, Set<string>>();
  // Track which symbols are traits
  const traitSymbols = new Set<string>();

  try {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);

    for (const diagnostic of diagnostics) {
      // Check if this diagnostic indicates trait imports
      const traitsInDiagnostic = isTraitFromDiagnostic(diagnostic);
      for (const traitName of traitsInDiagnostic) {
        traitSymbols.add(traitName);
        log(`  Detected trait: ${traitName}`);
      }

      const codeActions = await vscode.commands.executeCommand<
        vscode.CodeAction[]
      >(
        'vscode.executeCodeActionProvider',
        document.uri,
        diagnostic.range,
        vscode.CodeActionKind.QuickFix.value,
      );

      if (!codeActions || codeActions.length === 0) {
        continue;
      }

      for (const action of codeActions) {
        const path = extractImportPath(action.title);
        if (path) {
          const symbolName = path.split('::').pop()!;
          if (!symbolToImports.has(symbolName)) {
            symbolToImports.set(symbolName, new Set());
          }
          symbolToImports.get(symbolName)!.add(path);
        }
      }
    }

    // Return only unambiguous imports
    const paths: AutoImportPath[] = [];
    for (const [symbolName, pathSet] of symbolToImports) {
      if (pathSet.size === 1) {
        const path = Array.from(pathSet)[0];
        const isTrait = traitSymbols.has(symbolName);
        log(`  Will import: ${path} (unambiguous, trait: ${isTrait})`);
        paths.push({ path, isTrait });
      } else {
        log(`  Skipping ${symbolName}: ${pathSet.size} options (ambiguous)`);
      }
    }

    return paths;
  } catch (error) {
    log(`Failed to get auto-import paths: ${error}`);
    return [];
  }
}

/**
 * Check if the document has any error-level diagnostics
 * When errors exist, unused import detection may be unreliable due to incomplete analysis
 */
export function hasErrorDiagnostics(document: vscode.TextDocument): boolean {
  const diagnostics = vscode.languages.getDiagnostics(document.uri);
  return diagnostics.some(
    (d) => d.severity === vscode.DiagnosticSeverity.Error,
  );
}

/**
 * Unused import diagnostic with its range in the source
 */
export interface UnusedImportDiagnostic {
  /** Range in the source where the diagnostic points */
  range: Range;
}

/**
 * Get unused import diagnostics from rust-analyzer
 * Returns diagnostics with their source ranges for span-based matching
 */
export function getUnusedImportDiagnostics(
  document: vscode.TextDocument,
): UnusedImportDiagnostic[] {
  log(`\n=== getUnusedImportDiagnostics started ===`);

  const result: UnusedImportDiagnostic[] = [];

  try {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);

    for (const d of diagnostics) {
      const isRustSource = d.source === 'rust-analyzer' || d.source === 'rustc';
      const isUnusedImport =
        d.message.includes('unused import') ||
        d.message.includes('unused_imports');

      if (isRustSource && isUnusedImport) {
        // Convert vscode.Range to our Range type
        const range: Range = {
          start: { line: d.range.start.line, column: d.range.start.character },
          end: { line: d.range.end.line, column: d.range.end.character },
        };
        log(
          `  Found unused import at ${range.start.line}:${range.start.column}-${range.end.line}:${range.end.column}`,
        );
        result.push({ range });
      }
    }
  } catch (error) {
    log(`Failed to get unused diagnostics: ${error}`);
  }

  log(`Found ${result.length} unused import diagnostics`);
  return result;
}

/**
 * Check if a diagnostic range is contained within any of the spans
 */
function rangeContainedInSpans(
  diagRange: Range,
  spans: Range[] | undefined,
): boolean {
  if (!spans || spans.length === 0) {
    return false;
  }

  for (const span of spans) {
    // Check if diagRange is contained within span
    // A range is contained if its start is >= span start and end is <= span end
    const startContained =
      diagRange.start.line > span.start.line ||
      (diagRange.start.line === span.start.line &&
        diagRange.start.column >= span.start.column);
    const endContained =
      diagRange.end.line < span.end.line ||
      (diagRange.end.line === span.end.line &&
        diagRange.end.column <= span.end.column);

    if (startContained && endContained) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a flat import is marked as unused by any diagnostic
 */
function isUnusedByDiagnostics(
  flat: FlatImport,
  diagnostics: UnusedImportDiagnostic[],
): boolean {
  for (const diag of diagnostics) {
    if (rangeContainedInSpans(diag.range, flat.spans)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter imports to remove unused imports (span-based matching)
 * Returns a new array with filtered imports (imports with all unused imports are removed)
 * When both `X` and `X as _` exist, prioritizes removing `X as _` first.
 * Uses span-based matching: diagnostic range must be contained in import's spans
 */
export function filterUnusedImports(
  imports: UseStatement[],
  unusedDiagnostics: UnusedImportDiagnostic[],
): UseStatement[] {
  if (unusedDiagnostics.length === 0) {
    return imports;
  }

  const result: UseStatement[] = [];

  for (const stmt of imports) {
    // Expand to flat imports (with spans)
    const flats = expandToFlatImports(stmt.tree);

    // Check which paths have an underscore alias version
    // Key: full path joined with ::
    const pathHasUnderscore = new Map<string, boolean>();
    for (const flat of flats) {
      if (flat.alias === '_') {
        pathHasUnderscore.set(flat.path.join('::'), true);
      }
    }

    // Filter: prioritize removing `as _` versions
    const filtered: FlatImport[] = [];

    for (const flat of flats) {
      const fullPath = flat.path.join('::');

      if (isUnusedByDiagnostics(flat, unusedDiagnostics)) {
        // This import is unused
        if (flat.alias === '_') {
          // Remove `as _` version
          log(`  Removing ${fullPath} as _ (underscore alias, unused)`);
        } else if (pathHasUnderscore.get(fullPath)) {
          // Keep non-underscore version when underscore version exists
          // (underscore version will be removed instead)
          log(`  Keeping ${fullPath} (underscore version will be removed)`);
          filtered.push(flat);
        } else {
          // Remove non-underscore version when no underscore version exists
          log(`  Removing ${fullPath} (no underscore version, unused)`);
        }
      } else {
        // Not unused, keep it
        filtered.push(flat);
      }
    }

    if (filtered.length === 0) {
      // All imports were removed
      continue;
    }

    // Rebuild UseTree from filtered flat imports
    const newTree = buildUseTree(filtered);
    if (!newTree) {
      continue;
    }

    result.push({
      ...stmt,
      tree: newTree,
    });
  }

  return result;
}

/**
 * Create UseStatements from import paths
 * e.g., "std::io::Read" -> UseStatement
 * For traits, adds `as _` to avoid bringing the name into scope
 */
export function createUseStatementsFromPaths(
  paths: AutoImportPath[],
): UseStatement[] {
  const statements: UseStatement[] = [];

  for (const { path, isTrait } of paths) {
    try {
      const useStr = isTrait ? `use ${path} as _;` : `use ${path};`;
      const stmt = parseUseStatement(useStr);
      statements.push(stmt);
      log(`  Created: ${useStr}`);
    } catch (e) {
      log(`Failed to create UseStatement from path: ${path}`);
    }
  }

  return statements;
}
