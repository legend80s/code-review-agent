/// Severity level for a finding.
///
/// Accepts both title-case ("Critical") and lowercase ("critical") from LLM output.
// #[derive(Debug, Clone, PartialEq, Eq, Serialize)]

/**
 * @satisfies {Record<string, string>}
 */
export const Severity = /** @type {const} */ ({
  Critical: "Critical",
  Warning: "Warning",
  Info: "Info",
})
