import * as vscode from 'vscode';
import { organizeImports } from './commands/organizeImports';
import { autoImport } from './commands/autoImport';
import { RustImportCodeActionProvider } from './providers/codeActionProvider';

export function activate(context: vscode.ExtensionContext) {
  console.log('Rust Import Organizer is now active');

  // Register commands
  const organizeCmd = vscode.commands.registerCommand(
    'rust-import.organizeImports',
    organizeImports
  );

  const autoImportCmd = vscode.commands.registerCommand(
    'rust-import.autoImport',
    autoImport
  );

  // Register Code Action Provider
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    { language: 'rust', scheme: 'file' },
    new RustImportCodeActionProvider(),
    {
      providedCodeActionKinds: RustImportCodeActionProvider.providedCodeActionKinds,
    }
  );

  context.subscriptions.push(organizeCmd, autoImportCmd, codeActionProvider);
}

export function deactivate() {}
