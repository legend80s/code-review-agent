/**
 *
 * @param {unknown} obj
 * @returns {obj is Record<string, unknown>}
 */
export function isPlainObject(obj) {
  return typeof obj === "object" && obj !== null && obj.constructor === Object
}

/**
 *
 * @param {string} text
 * @returns {string[]}
 */
export function lines(text) {
  return text.split(/\r?\n/)
}

/**
 *
 * @param {string} str
 * @param {string} prefix
 * @return {string | null} return the string without the prefix if it starts with it, otherwise `null`
 */
export function strip_prefix(str, prefix) {
  return str.startsWith(prefix) ? str.slice(prefix.length) : null
}
