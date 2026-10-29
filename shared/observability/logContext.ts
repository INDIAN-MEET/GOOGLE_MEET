// shared/observability/logContext.ts
// Copied into services/<name>/src/observability/logContext.ts by Step 13.6.

import { trace } from '@opentelemetry/api';

/**
 * Pino "mixin" that adds the active trace and span IDs to every log line.
 * Returns an empty object when there is no active span (for example at startup).
 *
 * @returns extra fields to merge into the log line
 * @throws {Error} never.
 */
export function traceMixin(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (span === undefined) return {};
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

