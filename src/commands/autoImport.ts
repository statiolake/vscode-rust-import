import * as vscode from 'vscode';
import {
  isRustAnalyzerAvailable,
  autoImportUnresolvedSymbols,
} from '../rustAnalyzer/integration';

/**
 * Auto-import unresolved symbols using Rust Analyzer
 * Only applies imports when there's exactly one suggestion (like goimports)
 */
export async function autoImport(): Promise<void> {
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

  if (!raAvailable) {
    vscode.window.showWarningMessage(
      'Rust Analyzer extension is required for auto-import. Please install it from the marketplace.',
    );
    return;
  }

  // Auto-import unresolved symbols (only when single suggestion exists)
  const importCount = await autoImportUnresolvedSymbols(document);

  if (importCount > 0) {
    vscode.window.showInformationMessage(`Added ${importCount} import(s)`);
  }
  // Don't show message when no imports - it's noisy for normal usage
}
