# Rust Import Organizer

A VS Code extension that organizes Rust `use` statements by sorting, grouping, and merging them. Similar to `goimports` for Go.

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

| Command | Description | Keybinding |
|---------|-------------|------------|
| Organize Rust Imports | Sort, group, and merge imports | `Shift+Alt+O` |
| Organize Rust Imports (with Auto-Import) | Auto-import + organize (like goimports) | `Shift+Alt+I` |

### Command Palette

1. Open a Rust file
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run "Organize Rust Imports" or "Organize Rust Imports (with Auto-Import)"

### Context Menu

Right-click in a Rust file to access both commands

## Auto-Import Feature

The "Organize Rust Imports (with Auto-Import)" command works like `goimports`:

1. Detects unresolved symbols in your code
2. Automatically adds imports when there's exactly one unambiguous suggestion
3. Then organizes all imports

**Requirements for auto-import:**
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) extension must be installed
- Only applies imports when there's a single suggestion (avoids ambiguity)

## Requirements

- The extension automatically detects `Cargo.toml` to identify third-party dependencies
- Works with any Rust project structure
- For auto-import: Rust Analyzer extension

## Known Limitations

- Does not currently support format-on-save (run manually or use keybinding)
- Macro-based imports are not processed
- Comments between imports may be repositioned
- Auto-import only works when Rust Analyzer provides exactly one suggestion

## Release Notes

### 0.0.1

Initial release:
- Basic import sorting and grouping
- Import merging with nested braces
- Multi-line formatting
- Cargo.toml dependency detection
- Rust Analyzer integration for auto-import
