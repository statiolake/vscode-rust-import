import * as vscode from 'vscode';
import { organizeImports, organizeImportsWithAutoImport } from './commands/organizeImports';

export function activate(context: vscode.ExtensionContext) {
  console.log('Rust Import Organizer is now active');

  // Basic organize imports command
  const organizeCmd = vscode.commands.registerCommand(
    'rust-import.organizeImports',
    organizeImports
  );

  // Organize imports with auto-import (goimports-like)
  const organizeWithAutoImportCmd = vscode.commands.registerCommand(
    'rust-import.organizeImportsWithAutoImport',
    organizeImportsWithAutoImport
  );

  context.subscriptions.push(organizeCmd, organizeWithAutoImportCmd);
}

export function deactivate() {}
