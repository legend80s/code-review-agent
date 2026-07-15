import type { Severity } from "./review.mjs"
import type { f64, Option, u32, u64, usize, Vec } from "./type.js"

export type IAgentAction =
  | { action: "done" }
  | { action: "review_related"; file: string; reason: string }
  | { action: "use_tool"; tool: string; input: string; reason: string }

/// Aggregate review report.
export type IReviewReport = {
  /// Number of files that were reviewed.
  files_reviewed: usize
  /// Number of files skipped due to budget constraints.
  files_skipped: usize
  /// Total tokens consumed (from the result message, if available).
  total_tokens_used: u64
  /// Wall-clock duration of the review in milliseconds.
  duration_ms: u64
  /// All findings extracted from the model's response.
  findings: Vec<IFinding>
  /// Estimated cost in USD (from the SDK result message, if available).
  cost_usd: f64 | null
}

export type IFinding = Readonly<{
  /// File path the finding applies to.
  file: string
  /// Line number (if applicable).
  line: Option<u32>
  /// Severity level.
  severity: ISeverity
  /// Category (e.g., "bug", "security", "performance", "maintainability", "style").
  category: string
  /// Human-readable description of the issue.
  message: string
  /// Optional concrete suggestion for a fix.
  suggestion: Option<string>
}>

/// Severity level for a finding.
///
/// Accepts both title-case ("Critical") and lowercase ("critical") from LLM output.
// #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
export type ISeverity = (typeof Severity)[keyof typeof Severity]
