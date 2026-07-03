// examples/code-review-agent/src/context.rs:12-45
// 更接近 Rust 风格（纯数据对象）

/** @import { usize } from './type.js' */
/** @import { DiffContext, FileChange } from './context.type.js' */

export class ContextBudget {
  /**
   *
   * @param {usize} maxTotalTokens
   * @param {usize} maxFileTokens
   * @param {usize} usedTokens
   */
  constructor(maxTotalTokens, maxFileTokens, usedTokens = 0) {
    this.maxTotalTokens = maxTotalTokens
    this.maxFileTokens = maxFileTokens
    this.usedTokens = usedTokens
  }

  /**
   * @returns {usize}
   */
  remaining() {
    return Math.max(0, this.maxTotalTokens - this.usedTokens)
  }

  /**
   *
   * @param {usize} tokens
   * @returns {boolean}
   */
  tryConsume(tokens) {
    if (this.usedTokens + tokens <= this.maxTotalTokens) {
      this.usedTokens += tokens
      return true
    }
    return false
  }
}

/**
 * Apply budget constraints to a diff context: truncate or skip files as needed.
 *
 * @param {DiffContext} diff
 * @param {ContextBudget} budget
 * @returns {[DiffContext, usize]} Returns `(budget_constrained_context, files_skipped_count)`.
 */
export function applyBudget(diff, budget) {
  const files = []
  let skipped = 0

  for (const file of diff.files) {
    if (budget.remaining() === 0) {
      console.warn(
        "file =",
        file.path,
        "Skipping file — total token budget exhausted",
      )
      skipped++
      continue
    }

    // Reserve ~20 tokens for the truncation metadata annotation so it
    // doesn't eat into the content budget.
    const metadata_overhead = 20
    const effective_max = saturatingSub(
      Math.min(budget.maxFileTokens, budget.remaining()),
      metadata_overhead,
    )

    const [content, was_truncated] = truncate_file_content(
      file.diff,
      effective_max,
    )

    if (was_truncated) {
      console.debug("Truncated file diff", {
        file: file.path,
        originalTokens: file.estimated_tokens,
        truncatedTo: effective_max,
      })
    }

    const tokens = estimate_tokens(content)

    if (!budget.tryConsume(tokens)) {
      console.warn(
        "file =",
        file.path,
        "Skipping file — would exceed total token budget",
      )
      skipped++
      continue
    }

    files.push(
      /** @type {FileChange} */ ({
        path: file.path,
        diff: content,
        estimated_tokens: tokens,
      }),
    )
  }

  return [{ files }, skipped]
}

/**
 * Truncate file content to fit within a token budget.
 * @param {string} content
 * @param {usize} max_tokens
 * @returns {[string, boolean]} Returns `(truncated_content, was_truncated)`. If truncated, a metadata annotation is appended indicating how much was cut.
 */
function truncate_file_content(content, max_tokens) {
  const estimated = estimate_tokens(content)
  if (estimated <= max_tokens) {
    return [content, false]
  }

  // Approximate character budget from token budget
  const char_budget = max_tokens * 4

  // let truncated = String::with_capacity(char_budget + 100);
  /** @type {string[]} */
  const truncated = []
  let chars_used = 0
  let lines_shown = 0
  let total_lines = 0
  let truncation_point_reached = false

  for (const line of content.split("\n")) {
    total_lines++
    if (!truncation_point_reached) {
      const line_len = line.length + 1 // +1 for newline

      if (chars_used + line_len > char_budget) {
        truncation_point_reached = true
      } else {
        truncated.push(line)
        truncated.push("\n")

        chars_used += line_len
        lines_shown += 1
      }
    }
  }

  truncated.push(
    `\n[Truncated: full file has ${total_lines} lines, showing first ${lines_shown}]`,
  )

  return [truncated.join(""), truncation_point_reached]
}

/// Estimate token count from text using a conservative bytes/4 heuristic.
///
/// Uses byte length (`str::len()`), not character count. For ASCII-heavy code
/// this approximates chars/4. For multi-byte UTF-8 content (e.g., CJK), this
/// overestimates, which is intentionally conservative.
/**
 * @param {string} text
 * @returns {usize}
 */
function estimate_tokens(text) {
  return (text.length + 3) / 4
}

/**
 * Performs saturating subtraction (a - b) with a minimum of 0.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function saturatingSub(a, b) {
  return Math.max(0, a - b)
}
