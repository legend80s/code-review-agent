// examples/code-review-agent/src/tools.rs — 工具安全约束

export class ToolConfig {
  /** @param {import('./tools.type.js').IToolConfig} parameters  */
  constructor(parameters) {
    Object.assign(this, parameters)
  }

  /**
   *
   * @returns {import('./tools.type.js').IToolConfig}
   */
  static default() {
    return {
      cwd: null,
      max_output_bytes: 50_000,
      timeout_secs: 30,
    }
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
