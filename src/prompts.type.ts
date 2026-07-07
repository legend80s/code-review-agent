/** Metadata about the pull request or change set being reviewed. */
export type IPrInfo = {
  /** Title or summary of the change (e.g., commit message first line). */
  title: string
  /** List of changed file paths. */
  changedFiles: string[]
}
