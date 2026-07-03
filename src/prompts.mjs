/** @import { PrInfo } from './type.js' */

/**
 *  Build the full system prompt from PR metadata.
 *
 * The prompt has two sections:
 * 1. **Constitution** (static): review principles, severity definitions, output format spec.
 * 2. **Runtime** (dynamic): PR title, changed file list, inferred language rules.
 * @param {PrInfo} pr_info
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
 * @param {PrInfo} pr_info
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
