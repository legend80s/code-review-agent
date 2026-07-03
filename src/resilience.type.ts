import type { u32, u64 } from "./type.js"

export type RetryConfig = {
  /// Maximum number of retry attempts (0 means no retries, just the initial attempt).
  max_retries: u32
  /// Base delay in milliseconds before the first retry.
  base_delay_ms: u64
}
