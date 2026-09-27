// Body validation with the shared Zod schemas: 400 with the issues' i18n keys (never echoing input values).
import { createError, getQuery, readBody, type H3Event } from 'h3'
import type { z } from 'zod'

export async function readValidated<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  const body = await readBody(event).catch(() => undefined)
  return parseOr400(schema, body)
}

/** Same for the query string. */
export function readValidatedQuery<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  return parseOr400(schema, getQuery(event))
}

function parseOr400<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { reason: 'invalid', issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
    })
  }
  return result.data
}
