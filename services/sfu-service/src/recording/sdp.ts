import type * as mediasoup from 'mediasoup';

/** One track that FFmpeg must listen to. */
export interface SdpMedia {
  kind: 'audio' | 'video';
  port: number;                                   // the UDP port FFmpeg will listen on
  rtpParameters: mediasoup.types.RtpParameters;   // taken from consumer.rtpParameters
}

/**
 * buildSdp(medias)
 *
 * Purpose: produce the tiny text file that tells FFmpeg
 *          "on port X you will receive codec Y with payload type Z".
 *
 * STEP 1: Write the session header. Everything stays on 127.0.0.1
 *         because FFmpeg runs in the same container as the SFU.
 *
 * STEP 2: Write one "m=" section per track (audio and/or video).
 *         "a=rtcp-mux" matches rtcpMux: true on our PlainTransport.
 *
 * STEP 3: Use the first codec that is NOT rtx. Its payload type, clock rate
 *         (and channel count for audio) must be exactly what mediasoup sends.
 *
 * STEP 4: Copy the codec parameters into "a=fmtp". H264 needs them to decode.
 *
 * Note: no a=sendonly / a=recvonly line on purpose. It adds risk and no benefit.
 */
export function buildSdp(medias: SdpMedia[]): string {
  // STEP 1: session header
  const lines = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=mediasoup-recording',
    'c=IN IP4 127.0.0.1',
    't=0 0',
  ];

  for (const m of medias) {
    // STEP 3: pick the real codec, skipping rtx
    const codec = m.rtpParameters.codecs.find((c:any) => !/\/rtx$/i.test(c.mimeType));
    if (!codec) throw new Error(`No usable codec for ${m.kind}`);

    const name = codec.mimeType.split('/')[1];   // "video/VP8" -> "VP8"
    const pt = codec.payloadType;
    // Only audio has a channel count (Opus = 2)
    const channels = m.kind === 'audio' && codec.channels ? `/${codec.channels}` : '';

    // STEP 2: media section
    lines.push(`m=${m.kind} ${m.port} RTP/AVP ${pt}`);
    lines.push('a=rtcp-mux');
    lines.push(`a=rtpmap:${pt} ${name}/${codec.clockRate}${channels}`);

    // STEP 4: codec parameters (only if there are any)
    const fmtp = Object.entries(codec.parameters ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    if (fmtp) lines.push(`a=fmtp:${pt} ${fmtp}`);
  }

  return lines.join('\n') + '\n';
}