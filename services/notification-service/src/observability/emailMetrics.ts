// services/notification-service/src/observability/emailMetrics.ts

import client from 'prom-client';
import { register } from './metrics.js';

/** Email jobs finished, by job name (invite / reminder) and result. */
export const emailJobsTotal = new client.Counter({
  name: 'notification_email_jobs_total',
  help: 'Email jobs finished by type and result',
  labelNames: ['type', 'result'] as const,
  registers: [register],
});

/**
 * Converts a BullMQ job name to a safe label value.
 *
 * @param jobName - the name of the BullMQ job
 * @returns "invite", "reminder" or "other"
 * @throws {Error} never.
 */
export function emailTypeLabel(jobName: string | undefined): 'invite' | 'reminder' | 'other' {
  const name = (jobName ?? '').toLowerCase();
  if (name.includes('invite')) return 'invite';
  if (name.includes('reminder')) return 'reminder';
  return 'other';
}

