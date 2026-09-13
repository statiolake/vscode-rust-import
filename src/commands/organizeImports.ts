import * as vscode from 'vscode';
import { formatUseStatementsWithRustfmt } from '../formatter/rustfmt';
import { formatImportsForFile } from '../formatter/useFormatter';
import { computeImportsEdit } from './importsEdit';
import { findCargoToml, parseCargoDependencies } from '../parser/cargoParser';
import { CargoDependencies, GroupedImports } from '../parser/types';
import { parseRustFile } from '../parser/useParser';
import {
  isRustAnalyzerAvailable,
  hasErrorDiagnostics,
  getUnusedImportDiagnostics,
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

  // Step 1: Parse existing imports
  const parseResult = parseRustFile(content);
  let imports = parseResult.imports;

  // Step 2: Get unused symbols and auto-import paths from diagnostics
  const raAvailable = await isRustAnalyzerAvailable();
  let autoImportPaths: AutoImportPath[] = [];

  if (raAvailable) {
    // Filter out unused imports (skip if there are error diagnostics to avoid false positives)
    if (config.enableRemoveUnusedImports && !hasErrorDiagnostics(document)) {
      const unusedDiagnostics = getUnusedImportDiagnostics(document);
      imports = filterUnusedImports(imports, unusedDiagnostics);
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

  // Step 5: Calculate the edit and apply it in a single edit
  const edit = computeImportsEdit(content, parseResult, formattedImports);
  if (!edit) {
    return false;
  }

  const range = new vscode.Range(
    new vscode.Position(edit.range.start.line, edit.range.start.column),
    new vscode.Position(edit.range.end.line, edit.range.end.column),
  );

  await editor.edit((editBuilder) => {
    editBuilder.replace(range, edit.text);
  });

  // Clear rust-analyzer diagnostics so they get recalculated
  try {
    await vscode.commands.executeCommand('rust-analyzer.clearFlycheck');
  } catch {
    // Ignore if rust-analyzer is not available
  }

  return true;
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
