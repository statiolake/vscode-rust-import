import * as vscode from 'vscode';

const OUTPUT_CHANNEL = vscode.window.createOutputChannel('Rust Import Organizer');

function log(message: string): void {
  OUTPUT_CHANNEL.appendLine(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Check if Rust Analyzer extension is installed and active
 */
export async function isRustAnalyzerAvailable(): Promise<boolean> {
  const rustAnalyzer = vscode.extensions.getExtension('rust-lang.rust-analyzer');
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
    log(`Failed to execute organize imports: ${error}`);
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
    log(`Found ${diagnostics.length} total diagnostics`);

    // Filter for unresolved import errors from rust-analyzer
    const unresolvedErrors = diagnostics.filter(d => {
      const isRustAnalyzer = d.source === 'rust-analyzer';
      const isUnresolved = d.message.includes('unresolved') ||
                           d.message.includes('cannot find') ||
                           d.message.includes('not found');
      return isRustAnalyzer && isUnresolved;
    });

    log(`Found ${unresolvedErrors.length} unresolved errors from rust-analyzer`);

    for (const diagnostic of unresolvedErrors) {
      log(`\nProcessing diagnostic: "${diagnostic.message}" at line ${diagnostic.range.start.line + 1}`);
      log(`  Source: ${diagnostic.source}, Code: ${JSON.stringify(diagnostic.code)}`);

      // Get code actions for this specific diagnostic
      const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        document.uri,
        diagnostic.range,
        vscode.CodeActionKind.QuickFix.value
      );

      if (!codeActions || codeActions.length === 0) {
        log(`  No code actions available`);
        continue;
      }

      log(`  Found ${codeActions.length} code actions:`);
      for (const action of codeActions) {
        log(`    - "${action.title}" (kind: ${action.kind?.value ?? 'undefined'})`);
      }

      // Filter for import suggestions only
      const importActions = codeActions.filter(action => {
        const title = action.title;
        const isImport = title.startsWith('Import `') ||
                         title.startsWith('Import ') ||
                         title.includes('use ');
        if (isImport) {
          log(`    [MATCH] "${title}"`);
        }
        return isImport;
      });

      log(`  Filtered to ${importActions.length} import actions`);

      // Only apply if there's exactly one import suggestion (unambiguous)
      if (importActions.length === 1) {
        const action = importActions[0];
        log(`  Applying: "${action.title}"`);

        if (action.edit) {
          const applied = await vscode.workspace.applyEdit(action.edit);
          if (applied) {
            importCount++;
            log(`  Successfully applied edit`);
          } else {
            log(`  Failed to apply edit`);
          }
        }
        if (action.command) {
          log(`  Executing command: ${action.command.command}`);
          await vscode.commands.executeCommand(
            action.command.command,
            ...(action.command.arguments || [])
          );
        }
      } else if (importActions.length > 1) {
        log(`  Skipping: multiple import options (ambiguous)`);
      } else {
        log(`  Skipping: no import actions matched`);
      }
    }
  } catch (error) {
    log(`Failed to auto-import symbols: ${error}`);
  }

  log(`\nTotal imports added: ${importCount}`);
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

/**
 * Show the output channel for debugging
 */
export function showOutputChannel(): void {
  OUTPUT_CHANNEL.show();
}
