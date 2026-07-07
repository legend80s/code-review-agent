/** @import { HashMap, Path, usize, Vec } from './type.js' */
/** @import { IFinding, IReviewReport, ISeverity } from './review.type.js' */
/** @import { IReviewConfig } from './agent.type.js' */
/** @import { IFileChange } from './context.type.js' */
/** @import { RetryConfig } from './resilience.type.js' */
/** @import { ITokenUsage, LlmBackend } from './llm.type.js' */

import { applyBudget, ContextBudget, load_diff } from "./context.mjs"
import { TokenUsage } from "./llm.mjs"
import { build_system_prompt, PrInfo } from "./prompts.mjs"
import { CircuitBreaker } from "./resilience.mjs"
import { Severity } from "./review.mjs"
import { ToolConfig } from "./tools.mjs"
import { info, warn } from "./utils/rust-patterns/logger.mjs"
import { Ok, Result, tryCatch } from "./utils/rust-patterns/result.mjs"

class ReviewReport {
  /**
   * Number of files that were reviewed.
   * @type {usize}
   */
  files_reviewed = 0
  /**
   * All findings extracted from the model's response.
   * @type {IFinding[]}
   */
  findings = []

  /**
   * Wall-clock duration of the review in milliseconds.
   */
  duration_ms = 0
  /**
   *
   * @param {IReviewReport} parameters
   */
  constructor(parameters) {
    Object.assign(this, parameters)
  }

  to_markdown() {
    return `Files reviewed: ${this.files_reviewed}\nFindings: ${this.findings.length}\nDuration: ${this.duration_ms}ms`
  }

  to_json() {
    return tryCatch(() => JSON.stringify(this))
  }

  /**
   * Summary counts for display.
   * @returns {string}
   */
  summary_line() {
    const critical = this.findings.filter(
      (f) => f.severity === Severity.Critical,
    ).length

    const warnings = this.findings.filter(
      (f) => f.severity === Severity.Warning,
    ).length

    const info = this.findings.filter(
      (f) => f.severity === Severity.Info,
    ).length

    const time = (this.duration_ms / 1000.0).toFixed(1)

    return `${this.findings.length} findings (${critical} critical, ${warnings} warnings, ${info} info) across ${this.files_reviewed} files in ${time}s`
  }
}

// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export class ReviewConfig {
  /**
   *
   * @returns {IReviewConfig}
   */
  static default() {
    return {
      max_tokens: 50_000,
      max_file_tokens: 5_000,
      max_related_depth: 1,
      max_tool_calls: 3,

      retry_config: {
        max_retries: 2,
        base_delay_ms: 2000,
      },
      circuit_breaker_threshold: 3,
      tool_config: ToolConfig.default(),
    }
  }
}

/// Run a complete code review.
///
/// This is the shared Agent Loop used by both CLI and MCP modes.
/**
 *
 * @param {Path} diff_path
 * @param {IReviewConfig} config
 * @param {import('./llm.type.js').LlmBackend} llm
 * @returns {Promise<Result<ReviewReport>>}
 */
export async function run_review(diff_path, config, llm) {
  // Step 1: Load diff
  const diff_context = load_diff(diff_path)
    .context("Failed to load diff")
    .unwrap()
  info("Loaded diff:", { files: diff_context.files.length })

  // Step 2: Apply budget
  const budget = new ContextBudget(config.max_tokens, config.max_file_tokens)
  const [constrained_diff, files_skipped] = applyBudget(diff_context, budget)

  const files_to_review = constrained_diff.files.length
  info("Budget applied:", {
    files_to_review,
    files_skipped,
    tokens_used: budget.usedTokens,
  })

  // Step 3: Build system prompt (shared across all file reviews)
  const pr_info = PrInfo.from_diff_context(constrained_diff)
  const system_prompt = build_system_prompt(pr_info)

  // Step 4: Agent Loop — review each file with optional follow-up
  const start = Date.now()
  const circuit_breaker = CircuitBreaker.new(config.circuit_breaker_threshold)

  /** @type {IFinding[]} */
  let all_findings = []
  /** @type {usize} */
  let files_reviewed = 0
  /** @type {usize} */
  let files_failed = 0
  const total_usage = TokenUsage.default()

  // Build index for cross-file lookups
  /**
   * @type {Map<string, IFileChange>}
   */
  const file_index = new Map(constrained_diff.files.map((f) => [f.path, f]))

  const sp = system_prompt

  for (const file of constrained_diff.files) {
    if (!circuit_breaker.check()) {
      warn("Circuit breaker OPEN — skipping remaining files:", {
        file: file.path,
      })
      break
    }

    info("Reviewing file:", { file: file.path, tokens: file.estimated_tokens })

    const result = await review_file_with_followup(
      file,
      file_index,
      sp,
      llm,
      config.retry_config,
      config.max_related_depth,
      config.max_tool_calls,
      config.tool_config,
      total_usage,
    )

    switch (result.isOk) {
      case true: {
        const findings = result.unwrap()
        circuit_breaker.record_success()
        info("File review complete:", {
          file: file.path,
          findings: findings.length,
        })
        all_findings = all_findings.concat(findings)
        files_reviewed += 1
        break
      }
      case false: {
        const e = result.error
        warn("File review failed:", { file: file.path, error: e })
        circuit_breaker.record_failure()
        files_failed += 1
      }
    }
  }

  const duration_ms = Date.now() - start

  return Ok(
    /** @type {ReviewReport} */ ({
      files_reviewed,
      files_skipped: files_skipped + files_failed,
      total_tokens_used: total_usage.total(),
      duration_ms,
      findings: all_findings,
      cost_usd: null,
    }),
  )
}

/// Review a single file, with optional follow-up on related files and tool use.
///
/// Agent Loop per file:
///   Turn 1: Review the file's diff → findings
///   Turn 2: Decide next action → AgentAction (Done | ReviewRelated | UseTool)
///   Turn 3+: Execute tool and feed result back, or review related file
/**
 *
 * @param {IFileChange} file
 * @param {HashMap<string, IFileChange>} file_index
 * @param {string} system_prompt
 * @param {LlmBackend} llm
 * @param {RetryConfig} retry_config
 * @param {usize} max_depth
 * @param {usize} max_tool_calls
 * @param {ToolConfig} tool_config
 * @param {TokenUsage} usage
 * @returns {Promise<Result<Vec<IFinding>>>}
 */
async function review_file_with_followup(
  file,
  file_index,
  system_prompt,
  llm,
  retry_config,
  max_depth,
  max_tool_calls,
  tool_config,
  usage,
) {
  // Turn 1: Review the file's diff
  const user_prompt = `Review this diff for \`${file.path}\`:\n\n\`\`\`diff\n${file.diff}\n\`\`\``

  info(user_prompt)

  return Ok([
    {
      file: "foo",
      line: 1,
      severity: /** @type {ISeverity} */ ("Critical"),
      category: "perf",
      message: "mock",
      suggestion: "foo bar baz",
    },
  ])
}
