/**
 * @import { LlmBackend, LlmResponse, ITokenUsage } from './llm.type.js'
 */

import OpenAI from "openai"
import { debug } from "./utils/rust-patterns/logger.mjs"
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
  /// Accumulate usage from another response.
  /**
   *
   * @param {ITokenUsage} other
   */
  accumulate(other) {
    this.input_tokens = (this.input_tokens ?? 0) + (other.input_tokens ?? 0)
    this.output_tokens = (this.output_tokens ?? 0) + (other.output_tokens ?? 0)
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
  constructor() {
    this.openai = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
    })
  }

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

      const { text, tokenUsage } = await this.#queryLlm(user, options)

      return Ok({
        text,
        usage: tokenUsage,
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
   * @returns {Promise<{text: string, tokenUsage: TokenUsage}>}
   */
  async #queryLlm(user, options) {
    debug("user:|", user, "|")
    debug("options:", "|", options, "|")
    // Implement actual LLM query here
    // This is a placeholder

    const stream = await this.openai.chat.completions.create({
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: user },
      ],
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      // thinking: { type: "enabled" },
      // reasoning_effort: "high",
      stream: true,
    })

    // console.log("completion:", completion.choices[0])

    // console.log("Answer:", completion.choices[0].message.content)

    let fullContent = ""
    let fullReasoningContent = ""

    let input_tokens = 0
    let output_tokens = 0

    for await (const event of stream) {
      if (event.usage) {
        input_tokens = event.usage.prompt_tokens
        output_tokens = event.usage.completion_tokens

        console.log(
          "prompt_cache_hit_tokens:",
          event.usage.prompt_cache_hit_tokens,
        )
        console.log(
          "prompt_cache_miss_tokens:",
          event.usage.prompt_cache_miss_tokens,
        )
      }
      // {
      //   id: '505b8bdf-d987-44c3-bcbd-a7e475ef0ef0',
      //   object: 'chat.completion.chunk',
      //   created: 1784115152,
      //   model: 'deepseek-v4-flash',
      //   system_fingerprint: 'fp_8b330d02d0_prod0820_fp8_kvcache_20260402',
      //   choices: [
      //     { index: 0, delta: [Object], logprobs: null, finish_reason: null }
      //   ]
      // }

      // {
      //   id: '505b8bdf-d987-44c3-bcbd-a7e475ef0ef0',
      //   object: 'chat.completion.chunk',
      //   created: 1784115152,
      //   model: 'deepseek-v4-flash',
      //   system_fingerprint: 'fp_8b330d02d0_prod0820_fp8_kvcache_20260402',
      //   choices: [
      //     {
      //       index: 0,
      //       delta: [Object],
      //       logprobs: null,
      //       finish_reason: 'stop'
      //     }
      //   ],
      //   usage: {
      //     prompt_tokens: 7,
      //     completion_tokens: 31,
      //     total_tokens: 38,
      //     prompt_tokens_details: { cached_tokens: 0 },
      //     completion_tokens_details: { reasoning_tokens: 23 },
      //     prompt_cache_hit_tokens: 0,
      //     prompt_cache_miss_tokens: 7
      //   }
      // }

      // { content: null, reasoning_content: ' straightforward' }
      // { content: 'The', reasoning_content: null }
      // { content: ' answer', reasoning_content: null }
      // { content: ' is', reasoning_content: null }
      // { content: ' ', reasoning_content: null }
      // { content: '2', reasoning_content: null }
      // { content: '.', reasoning_content: null }
      // { content: '', reasoning_content: null }
      // @ts-expect-error
      const { content, reasoning_content } = event.choices[0]?.delta ?? {}
      if (content) {
        fullContent += content
      }
      if (reasoning_content) {
        fullReasoningContent += reasoning_content
      }
      // console.log(event.choices[0]?.delta)
    }

    const fullReasoningContentInMarkdown = fullReasoningContent
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")

    return {
      text: `${fullReasoningContentInMarkdown}\n\n${fullContent}`,
      tokenUsage: new TokenUsage({
        input_tokens,
        output_tokens,
      }),
    }
  }
}

if (import.meta.main) {
  const backend = new CcSdkBackend()
  const result = (
    await backend.complete(
      "你是一个 Rust 代码转 Typescript 的专家",
      `
let command = "echo hello; world";
const SHELL_METACHARACTERS: &[char] = &[';', '|', '&', '$', '(', ')', '{', '}'];

let foo = command.contains(SHELL_METACHARACTERS)`,
    )
  ).unwrap()

  console.log("\n\ntext:", result.text)
  console.log("\nusage:", result.usage)
}
