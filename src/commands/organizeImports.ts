import * as vscode from 'vscode';
import { parseRustFile } from '../parser/useParser';
import { parseCargoDependencies, findCargoToml } from '../parser/cargoParser';
import { groupImports } from '../transformer/grouper';
import { mergeGroupedStatements } from '../transformer/merger';
import { sortUseStatements } from '../transformer/sorter';
import { formatImportsForFile } from '../formatter/useFormatter';
import { CargoDependencies, GroupedImports } from '../parser/types';
import { isRustAnalyzerAvailable, autoImportUnresolvedSymbols } from '../rustAnalyzer/integration';

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
  };
}

/**
 * Core function to organize imports in a document
 */
export async function organizeImportsInDocument(document: vscode.TextDocument): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return false;
  }

  const config = getConfig();
  let didChange = false;

  // Step 1: Auto-import unresolved symbols (if enabled)
  if (config.enableAutoImport) {
    const raAvailable = await isRustAnalyzerAvailable();
    if (raAvailable) {
      const importCount = await autoImportUnresolvedSymbols(document);
      if (importCount > 0) {
        didChange = true;
      }
    }
  }

  // Step 2: Group and sort imports (if enabled)
  if (config.enableGroupImports) {
    const grouped = await groupAndSortImports(document);
    if (grouped) {
      didChange = true;
    }
  }

  return didChange;
}

/**
 * Group and sort imports in a document
 */
async function groupAndSortImports(document: vscode.TextDocument): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return false;
  }

  const content = document.getText();

  // Parse the file to extract imports
  const parseResult = parseRustFile(content);

  if (parseResult.imports.length === 0) {
    return false;
  }

  // Get Cargo.toml dependencies
  const cargoDeps = await getCargoDependencies(document.uri.fsPath);

  // Process imports: group -> merge -> sort
  const groups = groupImports(parseResult.imports, cargoDeps);

  const processedGroups: GroupedImports[] = groups.map(group => ({
    category: group.category,
    imports: sortUseStatements(mergeGroupedStatements(group.imports)),
  }));

  // Format the imports
  const formattedImports = formatImportsForFile(processedGroups);

  // Calculate the range to replace
  const startLine = parseResult.importStartLine;
  const endLine = parseResult.importEndLine;

  if (startLine < 0 || endLine < 0) {
    return false;
  }

  // Apply the edit
  const range = new vscode.Range(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, document.lineAt(endLine).text.length)
  );

  await editor.edit(editBuilder => {
    editBuilder.replace(range, formattedImports.trimEnd());
  });

  return true;
}

/**
 * Get Cargo.toml dependencies for the given file path
 */
async function getCargoDependencies(filePath: string): Promise<CargoDependencies> {
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
