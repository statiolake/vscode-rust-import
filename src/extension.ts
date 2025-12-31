import * as vscode from 'vscode';
import { organizeImports } from './commands/organizeImports';

export function activate(context: vscode.ExtensionContext) {
  console.log('Rust Import Organizer is now active');

  const organizeCmd = vscode.commands.registerCommand(
    'rust-import.organizeImports',
    organizeImports
  );

  context.subscriptions.push(organizeCmd);
}

export function deactivate() {}
