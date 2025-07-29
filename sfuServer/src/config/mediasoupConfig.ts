import os from "os";
import * as mediasoup from "mediasoup";

export const config = {
  // Mediasoup settings
  mediasoup: {
    // Number of mediasoup workers to launch.
    numWorkers: os.cpus().length,
    // Mediasoup Worker settings.
    workerSettings: {
      logLevel: "warn" as "debug" | "warn" | "error" | "none", // Fix type
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp",
        "srtp",
        "rtcp",
      ] as mediasoup.types.WorkerLogTag[], // Fix type
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    },
    // Mediasoup Router settings.
    routerOptions: {
      mediaCodecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters: {
            "x-google-start-bitrate": 1000,
          },
        },
        {
          kind: "video",
          mimeType: "video/h264",
          clockRate: 90000,
          parameters: {
            "packetization-mode": 1,
            "profile-level-id": "42e01f",
            "level-asymmetry-allowed": 1,
          },
        },
      ] as mediasoup.types.RtpCodecCapability[], // Fix type
    },
    // Mediasoup WebRtcTransport settings.
    webRtcTransportOptions: {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: process.env.MEDIASOUP_LISTENIP || null,
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    } as mediasoup.types.WebRtcTransportOptions, // Fix type
  },
};
