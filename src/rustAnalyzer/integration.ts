import * as vscode from 'vscode';
import { parseRustFile, flattenUseTree } from '../parser/useParser';
import type { UseTree } from '../parser/types';

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

export interface AutoImportResult {
  edits: Array<{ position: vscode.Position; text: string }>;
  count: number;
}

/**
 * Collect auto-import edits for unresolved symbols using Rust Analyzer quick fixes
 * Only adds imports when there is exactly one suggestion (like goimports)
 * Returns edits to be applied later (does not apply them)
 */
export async function collectAutoImportEdits(
  document: vscode.TextDocument,
): Promise<AutoImportResult> {
  log(`\n=== collectAutoImportEdits started ===`);
  log(`Document: ${document.uri.fsPath}`);

  const result: AutoImportResult = { edits: [], count: 0 };

  // Collect all import suggestions: Map from symbol name to set of possible paths
  const symbolToImports = new Map<string, Set<string>>();

  try {
    // Get all diagnostics for the document
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    log(`Found ${diagnostics.length} total diagnostics`);

    // Process each diagnostic to collect import suggestions
    for (const diagnostic of diagnostics) {
      // Get code actions for this diagnostic
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

    // Create edits for all collected imports
    if (importsToAdd.size > 0) {
      log(`\nPreparing ${importsToAdd.size} imports...`);

      // Find the right position to insert imports
      // Must be after: #![...], //!, extern crate
      const text = document.getText();
      const lines = text.split('\n');
      let insertLine = 0;
      let needsBlankLine = false;

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
        } else if (line.startsWith('use ') || line.startsWith('mod ')) {
          // Found existing use/mod, insert here
          insertLine = i;
          break;
        } else if (line.length > 0 && !line.startsWith('#[')) {
          // Found other code (not use/mod), need blank line after imports
          needsBlankLine = true;
          break;
        }
      }

      const importStatements =
        Array.from(importsToAdd)
          .map((path) => `use ${path};`)
          .join('\n') +
        '\n' +
        (needsBlankLine ? '\n' : '');

      log(`  Will insert at line ${insertLine}`);
      result.edits.push({
        position: new vscode.Position(insertLine, 0),
        text: importStatements,
      });
      result.count = importsToAdd.size;
    } else {
      log(`\nNo unambiguous imports to add`);
    }
  } catch (error) {
    log(`Failed to collect auto-import edits: ${error}`);
  }

  return result;
}

/**
 * Auto-import unresolved symbols (legacy function that applies edits immediately)
 */
export async function autoImportUnresolvedSymbols(
  document: vscode.TextDocument,
): Promise<number> {
  const result = await collectAutoImportEdits(document);

  if (result.edits.length > 0) {
    const edit = new vscode.WorkspaceEdit();
    for (const e of result.edits) {
      edit.insert(document.uri, e.position, e.text);
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      log(`Successfully added ${result.count} imports`);
      return result.count;
    } else {
      log(`Failed to apply imports`);
      return 0;
    }
  }

  return 0;
}

/**
 * Extract unused symbol name from diagnostic message
 * e.g., "unused import: `Duration`" -> "Duration"
 */
