// examples/code-review-agent/src/tools.rs — 工具安全约束

import { describe, it } from "node:test"
import { firstWord } from "./utils/lite-lodash.mjs"
import assert from "assert"
import { debug, warn } from "./utils/rust-patterns/logger.mjs"
import { spawn } from "node:child_process"

//! Tool execution for the Agent Loop.
//!
//! Inspired by vercel-labs/just-bash: instead of many specialized tools,
//! we provide a small set of universal tools that the LLM already knows.
//!
//! All tool execution is sandboxed:
//! - **bash**: read-only commands only (cat, grep, find, head, wc, etc.)
//! - **skill**: invoke a Claude Code skill by name
//!
//! The LLM requests tool use via `AgentAction::UseTool`, and our code
//! executes it with safety constraints.

/**
 * @import { ISkill, IToolResult, IToolConfig } from './tools.type.js'
 */

class ToolResult {
  tool = ""
  success = false
  output = ""

  /**
   * @param {IToolResult} parameters
   */
  constructor(parameters) {
    this.output = parameters.output
    this.success = parameters.success
    this.tool = parameters.tool
  }

  toObject() {
    return {
      success: this.success,
      output: this.output,
      tool: this.tool,
    }
  }
}

export class ToolConfig {
  /** @param {IToolConfig} parameters  */
  constructor(parameters) {
    Object.assign(this, parameters)
  }

  /**
   * @returns {IToolConfig}
   */
  static default() {
    return /** @type {const} */ ({
      cwd: null,
      max_output_bytes: 50_000,
      timeout_secs: 30,
    })
  }
}

/**
 * restrict to read-only commands for safety.
 * @satisfies {string[]}
 */
export const ALLOWED_COMMANDS = /** @type {const} */ ([
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "ls",
  "tree",
  "file",
  "stat",
  "diff",
  "sort",
  "uniq",
  "cut",
  "awk",
  "sed",
  "echo",
  "printf",
  "tr",
  "tee",
  "xargs",
  "basename",
  "dirname",
  "realpath",
  "readlink",
])

/**
 * @satisfies {string[]}
 * Commands that are explicitly forbidden.
 */
export const BLOCKED_COMMANDS = /** @type {const} */ ([
  "rm",
  "mv",
  "cp",
  "mkdir",
  "rmdir",
  "chmod",
  "chown",
  "chgrp",
  "dd",
  "mkfs",
  "mount",
  "umount",
  "kill",
  "pkill",
  "shutdown",
  "reboot",
  "curl",
  "wget",
  "ssh",
  "scp",
  "rsync",
  "apt",
  "yum",
  "brew",
  "pip",
  "npm",
  "cargo",
  "python",
  "node",
  "ruby",
  "perl",
  "bash",
  "sh",
  "zsh",
])

/// Check if a command is allowed (read-only).
/**
 *
 * @param {string} command
 * @returns {boolean}
 */
function is_command_allowed(command) {
  // Extract the first word (the actual command)
  let first_word = firstWord(command)
  // Strip any path prefix (e.g., /usr/bin/cat → cat)
  let cmd_name = first_word.split("/").at(-1) || first_word

  if (
    BLOCKED_COMMANDS.includes(
      // @ts-expect-error
      cmd_name,
    )
  ) {
    return false
  }

  // Check against allowlist
  return ALLOWED_COMMANDS.includes(
    // @ts-expect-error
    cmd_name,
  )
}

/// Shell metacharacters that indicate command chaining or injection.
/// We block these to prevent `cat file; rm -rf /` style attacks.
const SHELL_METACHARACTERS = /** @type {const} */ ([
  ";",
  "|",
  "&",
  "`",
  "$",
  "(",
  ")",
  "{",
  "}",
])

// ---------------------------------------------------------------------------
// Skill Tool — self-managed specialized analysis prompts
// ---------------------------------------------------------------------------

/// Built-in skills — specialized review lenses.
///
/// Inspired by Anthropic's connect-rust rust-code-reviewer (16 categories),
/// organized into focused skills that each cover related review dimensions.
/**
 * @type {ISkill[]}
 */
