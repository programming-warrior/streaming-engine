import { WebSocketWithUserId } from "./types";
import * as mediasoup from "mediasoup";

export const streamRoom: Record<string, any> = {};

export const peers = new Map<
  string,
  {
    id: string;
    socket: WebSocketWithUserId | null;
    roomId?: string;
    sendTransport: mediasoup.types.Transport | null;
    receiveTransport: mediasoup.types.Transport | null;
    videoProducer?: mediasoup.types.Producer | null;
    audioProducer?: mediasoup.types.Producer; 
    videoConsumer?: mediasoup.types.Consumer;
    audioConsumer?: mediasoup.types.Consumer;
  }
>();
