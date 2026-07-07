import type { u64 } from "./type.js"
import type { Result } from "./utils/rust-patterns/result.mjs"

// /// Response from an LLM completion.
// // #[derive(Debug, Clone)]
// pub struct LlmResponse {
//     pub text: String,
//     pub usage: TokenUsage,
// }

// /// Trait for LLM backends. Intentionally minimal: single-turn, text-in/text-out.
// ///
// /// We use `&dyn LlmBackend` (trait object) for simplicity — the dynamic dispatch
// /// cost is negligible compared to LLM network latency. The return type is a boxed
// /// future to enable dyn-compatibility.
// pub trait LlmBackend: Send + Sync {
//     /// Send a single-turn completion request.
//     fn complete(
//         &self,
//         system: &str,
//         user: &str,
//     ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<LlmResponse>> + Send + '_>>;
// }

/**
 * Token usage reported by the backend (if available).
 */
export interface ITokenUsage {
  input_tokens: u64
  output_tokens: u64
}

/**
 * Response from an LLM completion.
 */
export interface LlmResponse {
  text: string
  usage: ITokenUsage
}

/**
 * LLM Backend trait - Intentionally minimal: single-turn, text-in/text-out.
 */
export interface LlmBackend {
  /**
   * Send a single-turn completion request.
   * @param system - System prompt
   * @param user - User prompt
   * @returns Promise with Result<LlmResponse, Error>
   */
  complete(system: string, user: string): Promise<Result<LlmResponse | null>>
}
