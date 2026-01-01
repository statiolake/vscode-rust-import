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

/**
 * Auto-import unresolved symbols using Rust Analyzer quick fixes
 * Only applies imports when there is exactly one suggestion (like goimports)
 */
export async function autoImportUnresolvedSymbols(
  document: vscode.TextDocument
): Promise<number> {
  log(`\n=== autoImportUnresolvedSymbols started ===`);
  log(`Document: ${document.uri.fsPath}`);

  // Collect all import suggestions: Map from symbol name to set of possible paths
  const symbolToImports = new Map<string, Set<string>>();

  try {
    // Get all diagnostics for the document
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    log(`Found ${diagnostics.length} total diagnostics`);

    // Process each diagnostic to collect import suggestions
    for (const diagnostic of diagnostics) {
      // Get code actions for this diagnostic
      const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        document.uri,
        diagnostic.range,
        vscode.CodeActionKind.QuickFix.value
      );

      if (!codeActions || codeActions.length === 0) {
        continue;
      }

      // Extract import paths from code action titles
      for (const action of codeActions) {
        const path = extractImportPath(action.title);
        if (path) {
          // Extract symbol name from path (last segment)
          const symbolName = path.split('::').pop()!;

          if (!symbolToImports.has(symbolName)) {
            symbolToImports.set(symbolName, new Set());
          }
          symbolToImports.get(symbolName)!.add(path);

          log(`  Found: ${symbolName} -> ${path}`);
        }
      }
    }

    // Collect only unambiguous imports (symbols with exactly one import path)
    const importsToAdd = new Set<string>();
    for (const [symbolName, paths] of symbolToImports) {
      if (paths.size === 1) {
        const path = Array.from(paths)[0];
        log(`Will add: use ${path}; (unambiguous)`);
        importsToAdd.add(path);
      } else {
        log(`Skipping ${symbolName}: ${paths.size} options (ambiguous)`);
      }
    }

    // Apply all collected imports at once
    if (importsToAdd.size > 0) {
      log(`\nApplying ${importsToAdd.size} imports...`);

      const edit = new vscode.WorkspaceEdit();
      const importStatements = Array.from(importsToAdd)
        .map(path => `use ${path};`)
        .join('\n') + '\n';

      // Find the right position to insert imports
      // Must be after: #![...], //!, extern crate
      const text = document.getText();
      const lines = text.split('\n');
      let insertLine = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (
          line.startsWith('#![') ||      // inner attribute
          line.startsWith('//!') ||       // module doc comment
          line.startsWith('extern crate') // extern crate
        ) {
          insertLine = i + 1;
        } else if (line === '' || line.startsWith('//')) {
          // Skip empty lines and regular comments at the top
          if (insertLine === i) {
            insertLine = i + 1;
          }
        } else if (line.startsWith('use ') || line.startsWith('mod ')) {
          // Found existing use/mod, insert here
          insertLine = i;
          break;
        } else if (line.length > 0 && !line.startsWith('#[')) {
          // Found other code, insert before it
          break;
        }
      }

      log(`  Inserting at line ${insertLine}`);
      edit.insert(document.uri, new vscode.Position(insertLine, 0), importStatements);

      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        log(`Successfully added ${importsToAdd.size} imports`);
        return importsToAdd.size;
      } else {
        log(`Failed to apply imports`);
      }
    } else {
      log(`\nNo unambiguous imports to add`);
    }
  } catch (error) {
    log(`Failed to auto-import symbols: ${error}`);
  }

  return 0;
}
