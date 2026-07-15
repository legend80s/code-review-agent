import type { Option, u64, usize } from "./type.js"

// #[derive(Debug, Clone, Serialize)]
export type IToolResult = {
  tool: string
  success: boolean
  output: string
}

/// Configuration for tool execution.
export type IToolConfig = {
  /// Working directory for bash commands.
  cwd: Option<string>
  /// Maximum output size in bytes (prevent runaway commands).
  max_output_bytes: usize
  /// Timeout in seconds for each tool invocation.
  timeout_secs: u64
}

/// A skill is a specialized analysis prompt template that the Agent can invoke.
///
/// Unlike Claude Code's skills (which are external), these are self-contained:
/// the Agent loads the skill's prompt, sends it to the current LLM backend
/// with the relevant context, and gets back specialized analysis.
export type ISkill = {
  name: string
  description: string
  /// The system prompt override for this skill.
  system_prompt: string
}
