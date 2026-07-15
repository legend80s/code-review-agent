/** @import { IPrInfo } from './prompts.type.js' */
/** @import { IFinding } from './review.type.js' */

import { describe, it } from "node:test"
import assert from "node:assert"
import { DiffContext } from "./context.mjs"
import { Severity } from "./review.mjs"

// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export class PrInfo {
  /**
   * Construct `PrInfo` from a parsed diff context.
   * @param {DiffContext} diff
   * @returns {IPrInfo}
   */
  static from_diff_context(diff) {
    /** @type {string[]} */
    const changedFiles = diff.files.map((f) => f.path)
    const title =
      changedFiles.length === 1
        ? `Review changes in ${changedFiles[0]}`
        : `Review changes across ${changedFiles.length} files`

    return {
      title,
      changedFiles,
    }
  }
}

/**
 *  Build the full system prompt from PR metadata.
 *
 * The prompt has two sections:
 * 1. **Constitution** (static): review principles, severity definitions, output format spec.
 * 2. **Runtime** (dynamic): PR title, changed file list, inferred language rules.
 * @param {IPrInfo} pr_info
 * @returns {string}
 */
export function build_system_prompt(pr_info) {
  const constitution = build_constitution()
  const runtime = build_runtime_section(pr_info)

  return `${constitution}\n\n---\n\n${runtime}`
}

// examples/code-review-agent/src/prompts.rs:45-84
/**
 * @returns {string}
 */
function build_constitution() {
  return `# Code Review Agent — Constitution

You are a code review agent. Your job is to review diffs and produce
a structured list of findings.

# Review Principles
1. **Correctness first**: Flag logic errors, off-by-one bugs...
2. **Security**: Identify injection vulnerabilities...
// ...

# Output Format
You MUST output a JSON array of finding objects...`
}

/**
 * Dynamic runtime section: PR metadata and language-specific hints.
 * @param {IPrInfo} pr_info
 * @returns {string}
 */
function build_runtime_section(pr_info) {
  const fileList = pr_info.changedFiles.map((f) => `  - ${f}`).join("\n")

  const language_rules = infer_language_rules(pr_info.changedFiles)

  return `# Runtime Context

## Change Summary
**Title:** ${pr_info.title}
**Files changed:** ${pr_info.changedFiles.length}

${fileList}

${language_rules}`
}

/**
 * Infer language-specific review rules from file extensions.
 * @param {string[]} files
 * @returns {string}
 */
function infer_language_rules(files) {
  /** @type {`## ${string}`[]} */
  const rules = []

  let seen_ts = false
  const jsFamily = [".js", ".jsx", ".ts", ".tsx", ".mjs"]

  let seen_rs = false

  for (const file of files) {
    // javascript / typescript specific rules
    if (!seen_ts && jsFamily.some((ext) => file.endsWith(ext))) {
      seen_ts = true
      rules.push(`## TypeScript-Specific Rules
  - Flag \`any\` type usage.
  - Check for missing \`await\` on async calls.
  - Verify error handling in \`try/catch\` blocks.`)
    }

    // rust specific rules
    if (!seen_rs && file.endsWith(".rs")) {
      seen_rs = true
      rules.push(`## Rust-Specific Rules
  - Check for \`.unwrap()\` in non-test code.
  - Flag \`unsafe\` blocks that lack a \`// SAFETY:\` comment.
  - Watch for unnecessary \`.clone()\` calls.`)
    }
  }

  return rules.join("\n\n")
}

/**
 *
 * @param { string} reviewed_file
 * @param {readonly IFinding[]} findings
 * @param {readonly string[]} available_files
 * @returns {string}
 */
export function build_followup_prompt(
  reviewed_file,
  findings,
  available_files,
) {
  /** @type {string} */
  const findings_summary = findings
    .slice(0, 5) // limit to top 5 to save tokens
    .map((f) => `  - [${f.severity}] ${f.file}: ${f.message}`)
    .join("\n")

  const files_list = available_files.map((f) => `  - ${f}`).join("\n")

  const related_files_section =
    available_files.length === 0
      ? "No other files in the changeset."
      : `The changeset also includes these other files:\n\n${files_list}`

  const review_related_option =
    available_files.length === 0
      ? ""
      : `
2. Review a related file from the changeset:
   {{"action": "review_related", "file": "<path>", "reason": "<why>"}}
`

  return `You just reviewed \`${reviewed_file}\` and found these issues:

${findings_summary}

${related_files_section}

What should you do next? You can use read-only bash commands to get more context (e.g., look up a function definition, search for callers, check a config file).

Respond with ONLY a JSON object, no other text. Choose ONE action:

1. No follow-up needed:
   {{"action": "done"}}
${review_related_option}
3. Run a read-only bash command to get more context:
   {{"action": "use_tool", "tool": "bash", "input": "<command>", "reason": "<why>"}}
   Allowed commands: cat, grep, find, head, tail, wc, ls, sort, uniq, awk, sed, etc.
   Example: {{"action": "use_tool", "tool": "bash", "input": "grep -rn 'MAX_RETRIES' src/", "reason": "check the constant value"}}

4. Run a specialized analysis skill on the current file:
   {{"action": "use_tool", "tool": "skill", "input": "<skill_name>", "reason": "<why>"}}
   Available skills: security-audit, rust-deep, performance-review, api-review, test-coverage`
}

// #[cfg(test)]
describe("test", () => {
  // use super::*;

  // #[test]
  // fn test_build_system_prompt_contains_constitution_and_runtime() {
  //     let pr_info = PrInfo {
  //         title: "Fix null pointer in parser".to_string(),
  //         changed_files: vec!["src/parser.rs".to_string(), "src/lib.rs".to_string()],
  //     };
  //     let prompt = build_system_prompt(&pr_info);
  //     assert!(prompt.contains("Code Review Agent"));
  //     assert!(prompt.contains("Fix null pointer in parser"));
  //     assert!(prompt.contains("src/parser.rs"));
  //     assert!(prompt.contains("Rust-Specific Rules"));
  // }

  // #[test]
  // fn test_language_detection_typescript() {
  //     let files = vec!["app/index.tsx".to_string()];
  //     let rules = infer_language_rules(&files);
  //     assert!(rules.contains("TypeScript"));
  // }

  // #[test]
  // fn test_no_language_rules_for_unknown() {
  //     let files = vec!["Makefile".to_string()];
  //     let rules = infer_language_rules(&files);
  //     assert!(rules.is_empty());
  // }

  // #[test]
  it("test_build_followup_prompt_contains_findings_and_files", () => {
    /** @type {IFinding[]} */
    const findings = [
      {
        file: "src/main.rs",
        line: 10,
        severity: Severity.Warning,
        category: "bug",
        message: "potential null deref",
        suggestion: null,
      },
    ]
    const available = ["src/lib.rs", "src/utils.rs"]
    const prompt = build_followup_prompt("src/main.rs", findings, available)

    console.log("prompt:", prompt)

    assert.ok(prompt.includes("src/main.rs"))
    assert.ok(prompt.includes("potential null deref"))
    assert.ok(prompt.includes("src/lib.rs"))
    assert.ok(prompt.includes("src/utils.rs"))
    assert.ok(prompt.includes(`"review_related"`))
  })
})
