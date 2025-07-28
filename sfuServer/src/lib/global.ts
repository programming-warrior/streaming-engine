import { WebSocketWithUserId } from "./types";
import * as mediasoup from "mediasoup";

export const streamRoom: Record<string, any> = {};

export const peers = new Map<
  string,
  {
    socket: WebSocketWithUserId | null;
    sendTransport: mediasoup.types.Transport | null;
    receiveTransport: mediasoup.types.Transport | null;
    producer: mediasoup.types.Producer | null;
    consumer?: mediasoup.types.Consumer;
  }
>();
