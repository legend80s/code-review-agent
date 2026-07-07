import { parseArgs } from "node:util"

import * as agent from "./agent.mjs"
import { OutputFormat } from "./cli.mjs"
import { CcSdkBackend } from "./llm.mjs"
import { info } from "./utils/rust-patterns/logger.mjs"

// Usage node src/main.mjs --diff /tmp/new-code-review.diff

async function main() {
  const { values } = parseArgs({
    options: {
      diff: {
        type: "string",
        short: "d",
        description: "Path to a unified diff file to review (CLI mode).",
      },

      max_tokens: {
        default: "50_000",
        type: "string",
        short: "m",
        description: "Total token budget for the review session.",
      },
      max_file_tokens: {
        type: "string",
        short: "f",
        default: "5_000",
        description: "Per-file token budget.",
      },

      output_format: {
        type: "string",
        short: "o",
        default: "json",
        description: "Output format (markdown | json).",
      },
    },

    strict: true,
  })
  const cli = values
  // --- CLI mode ---
  const diff_path =
    cli.diff ||
    (() => {
      throw new TypeError("--diff is required in CLI mode")
    })()

  info("review_started:", {
    diff: cli.diff,
    max_tokens: cli.max_tokens,
    max_file_tokens: cli.max_file_tokens,
    // backend: ?cli.backend,
    output_format: cli.output_format,
  })
  // return

  /**
   * @type {import('./cli.type.js').ICliOptions}
   */
  const cliOptions = {
    ...values,
    max_tokens: Number(cli.max_tokens),
    max_file_tokens: Number(cli.max_file_tokens),
    output_format: cli.output_format === "json" ? "json" : "markdown",
  }

  /**
   * @type {import('./agent.type.js').IReviewConfig}
   */
  const config = {
    ...agent.ReviewConfig.default(),
    max_tokens: cliOptions.max_tokens,
    max_file_tokens: cliOptions.max_file_tokens,
  }

  const backend = new CcSdkBackend()

  // Run the agent loop
  const report = (await agent.run_review(diff_path, config, backend)).unwrap()

  info("review_completed:", { summary: report.summary_line() })

  // Format and output
  // switch (key) {
  //   case value:
  //     break

  //   default:
  //     break
  // }
  /** @type {string} */
  const output = (() => {
    switch (cli.output_format) {
      case OutputFormat.Markdown: {
        return report.to_markdown()
      }

      case OutputFormat.Json: {
        return report.to_json().context("Failed to serialize report").unwrap()
      }

      default: {
        throw new Error(`Unknown output format: ${cli.output_format}`)
      }
    }
  })()

  console.log(`${output}`)
}

main()
