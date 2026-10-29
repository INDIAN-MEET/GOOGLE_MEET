// shared/observability/config.ts
// Copied into services/<name>/src/observability/config.ts by Step 13.6.

/**
 * Validated observability settings for one service process.
 */
export interface ObservabilityConfig {
  /** Name used in Jaeger and error messages. */
  serviceName: string;
  /** Runtime environment, for example "development" or "production". */
  nodeEnv: string;
  /** True when GET /metrics should answer. */
  metricsEnabled: boolean;
  /** Bearer token required by GET /metrics, or undefined when no token is set. */
  metricsToken: string | undefined;
  /** True when OpenTelemetry tracing should start. */
  otelEnabled: boolean;
  /** Base URL of the OTLP/HTTP collector, without /v1/traces. */
  otlpEndpoint: string | undefined;
}

/**
 * Reads a true/false environment variable.
 *
 * @param name - environment variable name
 * @param fallback - value used when the variable is missing or empty
 * @returns the parsed boolean
 * @throws {Error} when the value is set but is not exactly "true" or "false"
 */
function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Strict on purpose: "1", "yes" or "True" are easy typos that silently disable security.
  throw new Error(`[observability] ${name} must be "true" or "false" but got "${raw}".`);
}

/**
 * Reads and validates all observability environment variables.
 *
 * @returns a validated, read-only configuration object
 * @throws {Error} when a required variable is missing or has an invalid value
 */
export function loadObservabilityConfig(): ObservabilityConfig {
  const serviceName = (process.env.OTEL_SERVICE_NAME ?? '').trim();
  if (serviceName === '') {
    throw new Error(
      '[observability] OTEL_SERVICE_NAME is required (for example "auth-service"). ' +
        'For local runs start the service with: tsx watch --env-file=.env server.ts',
    );
  }

  const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();
  const metricsEnabled = readBoolean('METRICS_ENABLED', true);
  const otelEnabled = readBoolean('OTEL_ENABLED', false);

  const rawToken = (process.env.METRICS_TOKEN ?? '').trim();
  const metricsToken = rawToken === '' ? undefined : rawToken;

  // In production an open /metrics endpoint leaks route names, memory use and queue sizes.
  if (nodeEnv === 'production' && metricsEnabled) {
    if (metricsToken === undefined || metricsToken.length < 16) {
      throw new Error(
        '[observability] METRICS_TOKEN must be set and at least 16 characters when NODE_ENV=production ' +
          'and METRICS_ENABLED=true.',
      );
    }
  }

  const rawEndpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').trim();
  let otlpEndpoint: string | undefined;
  if (otelEnabled) {
    if (rawEndpoint === '') {
      throw new Error('[observability] OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_ENABLED=true.');
    }
    try {
      // Remove a trailing slash so we can safely append "/v1/traces" later.
      otlpEndpoint = new URL(rawEndpoint).toString().replace(/\/$/, '');
    } catch {
      throw new Error(`[observability] OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL: "${rawEndpoint}".`);
    }
  }

  return { serviceName, nodeEnv, metricsEnabled, metricsToken, otelEnabled, otlpEndpoint };
}

/** Singleton configuration. Loaded once when the module is first imported. */
export const observabilityConfig: ObservabilityConfig = Object.freeze(loadObservabilityConfig());