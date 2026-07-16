# Code Review Agent in JavaScript

The project is a code review agent that uses the DeepSeek API to generate code reviews.

It takes a diff file as input and outputs in json/markdown format with the generated reviews.

It is written in JavaScript and uses the Node.js runtime.

The original project is written in Rust.

Credit to https///github.com/ZhangHanDong/harness-engineering-from-cc-to-ai-coding which is a great starting point for this project.

## Usage

```bash
export DEEPSEEK_API_KEY=sk-your-api-key

node src/main.mjs --diff ./src.diff > review_log.md
```

## Features

### Skills

> Built-in skills — specialized review lenses.

Builtin skills and bash tools are also used by need during the review process. file: src/tools.mjs

Inspired by Anthropic's connect-rust rust-code-reviewer (16 categories), organized into focused skills that each cover related review dimensions.

Skills: `security-audit` / `rust-deep` (Rust Ownership, Lifetimes & Concurrency) / `performance-review` (Performance) / `api-review` (API Design & Documentation) / `test-coverage` (Testing & Observability)

### Bash tools

The tools are split into two categories: `readonly` and `writable`.

For Safety only readonly bash tools like `cat` and `grep` are allowed.

#### Read-only bash tools

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

#### Writable or side-effecting bash tools

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

#### Shell meta characters

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

### Rust pattern in js

- In-source code testing
- Rust pattern helpers in JavaScript src/utils/rust-patterns/
