import * as mediasoup from 'mediasoup';
import { env } from './env.ts';

const workerSetting: mediasoup.types.WorkerSettings = {
    logLevel: 'warn',
    rtcMinPort: env.rtcMinPort,
    rtcMaxPort: env.rtcMaxPort,
}


const mediaCodecs: mediasoup.types.RouterRtpCodecCapability[] = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: { 'x-google-start-bitrate': 1000 },
    },
    {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
        },
    },
]

const listenInfos: mediasoup.types.TransportListenInfo[] = [
  { protocol: 'udp', ip: '0.0.0.0', announcedAddress: env.announcedIp },
  { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: env.announcedIp },
];


export const mediasoupConfig = {
  numWorkers: env.numWorkers,
  worker: workerSettings,
  router: { mediaCodecs },
  webRtcTransport: {
    listenInfos,
    initialAvailableOutgoingBitrate: 1_000_000,
  },
};