const BUILTIN_SKILLS = [
  // -----------------------------------------------------------------------
  // Security & Safety
  // -----------------------------------------------------------------------
  {
    name: "security-audit",
    description:
      "Security: injection, auth, crypto, data exposure, input validation, unsafe code",
    system_prompt: `You are an expert security auditor for Rust code. Analyze the provided code for:

1. **Input validation**: missing bounds checks, unbounded allocations from user input, type confusion
2. **Injection**: SQL injection, command injection, path traversal, format string issues
3. **Authentication/Authorization**: missing checks, weak patterns, session handling
4. **Cryptography**: weak algorithms, hardcoded keys/secrets, improper random, missing \`zeroize\`
5. **Data exposure**: PII in logs, secrets in error messages, debug info in production
6. **Unsafe code**: missing \`// SAFETY:\` comments, minimal surface area, unsound abstractions, FFI validation
7. **Timing safety**: timing-safe comparisons for secrets, constant-time operations

Be precise: cite file:line, explain the attack vector, rate severity.
Output a JSON array of findings. Each finding: {"file","line","severity","category":"security","message","suggestion"}`,
  },
  // -----------------------------------------------------------------------
  // Rust Ownership, Lifetimes & Concurrency
  // -----------------------------------------------------------------------
  {
    name: "rust-deep",
    description:
      "Rust expertise: ownership, lifetimes, concurrency safety, async patterns, type design",
    system_prompt: `You are a senior Rust engineer. Perform a deep Rust-specific review:

**Ownership & Lifetimes**
- Unnecessary \`.clone()\` — could borrow or use \`Cow\` instead?
- Missing lifetime annotations that would clarify API contracts
- \`Arc\`/\`Rc\` where simpler ownership would suffice
- Move semantics issues

**Concurrency Safety**
- \`Send\`/\`Sync\` bound violations or missing bounds
- Lock granularity: coarse locks that could be narrowed
- Deadlock potential: lock ordering, nested locks
- Cancellation safety in async code

**Async Patterns**
- \`Send\` bounds on futures (required for multi-threaded runtimes)
- Holding locks across \`.await\` points
- Missing backpressure (unbounded channels/buffers)
- Graceful shutdown handling

**Type Design**
- Newtypes to prevent primitive obsession
- Type-state pattern for compile-time state machines
- \`PhantomData\` for variance/lifetime markers
- Exhaustiveness: prefer enums over boolean flags

**Error Handling**
- \`Result\` vs panic: \`unwrap()\`/\`expect()\` in non-test code
- Error context: \`.context()\` / \`.with_context()\` for chain
- \`thiserror\` for libraries, \`anyhow\` for applications
- Recoverable vs unrecoverable error boundaries

Output a JSON array of findings. Each finding: {"file","line","severity","category","message","suggestion"}
Use category: "bug", "style", or "maintainability".`,
  },
  // -----------------------------------------------------------------------
  // Performance
  // -----------------------------------------------------------------------
  {
    name: "performance-review",
    description:
      "Performance: allocations, complexity, blocking, iterator chains, dispatch cost",
    system_prompt: `You are a performance engineer specializing in Rust. Analyze for:

1. **Allocations**: unnecessary heap allocations, \`String\` where \`&str\` suffices, \`Vec\` pre-allocation with \`with_capacity\`, \`Box\` vs stack allocation trade-offs
2. **Algorithmic complexity**: O(n²) patterns in hot paths, nested iterations, repeated linear scans
3. **Iterator chains**: missed opportunities for \`Iterator\` combinators, unnecessary \`.collect()\` intermediaries
4. **Dynamic dispatch cost**: \`dyn Trait\` in hot paths where \`impl Trait\` or enum dispatch would be faster
5. **Blocking in async**: sync I/O in async functions, lock contention across \`.await\`, \`spawn_blocking\` opportunities
6. **Inlining**: \`#[inline]\` hints for small functions called in hot loops, cross-crate inlining
7. **Data layout**: cache-friendly struct layout, AoS vs SoA, padding waste

Output a JSON array of findings. Each finding: {"file","line","severity","category":"performance","message","suggestion"}`,
  },
  // -----------------------------------------------------------------------
  // API Design & Documentation
  // -----------------------------------------------------------------------
  {
    name: "api-review",
    description:
      "API design: public interface, naming, docs, backward compatibility, ergonomics",
    system_prompt: `You are an API design reviewer. Analyze public interfaces for:

1. **Naming**: clarity, consistency with Rust conventions (RFC 430), misleading identifiers
2. **Public API surface**: over-exposed internals, missing \`pub(crate)\`, leaking implementation details
3. **Trait boundaries**: correct trait bounds on generics, blanket impls, sealed traits where needed
4. **Builder pattern**: for types with many optional fields, \`Default\` implementation
5. **Backward compatibility**: breaking changes to public types/functions, SemVer compliance
6. **Documentation**: \`///\` doc comments on public items, \`# Errors\`, \`# Panics\`, \`# Safety\` sections, runnable examples
7. **Dependencies**: minimal dep footprint, feature flags for optional deps, \`no_std\` compatibility
8. **MSRV**: minimum supported Rust version documented if applicable

Output a JSON array of findings. Each finding: {"file","line","severity","category":"maintainability","message","suggestion"}`,
  },
  // -----------------------------------------------------------------------
  // Testing & Observability
  // -----------------------------------------------------------------------
  {
    name: "test-coverage",
    description:
      "Test quality: coverage gaps, edge cases, test organization, observability",
    system_prompt: `You are a test quality specialist. Analyze for:

1. **Coverage gaps**: public functions without tests, untested error paths, missing edge cases
2. **Test quality**: assertions that are too weak, tests that pass vacuously, missing negative tests
3. **Test organization**: unit vs integration vs doc tests, test helpers, fixture reuse
4. **Edge cases**: boundary values, empty inputs, overflow, Unicode, concurrent access
5. **Async testing**: proper runtime setup, timeout handling, flaky test patterns
6. **Observability**: \`tracing\` spans with structured fields, metrics for key operations, health checks

Output a JSON array of findings. Each finding: {"file","line","severity","category":"maintainability","message","suggestion"}`,
  },
]

