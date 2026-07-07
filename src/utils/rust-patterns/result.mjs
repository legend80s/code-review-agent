// rust-patterns.mjs

/**
 * @template T
 */
export class Result {
  /**
   * @param {boolean} isOk
   * @param {T} value
   * @param {Error | null} error
   */
  constructor(isOk, value, error) {
    this.isOk = isOk
    this.isErr = !isOk
    this.value = value
    this.error = error
  }

  /**
   * @template T
   * @param {T} value
   */
  static ok(value) {
    return new Result(true, value, null)
  }

  /**
   * @param {Error} error
   */
  static err(error) {
    return new Result(false, null, error)
  }

  /**
   *
   * @param {string} contextMsg
   * @returns {Result<T> | Result<null>}
   */
  context(contextMsg) {
    if (this.isErr) {
      const error = this.error ?? new Error("Nil error")
      const newError = new Error(`${contextMsg}: ${error.message}`)
      newError.cause = error
      return Result.err(newError)
    }

    return this
  }

  /**
   *
   * @returns {NonNullable<T>}
   */
  unwrap() {
    if (this.isErr) {
      throw this.error
    }
    // @ts-expect-error
    return this.value
  }
}

/**
 * @template T
 * @param {T} value
 * @returns
 */
export function Ok(value) {
  return Result.ok(value)
}

/**
 *
 * @param {Error} error
 * @returns
 */
export function Err(error) {
  return Result.err(error)
}

/**
 * 捕获异常并返回 Result
 * @template T
 * @param {() => T} fn
 */
export function tryCatch(fn) {
  try {
    return Result.ok(fn())
  } catch (error) {
    // @ts-expect-error
    return Result.err(error)
  }
}

/**
 * 捕获异常并返回 Result
 * @template T
 * @param {() => T} fn
 */
export async function tryCatchAsync(fn) {
  try {
    return Result.ok(await fn())
  } catch (error) {
    // @ts-expect-error
    return Result.err(error)
  }
}
