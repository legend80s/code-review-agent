/** @import { HashMap, Path, usize, Vec } from './type.js' */
/** @import { IFinding, IReviewReport, ISeverity } from './review.type.js' */
/** @import { IReviewConfig } from './agent.type.js' */
/** @import { IFileChange } from './context.type.js' */
/** @import { RetryConfig } from './resilience.type.js' */
/** @import { ITokenUsage, LlmBackend } from './llm.type.js' */

import { styleText } from "util"
import { applyBudget, ContextBudget, load_diff } from "./context.mjs"
import { TokenUsage } from "./llm.mjs"
import {
  build_followup_prompt,
  build_system_prompt,
  PrInfo,
} from "./prompts.mjs"
import { CircuitBreaker, with_retry } from "./resilience.mjs"
import {
  AgentAction,
  parse_agent_action,
  parse_findings_from_response,
  Severity,
} from "./review.mjs"
import * as tools from "./tools.mjs"
import { debug, error, info, warn } from "./utils/rust-patterns/logger.mjs"
import { Ok, Result, tryCatch } from "./utils/rust-patterns/result.mjs"

const { ToolConfig } = tools
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
    return `- Files reviewed: ${this.files_reviewed}\n- Findings: ${this.findings.length}\n- Duration: ${this.duration_ms}ms`
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

  info("Loaded diff:", { files: diff_context.files.length }, "\n")

  // Step 2: Apply budget
  const budget = new ContextBudget(config.max_tokens, config.max_file_tokens)
  // console.log("config:", config)
  // console.log("budget:", budget)
  const [constrained_diff, files_skipped] = applyBudget(diff_context, budget)

  const files_to_review = constrained_diff.files.length
  info("\nBudget applied:", {
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
    new ReviewReport({
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
 * @param {import('./tools.type.js').IToolConfig} tool_config
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
  console.log(
    "review_file_with_followup, system_prompt:",
    system_prompt.slice(0, 100),
  )

  // Turn 1: Review the file's diff
  const user_prompt = `Review this diff for \`${file.path}\`:\n\n\`\`\`diff\n${file.diff}\n\`\`\``

  // info(user_prompt)

  const [err, response] = await with_retry(retry_config, () => {
    const sp = system_prompt
    const up = user_prompt
    return llm.complete(sp, up)
  })

  if (err) {
    console.error(err)
    throw err
  }

  const unwrappedResponse = response?.unwrap()
  // console.log("value:", unwrappedResponse)

  if (!unwrappedResponse?.usage) {
    console.error("No usage found in response")
    throw new Error("No usage found in response")
  }

  usage.accumulate(unwrappedResponse.usage)
  let findings = parse_findings_from_response(unwrappedResponse.text)

  // Turn 2+: Agent decision loop — the LLM can request tools or related file review.
  // Each iteration: ask for next action → execute → feed result back.
  // Capped at max_tool_calls to prevent runaway loops.
  let tool_calls_used = 0
  let context_addendum = "" // accumulated tool results

  if (!(max_depth > 0 || max_tool_calls > 0)) {
    return Ok(findings)
  }

  const available_files = file_index
    .keys()
    .filter((k) => k !== file.path)
    .toArray()

  console.log("available_files:", available_files)

  while (tool_calls_used < max_tool_calls) {
    console.log("tool_calls_used:", { tool_calls_used, max_tool_calls })
    const decision_prompt =
      context_addendum === ""
        ? build_followup_prompt(file.path, findings, available_files)
        : `${build_followup_prompt(file.path, findings, available_files)}\n\n--- Tool Results ---\n${context_addendum}\n\nBased on these results, what's your next action?`

    const [err, response] = await with_retry(retry_config, () => {
      return llm.complete(system_prompt, decision_prompt)
    })

    if (err) {
      // console.error(err)
      warn("Follow-up decision call failed", { file: file.path, error: err })

      break
    }

    const decision_response = response?.unwrap()

    usage.accumulate(decision_response.usage)

    // switch (key) {
    //   case value:

    //     break;

    //   default:
    //     break;
    // }
    debug(
      `decision_response.text: |${styleText("yellow", decision_response.text)}|`,
    )
    const action = parse_agent_action(decision_response.text)
    debug("action", action)

    switch (action?.action) {
      case AgentAction.Done:
        return Ok(findings)
      case null:
        return Ok(findings)

      case AgentAction.ReviewRelated: {
        const { file: related, reason } = action
        if (max_depth === 0) {
          return Ok(findings)
        }
        const related_file = file_index.get(related)
        if (related_file) {
          info("Agent: review related file:", {
            from: file.path,
            related: related,
            reason: reason,
          })
          let related_prompt =
            "You found issues in `" +
            file.path +
            "`. Now review `" +
            related_file.path +
            "`.\n\
                      Focus on cross-file interactions.\n\n```diff\n" +
            related_file.diff +
            "\n```"
          const [err, resp] = await with_retry(retry_config, () => {
            return llm.complete(system_prompt, related_prompt)
          })

          if (err) {
            error("Agent: failed to review related file", {
              from: file.path,
              related: related,
              reason: reason,
              error: err,
            })
          } else {
            const unwrapped = response.unwrap()

            usage.accumulate(unwrapped.usage)
            findings = findings.concat(
              parse_findings_from_response(unwrapped.text),
            )
          }
        }
        return Ok(findings) // Only one related file per review
      }

      // Some(AgentAction::UseTool { tool, input, reason }) => {
      case AgentAction.UseTool: {
        if (tool_calls_used >= max_tool_calls) {
          info("Tool call limit reached", { file: file.path })
          return Ok(findings)
        }

        const { tool, input, reason } = action
        info("Agent: using tool", {
          file: file.path,
          tool: tool,
          reason: reason,
        })

        if (tool === "skill") {
          // Skill tool: load the skill's system prompt and run
          // a specialized review of the current file.
          const skill_name = input.trim().split(/\s+/)[0] ?? ""
          const skill = tools.find_skill(skill_name)
          if (skill) {
            info({ skill: skill.name }, "Agent: running skill analysis")
            const skill_prompt =
              "Analyze this code:\n\n```diff\n" + file.diff + "\n```"

            const [err, result] = await with_retry(retry_config, () => {
              return llm.complete(skill.system_prompt, skill_prompt)
            })

            if (err) {
              error("Agent: skill analysis failed", {
                file: file.path,
                error: err,
              })
            } else {
              const resp = result.unwrap()
              usage.accumulate(resp.usage)
              const skill_findings = parse_findings_from_response(resp.text)
              info("Skill analysis complete", {
                skill: skill.name,
                findings: skill_findings.length,
              })
              findings = findings.concat(skill_findings)
            }
          } else {
            const available = tools
              .list_skills()
              .map((n, d) => `${n}: ${d}`)
              .join(", ")
            context_addendum += `\n[Skill '${skill_name}' not found. Available: ${available}]\n`
          }
        } else {
          // Bash tool: execute and feed result back
          const result = await tools.execute_tool(tool, input, tool_config)
          context_addendum += `\n[Tool: ${result.tool} | Success: ${result.success}]\n${result.output}\n`
        }
        tool_calls_used += 1
      }
    }
  }

  return Ok(findings)
}