/// Find a built-in skill by name.
/**
 *
 * @param {string} name
 * @returns {import('./type.js').Option<ISkill>}
 */
export function find_skill(name) {
  return BUILTIN_SKILLS.find((s) => s.name === name) || null
}

/// List available skill names and descriptions.
/**
 * @returns {Array<[name: string, description: string]>}
 */
export function list_skills() {
  return BUILTIN_SKILLS.map((s) => [s.name, s.description])
}

/// Execute a bash command in a read-only sandbox.
///
/// Security: instead of `sh -c` (which interprets shell metacharacters),
/// we parse the command into program + args and execute directly.
/// Shell metacharacters are blocked entirely.
/**
 *
 * @param {string} command
 * @param {IToolConfig} config
 * @returns {Promise<ToolResult>}
 */
async function execute_bash(command, config) {
  console.log("EXECUTING bash command:", command)
  // Safety check: command allowlist
  if (!is_command_allowed(command)) {
    const first_word = firstWord(command, "(empty)")
    warn({ command: first_word }, "Blocked disallowed bash command")
    return new ToolResult({
      tool: "bash",
      success: false,
      output: `Command not allowed: ${first_word}. Only read-only commands are permitted.`,
    })
  }

  // Block shell metacharacters to prevent injection via `sh -c`
  // e.g., "cat file; uname -a" or "grep foo $(id)"
  if (SHELL_METACHARACTERS.some((meta_char) => command.includes(meta_char))) {
    warn(command, "Blocked shell metacharacter in command")
    return new ToolResult({
      tool: "bash",
      success: false,
      output: `Shell metacharacters (${SHELL_METACHARACTERS.join("")}) are not allowed. Use simple commands only.`,
    })
  }

  // Block output redirection
  if (command.includes(">")) {
    return new ToolResult({
      tool: "bash",
      success: false,
      output: "Output redirection (>) is not allowed in read-only mode.",
    })
  }

  debug(`Executing bash tool: \`${command}\``)

  // Parse command into program + args (no shell interpretation)
  // console.log(parseCommand(''));          // Empty command
  // console.log(parseCommand('echo'));      // { program: 'echo', args: [] }
  // console.log(parseCommand('echo hello')); // { program: 'echo', args: ['hello'] }
  // console.log(parseCommand('echo hello world')); // { program: 'echo', args: ['hello', 'world'] }

  const [program, ...args] = command.trim().split(/\s+/)
  if (program == null || program === "") {
    return new ToolResult({
      tool: "bash",
      success: false,
      output: "Empty command",
    })
  }

  // spawn a child process to run the command

  const { stderr, stdout, code } = await spawnAsync(program, args, {
    // stdio: "pipe",
    cwd: config.cwd || undefined,
    timeout: config.timeout_secs * 1000,
  })

  const success = code === 0

  const output_text = !stderr
    ? stdout
    : !stdout
      ? stderr
      : `${stdout}\n--- stderr ---\n${stderr}`

  return new ToolResult({
    tool: "bash",
    success,
    output: output_text,
  })
}