function extractUnusedSymbol(message: string): string | null {
  // Match patterns like "unused import: `Symbol`" or "unused import: `path::Symbol`"
  const match = message.match(/unused import:?\s*`([^`]+)`/i);
  if (match) {
    const path = match[1];
    // Return just the symbol name (last segment)
    return path.split('::').pop() || null;
  }
  return null;
}

/**
 * Filter a UseTree to remove unused symbols
 * Returns null if the entire tree should be removed
 */
function filterUseTree(
  tree: UseTree,
  unusedSymbols: Set<string>,
): UseTree | null {
  // Get the symbol name (last segment or alias)
  const symbolName = tree.segment.alias || tree.segment.name;

  // Leaf node (no children)
  if (!tree.children || tree.children.length === 0) {
    // Check if this symbol is unused
    if (unusedSymbols.has(symbolName)) {
      return null; // Remove this node
    }
    return tree; // Keep this node
  }

  // Has children - filter them recursively
  const filteredChildren: UseTree[] = [];
  for (const child of tree.children) {
    const filtered = filterUseTree(child, unusedSymbols);
    if (filtered) {
      filteredChildren.push(filtered);
    }
  }

  // If no children remain, check if we should keep this as a leaf
  if (filteredChildren.length === 0) {
    // If this was a self import, check if self is unused
    if (tree.isSelf && unusedSymbols.has('self')) {
      return null;
    }
    // Otherwise, the entire subtree was unused
    return null;
  }

  // Return tree with filtered children
  return {
    ...tree,
    children: filteredChildren,
  };
}

/**
 * Format a UseTree back to a string
 */
function formatUseTree(tree: UseTree): string {
  const segment = tree.segment.alias
    ? `${tree.segment.name} as ${tree.segment.alias}`
    : tree.segment.name;

  if (tree.isGlob) {
    return '*';
  }

  if (tree.isSelf) {
    return segment;
  }

  if (!tree.children || tree.children.length === 0) {
    return segment;
  }

  if (tree.children.length === 1 && !tree.children[0].isSelf) {
    // Single child, can be flattened (unless it's self)
    return `${segment}::${formatUseTree(tree.children[0])}`;
  }

  // Multiple children or self - use braces
  const childrenStr = tree.children.map((c) => formatUseTree(c)).join(', ');
  return `${segment}::{${childrenStr}}`;
}

export interface RemoveUnusedResult {
  edits: Array<{ range: vscode.Range; text: string | null }>; // null means delete
  count: number;
}

/**
 * Collect edits to remove unused imports based on diagnostics
 * Returns edits to be applied later (does not apply them)
 */
export function collectRemoveUnusedEdits(
  document: vscode.TextDocument,
): RemoveUnusedResult {
  log(`\n=== collectRemoveUnusedEdits started ===`);
  log(`Document: ${document.uri.fsPath}`);

  const result: RemoveUnusedResult = { edits: [], count: 0 };

  try {
    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    log(`Found ${diagnostics.length} total diagnostics`);

    // Find unused import diagnostics and extract symbol names
    const unusedSymbols = new Set<string>();

    for (const d of diagnostics) {
      const isRustSource = d.source === 'rust-analyzer' || d.source === 'rustc';
      const isUnusedImport =
        d.message.includes('unused import') ||
        d.message.includes('unused_imports');

      if (isRustSource && isUnusedImport) {
        const symbol = extractUnusedSymbol(d.message);
        if (symbol) {
          log(`  Found unused symbol: ${symbol}`);
          unusedSymbols.add(symbol);
        }
      }
    }

    log(`Found ${unusedSymbols.size} unused symbols`);

    if (unusedSymbols.size === 0) {
      return result;
    }

    // Parse the document to find use statements
    const text = document.getText();
    const parseResult = parseRustFile(text);

    if (parseResult.imports.length === 0) {
      return result;
    }

    // Process each import statement
    for (const stmt of parseResult.imports) {
      // Flatten to get all symbol names in this import
      const paths = flattenUseTree(stmt.tree);
      const symbolsInImport = paths.map((p) => p[p.length - 1]);

      // Check which symbols are unused
      const unusedInThisImport = symbolsInImport.filter((s) =>
        unusedSymbols.has(s),
      );

      if (unusedInThisImport.length === 0) {
        continue; // No unused symbols in this import
      }

      log(
        `\nProcessing import at lines ${stmt.range.start.line + 1}-${stmt.range.end.line + 1}`,
      );
      log(`  Symbols: ${symbolsInImport.join(', ')}`);
      log(`  Unused: ${unusedInThisImport.join(', ')}`);

      // Filter the tree to remove unused symbols
      const filteredTree = filterUseTree(stmt.tree, unusedSymbols);

      // Use precise start/end positions from the statement's range
      const startLine = stmt.range.start.line;
      const endLine = stmt.range.end.line;
      const startCol = stmt.range.start.column;
      const endCol = stmt.range.end.column;

      // Check if there's code before/after the import on the same line
      const hasCodeBefore = startCol > 0;
      const hasCodeAfter = endCol < document.lineAt(endLine).text.length;

      if (!filteredTree) {
        // Entire import is unused - delete it
        log(`  Will delete entire import`);

        let range: vscode.Range;
        if (hasCodeBefore || hasCodeAfter) {
          // Use statement is part of a line with other code - delete just the use statement
          range = new vscode.Range(
            new vscode.Position(startLine, startCol),
            new vscode.Position(endLine, endCol),
          );
          result.edits.push({ range, text: '' });
        } else {
          // Use statement occupies full lines - delete entire lines including attributes
          range = new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine + 1, 0),
          );
          result.edits.push({ range, text: null });
        }
        result.count += unusedInThisImport.length;
      } else {
        // Some symbols remain - reformat the import
        const visibility = stmt.visibility ? `${stmt.visibility} ` : '';
        const attributes =
          stmt.attributes && stmt.attributes.length > 0
            ? stmt.attributes.join('\n') + '\n'
            : '';
        const newImport = `${visibility}use ${formatUseTree(filteredTree)};`;

        let range: vscode.Range;
        let replacement: string;
        if (hasCodeBefore || hasCodeAfter) {
          // Use statement is part of a line - replace just the use statement portion
          range = new vscode.Range(
            new vscode.Position(startLine, startCol),
            new vscode.Position(endLine, endCol),
          );
          replacement = newImport;
        } else {
          // Use statement occupies full lines
          range = new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine + 1, 0),
          );
          replacement = `${attributes}${newImport}\n`;
        }

        log(`  Will replace with: ${newImport}`);
        result.edits.push({ range, text: replacement });
        result.count += unusedInThisImport.length;
      }
    }

    log(`\nTotal unused imports to remove: ${result.count}`);
  } catch (error) {
    log(`Failed to collect remove unused edits: ${error}`);
  }

  return result;
}

/**
 * Remove unused imports (legacy function that applies edits immediately)
 */
export async function removeUnusedImports(
  document: vscode.TextDocument,
): Promise<number> {
  const result = collectRemoveUnusedEdits(document);

  if (result.edits.length > 0) {
    const edit = new vscode.WorkspaceEdit();
    for (const e of result.edits) {
      if (e.text === null) {
        edit.delete(document.uri, e.range);
      } else {
        edit.replace(document.uri, e.range, e.text);
      }
    }
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      log(`Successfully removed ${result.count} unused imports`);
      return result.count;
    } else {
      log(`Failed to apply edit`);
      return 0;
    }
  }

  return 0;
}
