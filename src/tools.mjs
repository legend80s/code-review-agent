// examples/code-review-agent/src/tools.rs — 工具安全约束
/**
 * restrict to read-only commands for safety.
 * @satisfies {string[]}
 */
const ALLOWED_COMMANDS = /** @type {const} */ ([
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
const BLOCKED_COMMANDS = /** @type {const} */ ([
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