/// Dispatch a tool call by name.
///
/// For "bash": executes locally in a read-only sandbox.
/// For "skill": returns the skill's system prompt so the Agent Loop
///   can call the LLM with it (skills are LLM-powered, not subprocess-powered).
/**
 *
 * @param {string} tool_name
 * @param {string} tool_input
 * @param {IToolConfig} config
 * @returns {Promise<IToolResult>}
 */
export async function execute_tool(tool_name, tool_input, config) {
  debug("execute_tool:", { tool_name, tool_input })
  switch (tool_name) {
    case "bash": {
      const bashResult = await execute_bash(tool_input, config)

      console.log("execute_bash tool_input:", tool_input)
      console.log("execute_bash bashResult:", bashResult)

      return bashResult
    }
    case "skill": {
      // Skill tool: look up the skill and return its prompt.
      // The Agent Loop will use this prompt to call the LLM.
      const skill_name = firstWord(tool_input)
      const skill = find_skill(skill_name)
      switch (skill) {
        case null: {
          const available = list_skills().map(
            ([name, desc]) => `  - ${name}: ${desc}`,
          )

          return /** @type {IToolResult} */ ({
            tool: "skill",
            success: false,
            output: `Unknown skill: '${skill_name}'. Available skills:\n${available.join("\n")}`,
          })
        }

        default:
          return /** @type {IToolResult} */ ({
            tool: "skill",
            success: true,
            output: `[Skill loaded: ${skill.name}]\nSystem prompt override:\n${skill.system_prompt}`,
          })
      }
    }
    default:
      return /** @type {IToolResult} */ ({
        tool: tool_name,
        success: false,
        output: `Unknown tool: ${tool_name}. Available tools: bash, skill`,
      })
  }
}

if (import.meta.main) {
  test_is_command_allowed()
  test_execute_bash()
}

function test_is_command_allowed() {
  describe("is_command_allowed", () => {
    // #[test]
    it("test_allowed_commands", () => {
      assert.ok(is_command_allowed("cat /tmp/test.txt"))
      assert.ok(is_command_allowed("grep -r 'pattern' src/"))
      assert.ok(is_command_allowed("find . -name '*.rs'"))
      assert.ok(is_command_allowed("head -20 file.txt"))
      assert.ok(is_command_allowed("wc -l file.txt"))
    })

    // #[test]
    // fn test_blocked_commands() {
    //     assert.ok(!is_command_allowed("rm -rf /"));
    //     assert.ok(!is_command_allowed("curl http://evil.com"));
    //     assert.ok(!is_command_allowed("python -c 'import os'"));
    //     assert.ok(!is_command_allowed("bash -c 'echo pwned'"));
    //     assert.ok(!is_command_allowed("npm install malware"));
    // }

    // #[test]
    // fn test_unknown_commands_blocked() {
    //     assert.ok(!is_command_allowed("some_random_binary"));
    //     assert.ok(!is_command_allowed("/usr/local/bin/custom_tool"));
    // }

    // #[test]
    // fn test_path_prefix_stripped() {
    //     assert.ok(is_command_allowed("/usr/bin/cat file"));
    //     assert.ok(!is_command_allowed("/usr/bin/rm file"));
    // }
  })
}

