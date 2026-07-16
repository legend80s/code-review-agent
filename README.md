# Code Review Agent in JavaScript

> A code review agent that uses the DeepSeek API to generate code reviews.

It takes a diff file as input and outputs in json/markdown format with the generated reviews.

It is written in JavaScript and uses the Node.js runtime. The original project is in Rust.

Credit to <https///github.com/ZhangHanDong/harness-engineering-from-cc-to-ai-coding> which is a great starting point for this project.

## Usage

```bash
export DEEPSEEK_API_KEY=sk-your-api-key

node src/main.mjs --diff ./src.diff > review_log.md
```

## Features

### 1. Skills

> Built-in skills — specialized review lenses.

Builtin skills and bash tools are also used by need during the review process. file: src/tools.mjs

Inspired by Anthropic's connect-rust rust-code-reviewer (16 categories), organized into focused skills that each cover related review dimensions.

Skills: `security-audit` / `rust-deep` (Rust Ownership, Lifetimes & Concurrency) / `performance-review` (Performance) / `api-review` (API Design & Documentation) / `test-coverage` (Testing & Observability)

### 2. Bash tools

The tools are split into two categories: `readonly` and `writable`.

For Safety only readonly bash tools like `cat` and `grep` are allowed.

#### 2.1 Read-only bash tools

```js
// ---------------------------------------------------------------------------
// Bash Tool — read-only sandbox
// ---------------------------------------------------------------------------

/// Allowed bash commands (read-only).
/// Following the just-bash insight: bash IS the universal tool interface.
/// But we restrict to read-only commands for safety.
const ALLOWED_COMMANDS = [
    "cat", "head", "tail", "wc", "grep", "rg", "find", "ls", "tree",
    "file", "stat", "diff", "sort", "uniq", "cut", "awk", "sed",
    "echo", "printf", "tr", "tee", "xargs", "basename", "dirname",
    "realpath", "readlink",
];
```

#### 2.2 Writable or side-effecting bash tools

```js
/// Commands that are explicitly forbidden.
const BLOCKED_COMMANDS = [
    "rm", "mv", "cp", "mkdir", "rmdir", "chmod", "chown", "chgrp",
    "dd", "mkfs", "mount", "umount", "kill", "pkill", "shutdown",
    "reboot", "curl", "wget", "ssh", "scp", "rsync",
    "apt", "yum", "brew", "pip", "npm", "cargo",
    "python", "node", "ruby", "perl", "bash", "sh", "zsh",
];
```

#### 2.3 Shell meta characters

And Shell meta characters that indicate command chaining or injection.

We block these to prevent `cat file; rm -rf /` style attacks.

```js
const SHELL_METACHARACTERS = [';', '|', '&', '`', '$', '(', ')', '{', '}'];
```

Then Execute a bash command in a read-only sandbox.

**Security**: instead of `sh -c` (which interprets shell metacharacters),
we parse the command into program + args and execute directly.
Shell metacharacters are blocked entirely.

Unlike the original Rust repository, this implementation permits pipe (`|`) commands, but only for commands on the allowlist.

For instance, `grep -rn 'console.log' src/llm.mjs | head -20` is rejected in the original but accepted here.

This is because both `grep` and `head` are read-only operations. More importantly, pipe chains are a frequent pattern in LLM-generated responses.

#### 2.4 Execute command using `tinyexec` and `args-tokenizer`

> After a long journey, we've finally made it to running bash commands.

We parse the command into program + args using `args-tokenizer` and execute using `tinyexec`.

##### Why `args-tokenizer`?

`command.trim().split(/\s+/)` works for simple cases, but breaks once you need quotes or spaces in arguments (Refer to test case in src/tools.mjs).

> Use `args-tokenizer` to split command string into `[command, ...args]`.

```js
import { tokenizeArgs } from "args-tokenizer"

/**
 * `command.trim().split(/\s+/)` is not good enough because it doesn't handle quotes and space in arg properly.
 * @param {string} command
 * @returns {{ tool_name: string | undefined, args: string[]}}
 */
function parse_command_and_args(command) {
  const [cmd, ...args] = tokenizeArgs(command)

  return { tool_name: cmd, args }
}
```

##### Why `tinyexec`?

> `tinyexec` is a tiny, fast, and easy-to-use Node.js child process library.

In the first version, I used native `child_process.spawn`, but the code became more cumbersome and complex when piping commands (`|`) were introduced.

```js

/** @typedef {Parameters<typeof spawn>} SpawnParams */

/**
 *
 * @type {(command: SpawnParams[0], options?: SpawnParams[2]) => Promise<{ stdout: string, stderr: string, exitCode: number | undefined }>}
 */
async function spawnAsync(command, options = {}) {
  const [firstCmd, ...rest] = parsePipeCommands(command)
  const optionsWithThrowOnError = { ...options, throwOnError: true }

  // use pipe to run the commands
  const proc1 = exec(
    // @ts-expect-error
    firstCmd?.tool_name,
    firstCmd?.args,
    optionsWithThrowOnError,
  )

  let proc = proc1
  for (const cmd of rest) {
    proc = proc.pipe(
      // @ts-expect-error
      cmd.tool_name,
      cmd.args,
      optionsWithThrowOnError,
    )
  }

  const result = await proc

  return result

  // return new Promise((resolve, reject) => {
  //   const child = spawn(command, args, options)
  //   let stdout = ""
  //   let stderr = ""

  //   // 收集标准输出
  //   // @ts-expect-error
  //   child.stdout.on("data", (data) => {
  //     stdout += data.toString()
  //   })

  //   // 收集错误输出
  //   // @ts-expect-error
  //   child.stderr.on("data", (data) => {
  //     stderr += data.toString()
  //   })

  //   // 进程退出
  //   child.on("close", (code) => {
  //     if (code === 0) {
  //       resolve({ stdout, stderr, code })
  //     } else {
  //       reject({ stdout, stderr, code })
  //     }
  //   })

  //   // 进程出错（如命令不存在）
  //   child.on("error", (err) => {
  //     reject(err)
  //   })
  // })
}

/**
 *
 * @param {string} command
 * @returns {{ tool_name: string | undefined, args: string[]}[]}
 */
function parsePipeCommands(command) {
  const cmds = command.split(/\s*\|\s*/)

  return cmds.map((cmd) => {
    return parse_command_and_args(cmd)
  })
}
```

And both the two package is zero dependencies and lightweight comparing to `execa` or `nano-spawn`.

### 3. Rust Pattern in JavaScript

- In-source code testing
- Rust pattern helpers in JavaScript src/utils/rust-patterns/
