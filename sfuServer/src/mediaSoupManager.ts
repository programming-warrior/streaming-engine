import * as mediasoup from "mediasoup";
import { config } from "./config/mediasoupConfig";

let worker: mediasoup.types.Worker | null = null;
let router: mediasoup.types.Router | null = null;



export const socketTransportsMap = new Map<WebSocket, mediasoup.types.WebRtcTransport>();

export const createMedisoup = async () => {
  if (worker) {
    return worker;
  }

  worker = await mediasoup.createWorker(config.mediasoup.workerSettings);

  worker.on('died', () => {
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000);
  });

  router = await worker.createRouter(config.mediasoup.routerOptions);

  console.log('mediasoup router created');
}

export { worker, router };