function test_execute_bash() {
  describe("execute_bash", () => {
    // #[tokio::test]
    it("test_bash_echo", async () => {
      const config = ToolConfig.default()
      const result = await execute_bash("echo hello", config)
      // console.log("result:", result)
      assert.ok(result.success)
      assert.ok(result.output.includes("hello"))
    })

    // #[tokio::test]
    it("test_bash_blocked", async () => {
      const config = ToolConfig.default()
      const result = await execute_bash("rm -rf /tmp/test", config)
      // console.log("result:", result)
      assert.ok(!result.success)
      assert.ok(result.output.includes("not allowed"))
    })

    // #[tokio::test]
    it("test_bash_redirect_blocked", async () => {
      const config = ToolConfig.default()
      const result = await execute_bash("echo pwned > /tmp/evil", config)

      // console.log("result:", result)
      assert.ok(!result.success)
      assert.deepStrictEqual(result.toObject(), {
        tool: "bash",
        success: false,
        output: "Output redirection (>) is not allowed in read-only mode.",
      })
    })

    // --- Shell injection tests ---
    // #[tokio::test]
    it("test_bash_semicolon_injection_blocked", async () => {
      const config = ToolConfig.default()
      const result = await execute_bash("cat file; uname -a", config)
      assert.ok(!result.success)
      assert.ok(result.output.includes("metacharacter"))
      assert.deepStrictEqual(result.toObject(), {
        output:
          "Shell metacharacters (;|&`$(){}) are not allowed. Use simple commands only.",
        success: false,
        tool: "bash",
      })
    })

    // #[tokio::test]
    it("test_bash_pipe_injection_blocked", async () => {
      let config = ToolConfig.default()
      let result = await execute_bash("cat file | rm -rf ./temp.txt", config)
      assert.ok(!result.success)
      assert.ok(result.output.includes("metacharacter"))
    })

    // #[tokio::test]
    it("test_bash_subshell_injection_blocked", async () => {
      let config = ToolConfig.default()
      let result = await execute_bash("grep foo $(id)", config)
      assert.ok(!result.success)
      assert.ok(result.output.includes("metacharacter"))
    })

    // #[tokio::test]
    it("test_bash_backtick_injection_blocked", async () => {
      let config = ToolConfig.default()
      let result = await execute_bash("cat `whoami`", config)
      assert.ok(!result.success)
      assert.ok(result.output.includes("metacharacter"))
    })

    // #[tokio::test]
    it("test_bash_and_chain_blocked", async () => {
      let config = ToolConfig.default()
      let result = await execute_bash("cat file && rm -rf /", config)
      assert.ok(!result.success)
      assert.ok(result.output.includes("metacharacter"))
    })
  })
}

/** @typedef {Parameters<typeof spawn>} SpawnParams */

/**
 *
 * @type {(...params: SpawnParams) => Promise<{ stdout: string, stderr: string, code: number | null }>}
 */
function spawnAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    let stdout = ""
    let stderr = ""

    // 收集标准输出
    // @ts-expect-error
    child.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    // 收集错误输出
    // @ts-expect-error
    child.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    // 进程退出
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code })
      } else {
        reject({ stdout, stderr, code })
      }
    })

    // 进程出错（如命令不存在）
    child.on("error", (err) => {
      reject(err)
    })
  })
}

// 使用示例
// async function runCommand() {
//   try {
//     const result = await spawnAsync('ls', ['-la'], { cwd: './' });
//     console.log('输出:', result.stdout);
//   } catch (err) {
//     console.error('错误:', err.stderr || err.message);
//   }
// }

// runCommand();
