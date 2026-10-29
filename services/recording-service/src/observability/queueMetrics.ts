// services/recording-service/src/observability/queueMetrics.ts

import type { Queue } from 'bullmq';
import client from 'prom-client';
import { register } from './metrics.js';

/** Job states we expose. "completed" is left out: it only grows and is not useful as a gauge. */
const STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/** Queues registered for metrics. */
const queues: Queue[] = [];

/** Number of jobs per queue and state, read from Redis at scrape time. */
export const bullmqJobs = new client.Gauge({
  name: 'bullmq_jobs',
  help: 'BullMQ jobs by queue and state',
  labelNames: ['queue', 'state'] as const,
  registers: [register],
  async collect() {
    this.reset(); // remove stale label sets (for example a removed queue)
    for (const queue of queues) {
      try {
        const counts = await queue.getJobCounts(...STATES);
        for (const state of STATES) {
          this.set({ queue: queue.name, state }, counts[state] ?? 0);
        }
      } catch {
        // Redis is down: skip this queue. The ServiceDown / Redis alerts cover that case.
      }
    }
  },
});

/**
 * Registers BullMQ queues so their job counts are exposed on /metrics.
 *
 * @param newQueues - queue objects, for example [emailQueue] or [finalizeQueue, autoStopQueue]
 * @returns nothing
 * @throws {Error} never.
 */
export function registerQueueMetrics(newQueues: Queue[]): void {
  queues.push(...newQueues);
}

