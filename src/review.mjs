import assert from "node:assert"
import { it } from "node:test"
import { debug, warn } from "./utils/rust-patterns/logger.mjs"
import { styleText } from "node:util"

/** @import { IAgentAction, IFinding } from './review.type.js'  */

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
 * @param {any} obj
 * @returns {obj is IFinding}
 */
function isFinding(obj) {
  return !!(obj.file && obj.severity && obj.category && obj.message)
}

/**
 *
 * @param {any} arr
 * @returns {arr is IFinding[]}
 */
function isFindingArray(arr) {
  return arr.every(isFinding)
}

/**
 *
 * @param {string} text
 * @returns {import('./review.type.js').IFinding[]}
 */
export function parse_findings_from_response(text) {
  text = text.trim()

  if (text.startsWith("[")) {
    const array = JSON.parse(text)
    if (isFindingArray(array)) {
      return array
    }
  }

  // match code in code blocks ```json<code>```
  const matches = text.match(/```json([\s\S]*?)```/)
  const match = matches?.[1]
  if (match) {
    const array = JSON.parse(match.trim())
    if (isFindingArray(array)) {
      return array
    }
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
  // debug(`json: |${styleText("yellow", json)}|`)
  // Try direct parse first
  if (json.startsWith("{")) {
    const action = JSON.parse(json)
    if (isAgentAction(action)) {
      return action
    }
  }
  // Try to extract JSON object from surrounding text — scan for each `{`
  // const matches = json.match(/\{([\s\S]*?)\}/)
  // const match = matches?.[1]
  // if (match) {
  //   debug(`match: |${styleText("yellow", match)}|`)
  //   let trimmed = match.trim()
  //   if (!trimmed.startsWith("{")) {
  //     trimmed = "{" + trimmed
  //   }
  //   if (!trimmed.endsWith("}")) {
  //     trimmed = trimmed + "}"
  //   }

  //   return JSON.parse(trimmed)
  // }

  let search_from = 0
  let start = 0
  // biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
  while ((start = text.slice(search_from).indexOf("{")) !== -1) {
    start = search_from + start

    const end = text.slice(start).lastIndexOf("}")
    const candidate = text.slice(start, start + end + 1)

    try {
      const json = JSON.parse(candidate)
      // console.log("json:", json)
      if (isAgentAction(json)) {
        return json
      }
    } catch (error) {
      // continue
    }

    // let  stream =
    //     serde_json::Deserializer::from_str(candidate).into_iter::<AgentAction>();
    // if let Some(Ok(action)) = stream.next() {
    //     return Some(action);
    // }
    search_from = start + 1
  }

  debug("Could not parse agent action from response")

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

  it("test_parse_findings_with_empty_string", () => {
    const deepseek_review_response = `> 

\`\`\`json
[
  {
    "severity": "ERROR",
    "type": "CORRECTNESS",
    "title": "Assignment to undeclared variable",
    "body": "Line 151: \`result\` is assigned but never declared with \`const\`, \`let\`, or \`var\`. This will throw a ReferenceError in strict mode. The line \`const result = (...)\` in the \`if (import.meta.main)\` block incorrectly assigns to a new global variable, likely attempting to reuse a \`const\` declaration? Actually, the code does have \`const result =\` - wait, the diff shows this is fine. Re-evaluating: The issue is on line 151 \`const result = (...)\` - wait, the issue is the parentheses wrapping the \`await\` expression: \`const result = (await backend.complete(...)).unwrap()\`. This is valid syntax, the \`await\` is inside parentheses. Actually, the real issue is that \`import.meta.main\` is not a standard Node.js feature. This property is used in Deno, but not in Node.js. This code will never execute in Node.js, meaning the test block is dead code.",
    "path": "src/llm.mjs",
    "line": 140,
    "snippet": "if (import.meta.main) {"
  },
  {
    "severity": "ERROR",
    "type": "CORRECTNESS",
    "title": "Missing error handling for streaming loop",
    "body": "The \`for await (const event of stream)\` loop on line 99 does not have a try/catch block. If the stream encounters an error (e.g., network failure, API error), the entire \`#queryLlm\` method will throw an unhandled promise rejection, which will propagate up but may not be caught by the caller's try/catch in \`complete\` method because the error might occur outside the async context. The error should be properly caught and handled.",
    "path": "src/llm.mjs",
    "line": 99,
    "snippet": "for await (const event of stream) {"
  },
  {
    "severity": "WARNING",
    "type": "STYLE",
    "title": "Commented-out code and debug logs",
    "body": "There are several commented-out lines (lines 121-127, 137) and console.log statements (lines 102-108) that should be removed before production. The \`@ts-expect-error\` at line 133 suggests the developer is working around a TypeScript type issue without understanding why, which could indicate a type mismatch.",
    "path": "src/llm.mjs",
    "line": 102
  },
  {
    "severity": "WARNING",
    "type": "PERFORMANCE",
    "title": "Potentially missing stream options",
    "body": "The \`stream: true\` option is set, but \`stream_options: { include_usage: true }\` is not set. According to the OpenAI API, when streaming with \`stream: true\`, the \`usage\` field in the final chunk is only included if \`stream_options: { include_usage: true }\` is specified. Without this, \`event.usage\` on the last chunk may be \`null\`, and the token counts will remain 0.",
    "path": "src/llm.mjs",
    "line": 88,
    "snippet": "stream: true,"
  },
  {
    "severity": "ERROR",
    "type": "LOGGING",
    "title": "console.log usage in production code",
    "body": "Several \`console.log\` statements exist on lines 102-108 which output sensitive cache statistics. In production, these should use proper logging functions (like the already-imported \`debug\`) or be removed. Additionally, the caching tokens information could leak implementation details.",
    "path": "src/llm.mjs",
    "line": 102
  },
  {
    "severity": "WARNING",
    "type": "SECURITY",
    "title": "API key from environment variable",
    "body": "The DeepSeek API key is read from \`process.env.DEEPSEEK_API_KEY\` (line 57). Ensure this environment variable is properly secured and not exposed in logs or error messages. Consider using a secrets manager for production.",
    "path": "src/llm.mjs",
    "line": 57
  },
  {
    "severity": "INFO",
    "type": "STYLE",
    "title": "Inconsistent variable naming",
    "body": "The variable \`fullReasoningContentInMarkdown\` uses camelCase, which is inconsistent with the snake_case variables \`input_tokens\` and \`output_tokens\` (lines 96-97). While both are valid in JavaScript, consistency within the same function is recommended.",
    "path": "src/llm.mjs",
    "line": 138
  }
]
\`\`\`
`
    const findings = parse_findings_from_response(deepseek_review_response)
    assert.deepStrictEqual(findings, [])
  })
}
// --- AgentAction tests ---
function test_parse_agent_action() {
  // console.log("1111")
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

  // #[test]
  it("test_parse_agent_action_from_surrounding_text", () => {
    const text = `Based on the findings, I recommend: {"action": "review_related", "file": "src/utils.rs", "reason": "caller"} since it calls the changed function.`

    const action = parse_agent_action(text)
    // console.log("action111:", action)
    assert.equal(action?.action, AgentAction.ReviewRelated)
  })

  // #[test]
  it("test_parse_agent_action_garbage_returns_none", () => {
    const action = parse_agent_action("I think we're done here, no issues.")
    assert.equal(action, null)
  })

  it("parse_agent_action real deepseek response", () => {
    // console.log("action parse start")
    const action = parse_agent_action(`> 

{
  "action": "done",
  "findings": [
    {
      "file": "src/llm.mjs",
      "line": 1,
      "severity": "Critical",
      "category": "security",
      "message": "Hardcoded API key detected: \`const API_KEY = 'sk-...'\`. This exposes credentials in the source code and is a security risk.",
      "suggestion": "Use environment variables (e.g., process.env.OPENAI_API_KEY) or a secure secrets manager instead."
    },
    {
      "file": "src/llm.mjs",
      "line": 15,
      "severity": "Warning",
      "category": "bug",
      "message": "Missing \`await\` before \`llm.generate()\` inside \`callLLM()\`. The async return value is not properly handled.",
      "suggestion": "Add \`await\` before \`llm.generate()\`."
    }
  ]
}`)

    // console.log("action:", action)

    assert.deepStrictEqual(action, {
      action: "done",
      findings: [
        {
          file: "src/llm.mjs",
          line: 1,
          severity: "Critical",
          category: "security",
          message:
            "Hardcoded API key detected: `const API_KEY = 'sk-...'`. This exposes credentials in the source code and is a security risk.",
          suggestion:
            "Use environment variables (e.g., process.env.OPENAI_API_KEY) or a secure secrets manager instead.",
        },
        {
          file: "src/llm.mjs",
          line: 15,
          severity: "Warning",
          category: "bug",
          message:
            "Missing `await` before `llm.generate()` inside `callLLM()`. The async return value is not properly handled.",
          suggestion: "Add `await` before `llm.generate()`.",
        },
      ],
    })
  })
}
