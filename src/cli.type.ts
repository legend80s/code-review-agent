import type { OutputFormat } from "./cli.mjs"

export type ICliOptions = {
  diff?: string
  max_tokens: number
  max_file_tokens: number
  output_format: IOutputFormat
}

type IOutputFormat = (typeof OutputFormat)[keyof typeof OutputFormat]
