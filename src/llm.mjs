/**
 * @import { LlmBackend, LlmResponse, ITokenUsage } from './llm.type.js'
 */

import { Err, Ok, Result } from "./utils/rust-patterns/result.mjs"

export class TokenUsage {
  input_tokens = 0
  output_tokens = 0

  /**
   *
   * @param {ITokenUsage} params
   */
  constructor(params) {
    this.input_tokens = params.input_tokens
    this.output_tokens = params.output_tokens
  }
  /**
   *
   * @returns {TokenUsage}
   */
  static default() {
    return new TokenUsage({
      input_tokens: 0,
      output_tokens: 0,
    })
  }

  /// Total tokens (input + output), or 0 if unknown.
  /**
   * @returns {import('./type.js').u64}
   */
  total() {
    return this.input_tokens + this.output_tokens
  }
}

/**
 * Uses `cc_sdk::llm::query()` - routes through Claude Code subscription.
 * No ANTHROPIC_API_KEY needed.
 * @implements {LlmBackend}
 */
export class CcSdkBackend {
  /**
   * Send a single-turn completion request using cc-sdk.
   * @param {string} system - System prompt
   * @param {string} user - User prompt
   * @returns {Promise<Result<LlmResponse | null>>}
   */
  async complete(system, user) {
    try {
      const options = {
        systemPrompt: system,
      }

      const response = await this.#queryLlm(user, options)

      return Ok({
        text: response.text,
        usage: TokenUsage.default(),
      })
    } catch (error) {
      const contextError = new Error(
        // @ts-expect-error
        `cc-sdk LLM Proxy query failed: ${error.message}`,
      )
      contextError.cause = error

      return Err(contextError)
    }
  }

  /**
   * Internal method to query LLM
   * @param {string} user
   * @param {Object} options
   * @param {string} options.systemPrompt
   * @returns {Promise<{text: string}>}
   */
  async #queryLlm(user, options) {
    console.log("user, options:", user, options)
    // Implement actual LLM query here
    // This is a placeholder
    return {
      text: `Response to: ${user}`,
    }
  }
}
