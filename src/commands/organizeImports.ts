import * as vscode from 'vscode';
import { formatUseStatementsWithRustfmt } from '../formatter/rustfmt';
import { formatImportsForFile } from '../formatter/useFormatter';
import { findCargoToml, parseCargoDependencies } from '../parser/cargoParser';
import { CargoDependencies, GroupedImports } from '../parser/types';
import { parseRustFile } from '../parser/useParser';
import {
  isRustAnalyzerAvailable,
  hasErrorDiagnostics,
  getUnusedSymbols,
  getAutoImportPaths,
  filterUnusedImports,
  createUseStatementsFromPaths,
  AutoImportPath,
} from '../rustAnalyzer/integration';
import { groupImports } from '../transformer/grouper';
import { mergeGroupedStatements, setMergerLogger } from '../transformer/merger';
import { sortUseStatements } from '../transformer/sorter';

// Set up merger logging
const OUTPUT_CHANNEL = vscode.window.createOutputChannel(
  'Rust Import Organizer - Merger Debug',
);

function mergerLog(message: string): void {
  OUTPUT_CHANNEL.appendLine(`[${new Date().toISOString()}] ${message}`);
}

setMergerLogger(mergerLog);

/**
 * Organize imports in the current Rust file
 */
export async function organizeImports(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  if (editor.document.languageId !== 'rust') {
    vscode.window.showWarningMessage('This command only works with Rust files');
    return;
  }

  await organizeImportsInDocument(editor.document);
}

/**
 * Get extension configuration
 */
function getConfig() {
  const config = vscode.workspace.getConfiguration('rustImportOrganizer');
  return {
    enableAutoImport: config.get<boolean>('enableAutoImport', true),
    enableGroupImports: config.get<boolean>('enableGroupImports', true),
    enableRemoveUnusedImports: config.get<boolean>(
      'enableRemoveUnusedImports',
      true,
    ),
    useRustfmt: config.get<boolean>('useRustfmt', true),
  };
}

/**
 * Core function to organize imports in a document
 * All changes are applied in a single edit to prevent flickering
 */
export async function organizeImportsInDocument(
  document: vscode.TextDocument,
): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return false;
  }

  const config = getConfig();
  const content = document.getText();
  const lines = content.split('\n');

  // Step 1: Parse existing imports
  const parseResult = parseRustFile(content);
  let imports = parseResult.imports;

  // Step 2: Get unused symbols and auto-import paths from diagnostics
  const raAvailable = await isRustAnalyzerAvailable();
  let autoImportPaths: AutoImportPath[] = [];

  if (raAvailable) {
    // Filter out unused imports (skip if there are error diagnostics to avoid false positives)
    if (config.enableRemoveUnusedImports && !hasErrorDiagnostics(document)) {
      const unusedSymbols = getUnusedSymbols(document);
      imports = filterUnusedImports(imports, unusedSymbols);
    }

    // Get paths to auto-import
    if (config.enableAutoImport) {
      autoImportPaths = await getAutoImportPaths(document);
    }
  }

  // Step 3: Create UseStatements from auto-import paths and combine with existing
  const newImports = createUseStatementsFromPaths(autoImportPaths);
  const allImports = [...imports, ...newImports];

  // If no imports after filtering and no new imports, nothing to do
  if (allImports.length === 0 && parseResult.imports.length === 0) {
    return false;
  }

  // Step 4: Group, merge, and sort all imports
  const cargoDeps = await getCargoDependencies(document.uri.fsPath);

  let formattedImports: string;
  if (config.enableGroupImports && allImports.length > 0) {
    const groups = groupImports(allImports, cargoDeps);
    const processedGroups: GroupedImports[] = groups.map((group) => ({
      category: group.category,
      imports: sortUseStatements(mergeGroupedStatements(group.imports)),
    }));
    formattedImports = formatImportsForFile(processedGroups);
  } else if (allImports.length > 0) {
    // Just format imports without grouping
    const groups = groupImports(allImports, cargoDeps);
    formattedImports = formatImportsForFile(groups);
  } else {
    formattedImports = '';
  }

  // Apply rustfmt if enabled
  if (formattedImports) {
    formattedImports = await formatUseStatementsWithRustfmt(
      formattedImports,
      config.useRustfmt,
    );
  }

  // Step 5: Calculate the range to replace and apply single edit
  let startLine: number;
  let startCol: number;
  let endLine: number;
  let endCol: number;

  if (parseResult.importsRange) {
    // There are existing imports - replace them
    startLine = parseResult.importsRange.start.line;
    startCol = parseResult.importsRange.start.column;
    endLine = parseResult.importsRange.end.line;
    endCol = parseResult.importsRange.end.column;
  } else if (allImports.length > 0) {
    // No existing imports but we have new ones - find insertion point
    const insertLine = findImportInsertionLine(lines);
    startLine = insertLine;
    startCol = 0;
    endLine = insertLine;
    endCol = 0;
  } else {
    // No imports at all
    return false;
  }

  // Determine spacing needs
  const hasCodeBeforeImports = startCol > 0;
  const hasCodeAfterImports = endCol < lines[endLine].length;
  const needsBlankLineAfter =
    !parseResult.hasBlankLineAfterImports && !hasCodeAfterImports;

  // Build formatted text with proper spacing
  let formattedText = formattedImports.trimEnd();
  if (hasCodeBeforeImports) {
    formattedText = '\n\n' + formattedText;
  }
  if (hasCodeAfterImports) {
    formattedText = formattedText + '\n\n';
  } else if (needsBlankLineAfter && formattedText) {
    formattedText = formattedText + '\n';
  }

  // If no existing imports but adding new ones, ensure proper formatting
  if (!parseResult.importsRange && allImports.length > 0) {
    // Check if we need a blank line after
    if (startLine < lines.length && lines[startLine].trim() !== '') {
      formattedText = formattedText + '\n';
    }
  }

  // Apply the single edit
  const range = new vscode.Range(
    new vscode.Position(startLine, startCol),
    new vscode.Position(endLine, endCol),
  );

  const currentText = document.getText(range);
  if (currentText === formattedText) {
    // No changes needed
    return false;
  }

  await editor.edit((editBuilder) => {
    editBuilder.replace(range, formattedText);
  });

  return true;
}

/**
 * Find the line to insert imports when there are no existing imports
 */
function findImportInsertionLine(lines: string[]): number {
  let insertLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      line.startsWith('#![') || // inner attribute
      line.startsWith('//!') || // module doc comment
      line.startsWith('extern crate') // extern crate
    ) {
      insertLine = i + 1;
    } else if (line === '' || line.startsWith('//')) {
      // Skip empty lines and regular comments at the top
      if (insertLine === i) {
        insertLine = i + 1;
      }
    } else if (line.startsWith('mod ')) {
      // Found mod, insert before it
      insertLine = i;
      break;
    } else if (line.length > 0 && !line.startsWith('#[')) {
      // Found other code
      break;
    }
  }

  return insertLine;
}

/**
 * Get Cargo.toml dependencies for the given file path
 */
async function getCargoDependencies(
  filePath: string,
): Promise<CargoDependencies> {
  const cargoPath = findCargoToml(filePath);

  if (!cargoPath) {
    return {
      dependencies: new Set(),
      devDependencies: new Set(),
      buildDependencies: new Set(),
    };
  }

  return parseCargoDependencies(cargoPath);
}
