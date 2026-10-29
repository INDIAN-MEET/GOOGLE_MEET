// shared/observability/tracing.ts
// Copied into services/<name>/src/observability/tracing.ts by Step 13.6.
// MUST be the first import in server.ts so OpenTelemetry can patch libraries before they load.

import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { observabilityConfig } from './config.js';

/** Paths that must never create spans (noise). */
const IGNORED_PATH_PREFIXES = ['/metrics', '/health', '/ready'];

/**
 * Starts the OpenTelemetry SDK when OTEL_ENABLED=true.
 *
 * @returns the started SDK, or undefined when tracing is disabled
 * @throws {Error} never. A tracing failure is logged and the service keeps running.
 */
function startTracing(): NodeSDK | undefined {
  if (!observabilityConfig.otelEnabled || observabilityConfig.otlpEndpoint === undefined) {
    return undefined;
  }

  const sdk = new NodeSDK({
    serviceName: observabilityConfig.serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${observabilityConfig.otlpEndpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) =>
            IGNORED_PATH_PREFIXES.some((prefix) => (req.url ?? '').startsWith(prefix)),
        },
      }),
    ],
  });

  try {
    sdk.start();
  } catch (error) {
    // Observability must never take the product down.
    console.error('[observability] OpenTelemetry failed to start:', error instanceof Error ? error.message : error);
    return undefined;
  }

  /**
   * Flushes pending spans when the process is asked to stop.
   * It does NOT call process.exit, because the service has its own graceful shutdown.
   *
   * @returns a promise that resolves when the flush is done or has failed
   * @throws {Error} never. Errors are swallowed on purpose during shutdown.
   */
  const flush = async (): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch {
      // Ignore: the collector may already be gone.
    }
  };
  process.once('SIGTERM', () => void flush());
  process.once('SIGINT', () => void flush());

  return sdk;
}

/** Exported so tests can check whether tracing started. */
export const tracingSdk: NodeSDK | undefined = startTracing();