import assert from "node:assert"
import { it } from "node:test"
import { debug, warn } from "./utils/rust-patterns/logger.mjs"
import { styleText } from "node:util"

/** @import { IAgentAction } from './review.type.js'  */

export const AgentAction = /** @type {const} */ ({
  Done: "done",
  ReviewRelated: "review_related",
  UseTool: "use_tool",
})

/// Severity level for a finding.
///
/// Accepts both title-case ("Critical") and lowercase ("critical") from LLM output.
// #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
/**
 * @satisfies {Record<string, string>}
 */
export const Severity = /** @type {const} */ ({
  Critical: "Critical",
  Warning: "Warning",
  Info: "Info",
})

/**
 *
 * @param {string} text
 * @returns {import('./review.type.js').IFinding[]}
 */
export function parse_findings_from_response(text) {
  text = text.trim()

  if (text.startsWith("[")) {
    return JSON.parse(text)
  }

  // match code in code blocks ```json<code>```
  const matches = text.match(/```json([\s\S]*?)```/)
  const match = matches?.[1]
  if (match) {
    return JSON.parse(match.trim())
  }

  warn("Could not parse any findings from model response")

  return []
}

/// Parse an agent action from the LLM's text response.
///
/// The LLM is instructed to output JSON like `{"action": "done"}` or
/// `{"action": "review_related", "file": "path", "reason": "..."}`.
/**
 *
 * @param {string} text
 * @returns {import('./type.js').Option<IAgentAction>}
 */
export function parse_agent_action(text) {
  const json = text.trim()
  debug(`json: |${styleText("yellow", json)}|`)
  // Try direct parse first
  if (json.startsWith("{")) {
    const action = JSON.parse(json)
    if (isAgentAction(action)) {
      return action
    }
  }
  // Try to extract JSON object from surrounding text — scan for each `{`
  const matches = json.match(/\{([\s\S]*?)\}/)
  const match = matches?.[1]
  if (match) {
    debug(`match: |${styleText("yellow", match)}|`)
    return JSON.parse(`{${match.trim()}}`)
  }

  return null
}

/**
 * Type guard for AgentAction
 * @param {any} value
 * @returns {value is IAgentAction}
 */
function isAgentAction(value) {
  if (typeof value !== "object" || value === null) return false

  const action = value.action
  if (typeof action !== "string") return false

  if (action === "done") {
    return true
  }

  if (action === "review_related") {
    return typeof value.file === "string" && typeof value.reason === "string"
  }

  if (action === "use_tool") {
    return (
      typeof value.tool === "string" &&
      typeof value.input === "string" &&
      typeof value.reason === "string"
    )
  }

  return false
}

if (import.meta.main) {
  test_parse_findings_from_response()
  test_parse_agent_action()
}

// #[cfg(test)]
async function test_parse_findings_from_response() {
  // #[test]
  it("test_parse_findings_direct_json", () => {
    const json = `[{"file":"a.rs","line":1,"severity":"Critical","category":"bug","message":"oops","suggestion":null}]`
    const findings = parse_findings_from_response(json)
    assert.equal(findings.length, 1)
    assert.deepStrictEqual(findings[0]?.severity, Severity.Critical)
  })

  // #[test]
  it("test_parse_findings_with_markdown_fence", () => {
    const text =
      'Here are the findings:\n```json\n[{"file":"b.rs","line":10,"severity":"Info","category":"style","message":"naming","suggestion":null}]\n```\n'
    const findings = parse_findings_from_response(text)
    assert.equal(findings.length, 1)
  })

  // #[test]
  it("test_parse_findings_empty_array", () => {
    const findings = parse_findings_from_response("[]")
    assert.ok(findings.length === 0)
  })

  // #[test]
  it("test_parse_findings_garbage_returns_empty", () => {
    const findings = parse_findings_from_response("no json here at all")
    assert.ok(findings.length === 0)
  })
}
// --- AgentAction tests ---
async function test_parse_agent_action() {
  // #[test]
  it("test_parse_agent_action_done", () => {
    const action = parse_agent_action('{"action": "done"}')
    assert.equal(action?.action, AgentAction.Done)
  })

  // #[test]
  it("test_parse_agent_action_review_related", () => {
    const action = parse_agent_action(
      `{"action": "review_related", "file": "src/lib.rs", "reason": "shared types"}`,
    )
    assert.equal(action?.action, AgentAction.ReviewRelated)

    if (action?.action !== AgentAction.ReviewRelated) {
      throw new Error(`expected ReviewRelated, got ${action?.action}`)
    }
    assert.equal(action.file, "src/lib.rs")
    assert.equal(action.reason, "shared types")
  })

  // // #[test]
  it("test_parse_agent_action_from_surrounding_text", () => {
    const text = `Based on the findings, I recommend: {"action": "review_related", "file": "src/utils.rs", "reason": "caller"} since it calls the changed function.`

    const action = parse_agent_action(text)
    assert.equal(action?.action, AgentAction.ReviewRelated)
  })

  // // #[test]
  it("test_parse_agent_action_garbage_returns_none", () => {
    const action = parse_agent_action("I think we're done here, no issues.")
    assert.equal(action, null)
  })
}
