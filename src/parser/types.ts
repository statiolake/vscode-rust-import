/**
 * Represents a single path segment in a use statement.
 * Example: In `use std::io::Read as R;`, segments are "std", "io", "Read" (with alias "R")
 */
export interface UsePathSegment {
  name: string;
  alias?: string;
}

/**
 * Represents a use tree node (can have children for nested imports).
 * Example: `use std::{io, fs}` has a root segment "std" with children "io" and "fs"
 */
export interface UseTree {
  segment: UsePathSegment;
  children?: UseTree[];
  isGlob?: boolean;  // For wildcard: *
  isSelf?: boolean;  // For self keyword
}

/**
 * Represents a complete use statement with metadata.
 */
export interface UseStatement {
  visibility?: string;  // pub, pub(crate), pub(super), etc.
  tree: UseTree;
  attributes?: string[];  // #[cfg(...)] etc.
  startLine: number;
  startCol?: number;  // Column where the use statement starts (if not start of line)
  endLine: number;
  endCol?: number;  // Column where the use statement ends (after semicolon)
}

/**
 * Import category for grouping.
 * Order determines display order in the output.
 */
export enum ImportCategory {
  Std = 0,        // std, core, alloc
  External = 1,   // Third-party crates from Cargo.toml
  Internal = 2,   // crate::, super::, self::
  Attributed = 3, // Imports with attributes like #[cfg(test)]
}

/**
 * Grouped imports for output.
 */
export interface GroupedImports {
  category: ImportCategory;
  imports: UseStatement[];
}

/**
 * Cargo.toml dependency info.
 */
export interface CargoDependencies {
  dependencies: Set<string>;
  devDependencies: Set<string>;
  buildDependencies: Set<string>;
}

/**
 * Result of parsing a Rust file.
 */
export interface ParseResult {
  imports: UseStatement[];
  beforeImports: string;  // Content before the first import
  afterImports: string;   // Content after the last import
  importStartLine: number;
  importStartCol?: number;  // Column where the first import starts (if not start of line)
  importEndLine: number;
  lastImportEndCol?: number;  // Column where the last import ends (if not end of line)
  hasBlankLineAfterImports: boolean;  // Whether there's a blank line after imports
}
