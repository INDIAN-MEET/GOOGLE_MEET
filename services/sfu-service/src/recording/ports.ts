import { env } from '../config/env.ts';

/**
 * ports.ts
 *
 * Purpose: FFmpeg needs one free UDP port per track it listens on.
 *          This file is the "parking lot" that hands ports out and takes them back.
 *
 * STEP 1: Keep a Set of ports currently in use. Ports come from
 *         recordingRtpMin .. recordingRtpMax (default 50000..50200).
 *         This range must NOT overlap RTC_MIN_PORT .. RTC_MAX_PORT (mediasoup).
 *
 * STEP 2: Hand out EVEN ports only (50000, 50002, ...). Some FFmpeg versions also
 *         open "port + 1" for RTCP, so the odd ports stay free on purpose.
 *
 * STEP 3: allocPort() returns the first free port, or throws when the pool is empty.
 *
 * STEP 4: freePort() puts a port back. Calling it twice is harmless.
 *
 * STEP 5: portsInUse() is a helper for tests ("are all ports freed after stop?").
 */

// STEP 1: ports that are currently taken
const used = new Set<number>()

// STEP 2: if the configured minimum is odd, move up by one so we start on an even port
const start =
    env.recordingRtpMin % 2 === 0 ? env.recordingRtpMin : env.recordingRtpMin + 1;


// STEP 3: walk the range two at a time and take the first free port
export function allocPort(): number {
    for (let port = start; port <= env.recordingRtpMax; port += 2) {
        if (!used.has(port)) {
            used.add(port);
            return port;
        }
    }
    throw new Error('No free recording RTP port');
}

// STEP 4: give a port back (Set.delete on a missing item does nothing, so this is idempotent)
export function freePort(port: number): void {
    used.delete(port)
}

// STEP 5: how many ports are taken right now (used by tests)
export function portsInUse(): number {
    return used.size
}



