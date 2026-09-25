/** Postgres SQLSTATE of a rejected query (23514 check, 23503 FK, 23505 unique, 42501 privilege), or undefined if it succeeded. */
export async function pgErrorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
    return undefined
  }
  catch (e) {
    // Drizzle wraps driver errors; the Postgres code is on the error or its cause.
    const err = e as { code?: string, cause?: { code?: string } }
    return err.cause?.code ?? err.code
  }
}
