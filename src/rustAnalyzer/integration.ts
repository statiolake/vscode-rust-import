import * as vscode from 'vscode';

/**
 * Check if Rust Analyzer extension is installed and active
 */
export async function isRustAnalyzerAvailable(): Promise<boolean> {
  const rustAnalyzer = vscode.extensions.getExtension('rust-lang.rust-analyzer');
  if (!rustAnalyzer) {
    return false;
  }

  if (!rustAnalyzer.isActive) {
    try {
      await rustAnalyzer.activate();
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Execute Rust Analyzer's organize imports code action
 * This will add any missing imports that have a single unambiguous resolution
 */
export async function executeOrganizeImports(
  document: vscode.TextDocument
): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return false;
  }

  try {
    // Get all code actions for the entire document
    const range = new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(document.lineCount - 1, 0)
    );

    const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      range,
      vscode.CodeActionKind.SourceOrganizeImports.value
    );

    if (codeActions && codeActions.length > 0) {
      for (const action of codeActions) {
        if (action.edit) {
          await vscode.workspace.applyEdit(action.edit);
        }
        if (action.command) {
          await vscode.commands.executeCommand(
            action.command.command,
            ...(action.command.arguments || [])
          );
        }
      }
      return true;
    }

    return false;
  } catch (error) {
    console.error('Failed to execute organize imports:', error);
    return false;
  }
}

/**
 * Auto-import unresolved symbols using Rust Analyzer quick fixes
 * Only applies imports when there is exactly one suggestion (like goimports)
 */
export async function autoImportUnresolvedSymbols(
  document: vscode.TextDocument
): Promise<number> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) {
    return 0;
  }

  let importCount = 0;

  try {
    // Get diagnostics for the document
    const diagnostics = vscode.languages.getDiagnostics(document.uri);

    // Filter for unresolved import errors from rust-analyzer
    const unresolvedErrors = diagnostics.filter(d =>
      d.source === 'rust-analyzer' &&
      (d.message.includes('unresolved') ||
       d.message.includes('cannot find') ||
       d.message.includes('not found'))
    );

    for (const diagnostic of unresolvedErrors) {
      // Get code actions for this specific diagnostic
      const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        document.uri,
        diagnostic.range,
        vscode.CodeActionKind.QuickFix.value
      );

      if (!codeActions) {
        continue;
      }

      // Filter for import suggestions only
      const importActions = codeActions.filter(action =>
        action.title.startsWith('Import `') ||
        action.title.includes('use ')
      );

      // Only apply if there's exactly one import suggestion (unambiguous)
      if (importActions.length === 1) {
        const action = importActions[0];

        if (action.edit) {
          await vscode.workspace.applyEdit(action.edit);
          importCount++;
        }
        if (action.command) {
          await vscode.commands.executeCommand(
            action.command.command,
            ...(action.command.arguments || [])
          );
        }
      }
    }
  } catch (error) {
    console.error('Failed to auto-import symbols:', error);
  }

  return importCount;
}

/**
 * Wait for diagnostics to be updated after document changes
 */
export function waitForDiagnostics(
  document: vscode.TextDocument,
  timeoutMs: number = 2000
): Promise<void> {
  return new Promise((resolve) => {
    const disposable = vscode.languages.onDidChangeDiagnostics(e => {
      if (e.uris.some(uri => uri.toString() === document.uri.toString())) {
        disposable.dispose();
        // Give a small delay for rust-analyzer to finish processing
        setTimeout(resolve, 100);
      }
    });

    // Timeout fallback
    setTimeout(() => {
      disposable.dispose();
      resolve();
    }, timeoutMs);
  });
}
