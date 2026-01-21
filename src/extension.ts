import * as vscode from 'vscode';
import { organizeImports } from './commands/organizeImports';
import { RustImportCodeActionProvider } from './providers/codeActionProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Rust Import Organizer is now active');

  // Register commands
  const organizeCmd = vscode.commands.registerCommand(
    'rust-import.organizeImports',
    organizeImports,
  );

  // Register Code Action Provider
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { language: 'rust', scheme: 'file' },
    new RustImportCodeActionProvider(),
    {
      providedCodeActionKinds:
        RustImportCodeActionProvider.providedCodeActionKinds,
    },
  );

  context.subscriptions.push(organizeCmd, codeActionProvider);
}

export function deactivate() {}
