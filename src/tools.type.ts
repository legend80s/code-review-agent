import type { Option, u64, usize } from "./type.js"

/// Configuration for tool execution.
export type IToolConfig = {
  /// Working directory for bash commands.
  cwd: Option<string>
  /// Maximum output size in bytes (prevent runaway commands).
  max_output_bytes: usize
  /// Timeout in seconds for each tool invocation.
  timeout_secs: u64
}
