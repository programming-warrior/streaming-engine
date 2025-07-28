import { RedisSingleton } from "./redisConnection";
import { peers } from "./global";
import { router } from "../mediaSoupManager";

export async function sendStream(roomId: string) {
  // Listen for producers' stream events
  const room = await RedisSingleton.getStreamRoom(roomId);

  if (!room) {
    console.error(`Room with ID ${roomId} not found`);
    return;
  }

  const userIds = room.users;
  const producer1 = peers.get(userIds[0])?.producer;
  const producer2 = peers.get(userIds[1])?.producer;

  if (!producer1 || !producer2) {
    console.error("Producers not found for the room");
    return;
  }

  if (!router) {
    console.error("Router not initialized");
    return;
  }
  const plainTransport = await router?.createPlainTransport({
    listenIp: "127.0.0.1",
    rtcpMux: false,
    comedia: true,
  });
  if (!plainTransport) {
    console.error("Failed to create plain transport");
    return;
  }

  const consumer1 = await plainTransport.consume({
    producerId: producer1.id,
    rtpCapabilities: router.rtpCapabilities, // or the producer's capabilities
    paused: false,
  });

  const consumer2 = await plainTransport.consume({
    producerId: producer2.id,
    rtpCapabilities: router.rtpCapabilities,
    paused: false,
  });

  plainTransport.on("trace", (trace) => {
    // RTP/RTCP packet info
    console.log("Trace:", trace);
  });
}
