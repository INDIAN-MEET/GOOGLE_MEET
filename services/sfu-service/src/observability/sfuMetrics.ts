// services/sfu-service/src/observability/sfuMetrics.ts

import client from 'prom-client';
import { register } from './metrics.js';

/**
 * Snapshot of the SFU's in-memory objects.
 */
export interface SfuStats {
  /** Number of mediasoup workers (normally one per CPU core). */
  workers: number;
  /** Number of mediasoup routers (one per active room). */
  routers: number;
  /** Number of WebRTC transports (send + receive). */
  transports: number;
  /** Number of producers (published tracks). */
  producers: number;
  /** Number of consumers (forwarded tracks). */
  consumers: number;
}

/** Function that counts the SFU's current objects. */
export type SfuStatsProvider = () => SfuStats;

/** Provider set by registerSfuStatsProvider. Undefined until the SFU is ready. */
let provider: SfuStatsProvider | undefined;

/**
 * Creates one gauge whose value is read from the provider at scrape time.
 *
 * @param name - Prometheus metric name
 * @param help - help text
 * @param key - which SfuStats field to expose
 * @returns the created gauge
 * @throws {Error} never. A failing provider yields no sample for that scrape.
 */
function makeGauge(name: string, help: string, key: keyof SfuStats): client.Gauge {
  return new client.Gauge({
    name,
    help,
    registers: [register],
    collect() {
      if (provider === undefined) return;
      try {
        this.set(provider()[key]);
      } catch {
        // A broken stats function must not break the whole /metrics response.
      }
    },
  });
}

makeGauge('sfu_workers', 'mediasoup workers', 'workers');
makeGauge('sfu_routers', 'mediasoup routers (active rooms)', 'routers');
makeGauge('sfu_transports', 'mediasoup WebRTC transports', 'transports');
makeGauge('sfu_producers', 'mediasoup producers', 'producers');
makeGauge('sfu_consumers', 'mediasoup consumers', 'consumers');

/**
 * Tells the metrics module how to count the SFU's objects.
 *
 * @param statsProvider - function returning current counts
 * @returns nothing
 * @throws {Error} never.
 */
export function registerSfuStatsProvider(statsProvider: SfuStatsProvider): void {
  provider = statsProvider;
}

