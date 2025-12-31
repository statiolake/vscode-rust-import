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

### Command Palette

1. Open a Rust file
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run "Organize Rust Imports"

### Keyboard Shortcut

- `Shift+Alt+O` (when editing a Rust file)

### Context Menu

Right-click in a Rust file and select "Organize Rust Imports"

## Requirements

- The extension automatically detects `Cargo.toml` to identify third-party dependencies
- Works with any Rust project structure

## Known Limitations

- Does not currently support format-on-save (run manually or use keybinding)
- Macro-based imports are not processed
- Comments between imports may be repositioned

## Release Notes

### 0.0.1

Initial release:
- Basic import sorting and grouping
- Import merging with nested braces
- Multi-line formatting
- Cargo.toml dependency detection
