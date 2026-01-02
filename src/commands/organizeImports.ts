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
  removeUnusedImports,
  collectAutoImportEdits,
  collectRemoveUnusedEdits,
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
 * Get extension configuration
 */
function getConfig() {
  const config = vscode.workspace.getConfiguration('rustImportOrganizer');
  return {
    enableAutoImport: config.get<boolean>('enableAutoImport', true),
    enableGroupImports: config.get<boolean>('enableGroupImports', true),
    enableRemoveUnusedImports: config.get<boolean>('enableRemoveUnusedImports', true),
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

  // Collect all edits first, then apply them together
  const raAvailable = await isRustAnalyzerAvailable();

  // Step 1: Collect remove unused and auto-import edits (both depend on diagnostics)
  const combinedEdit = new vscode.WorkspaceEdit();
  let editCount = 0;

  if (raAvailable) {
    // Collect remove unused edits
    if (config.enableRemoveUnusedImports) {
      const removeResult = collectRemoveUnusedEdits(document);
      for (const e of removeResult.edits) {
        if (e.text === null) {
          combinedEdit.delete(document.uri, e.range);
        } else {
          combinedEdit.replace(document.uri, e.range, e.text);
        }
      }
      editCount += removeResult.count;
    }

    // Collect auto-import edits
    if (config.enableAutoImport) {
      const autoImportResult = await collectAutoImportEdits(document);
      for (const e of autoImportResult.edits) {
        combinedEdit.insert(document.uri, e.position, e.text);
      }
      editCount += autoImportResult.count;
    }
  }

  // Apply combined edits
  let didChange = false;
  if (editCount > 0) {
    const applied = await vscode.workspace.applyEdit(combinedEdit);
    if (applied) {
      didChange = true;
    }
  }

  // Step 2: Group and sort imports (after remove/add edits are applied)
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

  if (parseResult.imports.length === 0 || !parseResult.importsRange) {
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

  // Use the importsRange from parse result
  const importsRange = parseResult.importsRange;
  const startLine = importsRange.start.line;
  const endLine = importsRange.end.line;
  const startCol = importsRange.start.column;
  const endCol = importsRange.end.column;

  // Determine if there's code before/after the imports on the same line
  const hasCodeBeforeImports = startCol > 0;
  const hasCodeAfterImports = endCol < document.lineAt(endLine).text.length;
  const needsBlankLineAfter = !parseResult.hasBlankLineAfterImports && !hasCodeAfterImports;

  // Apply the edit
  const range = new vscode.Range(
    new vscode.Position(startLine, startCol),
    new vscode.Position(endLine, endCol)
  );

  // Build formatted text with proper spacing
  let formattedText = formattedImports.trimEnd();
  if (hasCodeBeforeImports) {
    formattedText = '\n\n' + formattedText;
  }
  if (hasCodeAfterImports) {
    formattedText = formattedText + '\n\n';
  } else if (needsBlankLineAfter) {
    // Add blank line when there's code on the next line but no blank line
    formattedText = formattedText + '\n';
  }

  await editor.edit(editBuilder => {
    editBuilder.replace(range, formattedText);
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
