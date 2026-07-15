// examples/code-review-agent/src/resilience.rs:34-68

/** @import { RetryConfig } from './resilience.type.js' */
/** @import { int, u32, u64 } from './type.js' */

/**
 * Maximum cap for backoff delay (30 seconds).
 * @type {u64}
 */
const MAX_BACKOFF_MS = 30_000

/**
 * Execute an async operation with retry and exponential backoff.
 *
 * The operation is called up to `1 + config.max_retries` times.
 * Delay between attempts: `base_delay_ms * 2^attempt`, capped at 30 seconds.
 * @template T
 * @param {RetryConfig} config
 * @param {() => Promise<T>} operation
 * @returns {Promise<[null, T] | [Error, null]>}
 */
export async function with_retry(config, operation) {
  // Option<anyhow::Error>
  let last_error = null

  for (let attempt = 0; attempt <= config.max_retries; attempt++) {
    try {
      const value = await operation()

      if (attempt > 0) {
        console.debug(attempt, "Operation succeeded after retry")
      }

      return [null, value]
    } catch (error) {
      if (attempt < config.max_retries) {
        const delay_ms = Math.min(
          MAX_BACKOFF_MS,
          config.base_delay_ms * Math.pow(2, attempt),
        )

        console.warn("Operation failed, retrying", {
          attempt,
          max_retries: config.max_retries,
          delay_ms,
          // @ts-expect-error
          error: error.message || error,
        })

        await sleep(delay_ms)
      }
      last_error = error
    }
  }

  return [
    // @ts-expect-error
    last_error || new Error("retry loop completed with no attempts"),
    null,
  ]
}

export class CircuitBreaker {
  /**
   *
   * @param {u32} max_failures
   * @param {u32} failures
   */
  constructor(max_failures, failures) {
    this.max_failures = max_failures
    this.failures = failures
  }

  /**
   * /// Create a new circuit breaker with the given failure threshold.
    /// `max_failures` must be >= 1 (clamped to 1 if 0 is passed).  
   * @param {u32} max_failures
   * @returns
   */
  static new(max_failures) {
    return new CircuitBreaker(Math.max(1, max_failures), 0)
  }

  /**
   * Check whether the circuit is closed (healthy).
   * @returns {boolean} Returns `true` if operations should proceed, `false` if the circuit is open.
   */
  check() {
    return this.failures < this.max_failures
  }

  /// Record a failure, incrementing the counter toward the threshold.
  ///
  /// Uses `fetch_update` with saturating add to prevent u32 overflow.
  /// Only logs the "tripped" warning on the exact transition (prev < threshold,
  /// new >= threshold), avoiding spurious warnings on repeated failures.
  record_failure() {
    const prev = this.failures
    this.failures += 1

    const newCount = prev + 1
    // Only warn on the exact threshold crossing, not on every subsequent failure.
    if (newCount >= this.max_failures && prev < this.max_failures) {
      console.warn("Circuit breaker tripped — circuit is now OPEN", {
        failures: newCount,
        threshold: this.max_failures,
      })
    }
  }

  /// Record a success, resetting the failure counter to zero.
  record_success() {
    this.failures = 0
  }

  /// Current failure count.
  // #[cfg(test)]
  /**
   * @returns {u32}
   */
  failure_count() {
    return this.failures
  }
}

/**
 *
 * @param {int} ms
 * @returns
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
