import { SFU_SERVICE_URL, INTERNAL_SECRET } from './env.js';
import AppError from '../utils/AppError.js';

/**
 * sfuClient.ts
 *
 * STEP 1: request() is the only place that talks to the SFU.
 *         It adds the x-internal-secret header and a 5 second timeout.
 *
 * STEP 2: A network error or timeout becomes AppError 503
 *         ("SFU service unreachable"). Signaling never crashes
 *         because the SFU is down.
 *
 * STEP 3: A non-2xx answer becomes an AppError with the SFU's own
 *         status and message (400, 404, 409...), so the browser sees
 *         the real reason.
 *
 * STEP 4: On success, return json.data. The SFU always answers
 *         { success: true, data }.
 *
 * STEP 5: One small function per SFU endpoint, so handlers never
 *         build URLs by hand.
 */

// STEP 1
async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;

    try {
        res = await fetch(`${SFU_SERVICE_URL}/api/v1/sfu${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': INTERNAL_SECRET,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
        });
    } catch {
        // STEP 2
        throw new AppError('SFU service unreachable', 503);
    }

    let json: any = null;
    try {
        json = await res.json();
    } catch {
        // empty or non-JSON body, handled below
    }

    // STEP 3
    if (!res.ok || !json?.success) {
        throw new AppError(json?.message ?? `SFU error ${res.status}`, res.status || 502);
    }

    // STEP 4
    return json.data as T;
}

// STEP 5
const enc = encodeURIComponent;

export function getRouterCapabilities(roomId: string) {
    return request<{ routerRtpCapabilities: unknown }>('GET', `/router-capabilities/${enc(roomId)}`);
}

export function createTransport(roomId: string, peerId: string, direction: string) {
    return request<{ id: string; iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown }>(
        'POST', '/transports', { roomId, peerId, direction },
    );
}

export function connectTransport(roomId: string, peerId: string, transportId: string, dtlsParameters: unknown) {
    return request<{ connected: boolean }>(
        'POST', '/transports/connect', { roomId, peerId, transportId, dtlsParameters },
    );
}

export function produce(
    roomId: string, peerId: string, transportId: string,
    kind: string, rtpParameters: unknown, source: string,
) {
    return request<{ producerId: string }>(
        'POST', '/produce', { roomId, peerId, transportId, kind, rtpParameters, source },
    );
}

export function listProducers(roomId: string, exceptPeerId: string) {
    return request<{ producerId: string; peerId: string; kind: string; source: string }[]>(
        'GET', `/producers/${enc(roomId)}?exceptPeerId=${enc(exceptPeerId)}`,
    );
}

export function consume(roomId: string, peerId: string, producerId: string, rtpCapabilities: unknown) {
    return request<{ id: string; producerId: string; peerId: string; kind: string; source: string; rtpParameters: unknown }>(
        'POST', '/consume', { roomId, peerId, producerId, rtpCapabilities },
    );
}

export function resumeConsumer(roomId: string, peerId: string, consumerId: string) {
    return request<{ resumed: boolean }>('POST', '/consumer/resume', { roomId, peerId, consumerId });
}

export function leavePeer(roomId: string, peerId: string) {
    return request<{ closedProducerIds: string[]; roomClosed: boolean }>(
        'POST', '/peers/leave', { roomId, peerId },
    );
}