import * as vscode from 'vscode';

/**
 * Code Action Provider for Rust import organization
 * Provides source.organizeImports action that can be triggered by VS Code's
 * "Organize Imports" command or configured to run on save.
 * Also provides QuickFix when import-related diagnostics exist.
 */
export class RustImportCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.SourceOrganizeImports,
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    if (document.languageId !== 'rust') {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    // Organize Imports action (source.organizeImports)
    const organizeAction = new vscode.CodeAction(
      'Rust Import Organizer: Organize Imports',
      vscode.CodeActionKind.SourceOrganizeImports,
    );
    organizeAction.command = {
      command: 'rust-import.organizeImports',
      title: 'Rust Import Organizer: Organize Imports',
    };
    actions.push(organizeAction);

    // QuickFix: Show when there are import-related diagnostics
    const hasImportDiagnostics = context.diagnostics.some(
      (d) =>
        (d.source === 'rustc' || d.source === 'rust-analyzer') &&
        (d.message.includes('unused import') ||
          d.message.includes('unresolved import') ||
          d.message.includes('cannot find') ||
          d.message.includes('not found in')),
    );

    if (hasImportDiagnostics) {
      const quickFixAction = new vscode.CodeAction(
        'Organize imports',
        vscode.CodeActionKind.QuickFix,
      );
      quickFixAction.command = {
        command: 'rust-import.organizeImports',
        title: 'Organize imports',
      };
      quickFixAction.isPreferred = false;
      actions.push(quickFixAction);
    }

    return actions;
  }
}
