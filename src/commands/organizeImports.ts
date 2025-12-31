import * as vscode from 'vscode';
import { parseRustFile } from '../parser/useParser';
import { parseCargoDependencies, findCargoToml } from '../parser/cargoParser';
import { groupImports } from '../transformer/grouper';
import { mergeGroupedStatements } from '../transformer/merger';
import { sortUseStatements } from '../transformer/sorter';
import { formatImportsForFile } from '../formatter/useFormatter';
import { CargoDependencies, GroupedImports } from '../parser/types';
import {
  isRustAnalyzerAvailable,
  autoImportUnresolvedSymbols,
  waitForDiagnostics,
} from '../rustAnalyzer/integration';

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
 * Organize imports with auto-import (goimports-like behavior)
 * First auto-imports unresolved symbols, then organizes all imports
 */
export async function organizeImportsWithAutoImport(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  if (editor.document.languageId !== 'rust') {
    vscode.window.showWarningMessage('This command only works with Rust files');
    return;
  }

  const document = editor.document;

  // Check if Rust Analyzer is available
  const raAvailable = await isRustAnalyzerAvailable();

  if (raAvailable) {
    // Wait for diagnostics to be up-to-date
    await waitForDiagnostics(document, 1000);

    // Auto-import unresolved symbols (only when single suggestion exists)
    const importCount = await autoImportUnresolvedSymbols(document);

    if (importCount > 0) {
      // Wait a bit for the document to be updated
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Now organize imports
  await organizeImportsInDocument(document);
}

/**
 * Core function to organize imports in a document
 */
async function organizeImportsInDocument(document: vscode.TextDocument): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return;
  }

  const content = document.getText();

  // Parse the file to extract imports
  const parseResult = parseRustFile(content);

  if (parseResult.imports.length === 0) {
    return;
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
    return;
  }

  // Apply the edit
  const range = new vscode.Range(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, document.lineAt(endLine).text.length)
  );

  await editor.edit(editBuilder => {
    editBuilder.replace(range, formattedImports.trimEnd());
  });
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
