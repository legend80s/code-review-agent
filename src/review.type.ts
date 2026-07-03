export type AgentAction =
  | { type: "Done" }
  | { type: "ReviewRelated"; file: string; reason: string }
  | { type: "UseTool"; tool: string; input: string; reason: string }
