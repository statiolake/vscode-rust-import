# Rust Import Organizer

A VS Code extension that organizes Rust `use` statements by sorting, grouping, and merging them.

## Features

- **Sort** imports alphabetically
- **Group** imports by category:
  1. Standard library (`std`, `core`, `alloc`)
  2. External crates (from `Cargo.toml` dependencies)
  3. Internal modules (`crate::`, `super::`, `self::`)
  4. Conditional imports (with `#[cfg(...)]` attributes)
- **Merge** imports with common prefixes into nested format
- **Multi-line formatting** for merged imports (compatible with rustfmt)
- **Auto-import** unresolved symbols via Rust Analyzer (when there's exactly one suggestion)
- **Code Actions** for VS Code's organize imports on save

### Before

```rust
use serde::{Deserialize, Serialize};
use std::io::Read;
use crate::utils::helper;
use std::collections::HashMap;
use tokio::sync::mpsc;
use super::parent_module;
use std::io::Write;
#[cfg(test)]
use crate::test_helpers;
```

### After

```rust
use std::{
    collections::HashMap,
    io::{
        Read,
        Write,
    },
};

use serde::{
    Deserialize,
    Serialize,
};
use tokio::sync::mpsc;

use super::parent_module;
use crate::utils::helper;

#[cfg(test)]
use crate::test_helpers;
```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| Organize Rust Imports | Sort, group, and merge imports |
| Auto Import (Rust) | Auto-import unresolved symbols via Rust Analyzer |

### Command Palette

1. Open a Rust file
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run "Organize Rust Imports" or "Auto Import (Rust)"

### Context Menu

Right-click in a Rust file to access both commands

### Code Actions

This extension provides Code Actions that integrate with VS Code's built-in features:

- **source.organizeImports** - Organize Rust Imports
- **source.autoImport** - Auto Import (Rust)

#### Organize Imports on Save

Add to your `settings.json`:

```json
{
  "editor.codeActionsOnSave": {
    "source.organizeImports": "explicit"
  }
}
```

Or for Rust files only:

```json
{
  "[rust]": {
    "editor.codeActionsOnSave": {
      "source.organizeImports": "explicit"
    }
  }
}
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `rustImportOrganizer.enableAutoImport` | `true` | Enable auto-import of unresolved symbols when organizing imports |
| `rustImportOrganizer.enableGroupImports` | `true` | Enable sorting and grouping of imports when organizing imports |
| `rustImportOrganizer.enableRemoveUnusedImports` | `true` | Enable removal of unused imports when organizing imports |

Example configuration in `settings.json`:

```json
{
  "rustImportOrganizer.enableAutoImport": true,
  "rustImportOrganizer.enableGroupImports": true
}
```

To disable auto-import and only use grouping/sorting:

```json
{
  "rustImportOrganizer.enableAutoImport": false
}
```

#### Keyboard Shortcuts

You can assign custom keyboard shortcuts in VS Code:

1. Open Keyboard Shortcuts (`Cmd+K Cmd+S` / `Ctrl+K Ctrl+S`)
2. Search for "Organize Rust Imports" or "Auto Import (Rust)"
3. Assign your preferred keybinding

## Auto-Import Feature

The "Auto Import (Rust)" command:

1. Detects unresolved symbols in your code
2. Automatically adds imports when there's exactly one unambiguous suggestion
3. Shows a message with the number of imports added

**Requirements:**
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) extension must be installed
- Only applies imports when there's a single suggestion (avoids ambiguity)

## Requirements

- The extension automatically detects `Cargo.toml` to identify third-party dependencies
- Works with any Rust project structure
- For auto-import: Rust Analyzer extension

## Known Limitations

- Macro-based imports are not processed
- Comments between imports may be repositioned
- Auto-import only works when Rust Analyzer provides exactly one suggestion

## Release Notes

### 0.0.1

Initial release:
- Import sorting and grouping
- Import merging with nested braces
- Multi-line formatting
- Cargo.toml dependency detection
- Rust Analyzer integration for auto-import
- Code Action provider for organize imports on save
