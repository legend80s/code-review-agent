import { styleText } from "node:util"
import { isPlainObject } from "../lite-lodash.mjs"

const debugging = true

/**
 *
 * @param  {...unknown} args
 */
export function info(...args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const suffix = i === args.length - 1 ? "" : " "

    if (isPlainObject(arg)) {
      // to key: value format
      for (const [key, value] of Object.entries(arg)) {
        process.stdout.write(
          `${key}=${styleText(
            "green",
            // @ts-expect-error
            value,
          )} `,
        )
      }
    } else {
      process.stdout.write(arg + suffix)
    }
  }
  // console.info(...args)
}

/** @param  {...unknown} args */
export function debug(...args) {
  if (debugging) {
    info(...args)
  }
}

/** @param  {...unknown} args */
export function warn(...args) {
  return info(...args)
}

/**
 * 执行函数并捕获异常，添加上下文后重新抛出
 * @template T
 * @param {() => T} fn - 可能抛出异常的函数
 * @param {string} contextMsg
 * @returns {T}
 * @throws {Error}
 */
export function withContext(fn, contextMsg) {
  try {
    return fn()
  } catch (error) {
    const newError = new Error(`${contextMsg}: ${error.message}`)
    newError.cause = error
    throw newError
  }
}
