// @ts-check
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import biomeJson from "../biome.json" with { type: "json" }

function main() {
  modifyBiome()
}

main()

function modifyBiome() {
  // Modify biome.json here
  const updatedMsgs = []

  if (biomeJson.formatter.indentStyle !== "space") {
    updatedMsgs.push(
      `formatter.indentStyle from ${biomeJson.formatter.indentStyle} to "space"`,
    )
    biomeJson.formatter.indentStyle = "space"
  }

  if (biomeJson.linter.rules.style?.useBlockStatements !== "warn") {
    updatedMsgs.push(
      `linter.rules.style.useBlockStatements from ${biomeJson.linter.rules.style?.useBlockStatements} to "warn"`,
    )

    if (!biomeJson.linter.rules.style) {
      // @ts-expect-error
      biomeJson.linter.rules.style = {}
    }

    biomeJson.linter.rules.style.useBlockStatements = "warn"
  }

  if (biomeJson.javascript.formatter.semicolons !== "asNeeded") {
    updatedMsgs.push(
      `biomeJson.javascript.formatter.semicolons from ${biomeJson.javascript.formatter.semicolons} to "asNeeded"`,
    )
    biomeJson.javascript.formatter.semicolons = "asNeeded"
  }

  // console.log("biomeJson:", biomeJson)

  if (!updatedMsgs.length) {
    console.log("No changes made to biome.json")

    return
  }

  // console.log("updatedMsgs:", updatedMsgs);

  console.log(
    "Updated biome.json with",
    updatedMsgs.length,
    `changes:
${updatedMsgs.map((msg) => `— ${msg}`).join("\n")}`,
  )

  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const biomeJsonPath = path.resolve(__dirname, "../biome.json")

  const indent = readFileSync(biomeJsonPath).includes("\t") ? "\t" : 2

  writeFileSync(biomeJsonPath, `${JSON.stringify(biomeJson, null, indent)}\n`)
}
