import * as mediasoup from "mediasoup";


let worker: mediasoup.types.Worker | null = null;
let router: mediasoup.types.Router | null = null;


export const createMedisoup = async () => {
  if (worker) {
    return worker;
  }

  worker = await mediasoup.createWorker();

  worker.on('died', () => {
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000);
  });

  router = await worker.createRouter({
    mediaCodecs: [
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
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  });

  console.log('mediasoup router created');
}

export { worker, router };