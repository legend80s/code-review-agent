import type { RetryConfig } from "./resilience.type.js"
import type { IToolConfig } from "./tools.type.js"
import type { u32, usize } from "./type.js"

/// Configuration for a review session.
export type IReviewConfig = {
  max_tokens: usize
  max_file_tokens: usize
  /// Maximum depth for cross-file follow-up (0 = no follow-up, 1 = one hop).
  max_related_depth: usize
  /// Maximum number of tool calls per file (prevents runaway loops).
  max_tool_calls: usize
  retry_config: RetryConfig
  circuit_breaker_threshold: u32
  tool_config: IToolConfig
}
