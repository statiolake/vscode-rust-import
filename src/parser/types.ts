/**
 * Position in a document (0-indexed line and column)
 */
export interface Position {
  line: number;
  column: number;
}

/**
 * Range in a document (start inclusive, end exclusive)
 */
export interface Range {
  start: Position;
  end: Position;
}

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
  isGlob?: boolean; // For wildcard: *
  isSelf?: boolean; // For self keyword
}

/**
 * Represents a complete use statement with metadata.
 */
export interface UseStatement {
  visibility?: string; // pub, pub(crate), pub(super), etc.
  tree: UseTree;
  attributes?: string[]; // #[cfg(...)] etc.
  range: Range; // Exact range of the use statement (including visibility, excluding attributes)
  blockId?: number; // Block ID for grouping (imports separated by comments are in different blocks)
}

/**
 * Import category for grouping.
 * Order determines display order in the output.
 */
export enum ImportCategory {
  Std = 0, // std, core, alloc
  External = 1, // Third-party crates from Cargo.toml
  Internal = 2, // crate::, super::, self::
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
 * Flattened import representation.
 * Each FlatImport represents a single import path (e.g., std::io::Read).
 */
export interface FlatImport {
  /** Full path segments (e.g., ["std", "io", "Read"]) */
  path: string[];
  /** Alias if present (e.g., "R" for "as R", "_" for "as _") */
  alias?: string;
  /** True if this is a glob import (path ends with *) */
  isGlob?: boolean;
  /** True if this is a self import */
  isSelf?: boolean;
}

/**
 * Result of parsing a Rust file.
 */
export interface ParseResult {
  imports: UseStatement[];
  /** Range covering all imports (from first import start to last import end) */
  importsRange: Range | null;
  /** Whether there's a blank line after imports (or no code after imports) */
  hasBlankLineAfterImports: boolean;
}
