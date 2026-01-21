import * as vscode from 'vscode';

/**
 * Code Action Provider for Rust import organization
 * Provides source.organizeImports action that can be triggered by VS Code's
 * "Organize Imports" command or configured to run on save
 */
export class RustImportCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.SourceOrganizeImports,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    _context: vscode.CodeActionContext,
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

    return actions;
  }
}
