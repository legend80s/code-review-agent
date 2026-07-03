import { parseArgs } from "node:util"

function main(params) {
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

  info("review_started  ", {
    diff: cli.diff,
    max_tokens: cli.max_tokens,
    max_file_tokens: cli.max_file_tokens,
    // backend: ?cli.backend,
    output_format: cli.output_format,
  })
}

main()

/**
 *
 * @param  {...unknown} args
 */
function info(...args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const suffix = i === args.length - 1 ? "" : " "

    if (isPlainObject(arg)) {
      // to key: value format
      for (const [key, value] of Object.entries(arg)) {
        process.stdout.write(`${key}=${value} `)
      }
    } else {
      process.stdout.write(arg + suffix)
    }
  }
  // console.info(...args)
}

/**
 *
 * @param {unknown} obj
 * @returns {obj is Record<string, unknown>}
 */
function isPlainObject(obj) {
  return typeof obj === "object" && obj !== null && obj.constructor === Object
}
