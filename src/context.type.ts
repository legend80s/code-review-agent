import type { usize } from "./type.js"

/** Token budget configuration for the review session. */
export type ContextBudget = {
  /** Maximum total tokens across all files. */
  maxTotalTokens: usize
  /** Maximum tokens for a single file's diff content. */
  maxFileTokens: usize
  /** Tokens consumed so far. */
  usedTokens: usize
}

/// A single file's diff content.
// #[derive(Debug, Clone)]
export type IFileChange = {
  /// File path (relative).
  path: string
  /// The raw unified diff text for this file.
  diff: string
  /// Estimated token count for the diff content.
  estimated_tokens: usize
}
