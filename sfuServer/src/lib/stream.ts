import { RedisSingleton } from "./redisConnection";
import { peers } from "./global";
import axios from "axios";
import { router } from "../mediaSoupManager";

export async function sendStream(roomId: string) {
  try {
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

    const CONTAINER_IP = process.env.FFMPEG_CONTAINER_IP;

    // Create a transport specifically for the first producer
    const plainTransport1 = await router.createPlainTransport({
      listenIp: process.env.LOCAL_BIND_IP || "127.0.0.1",
      rtcpMux: false,
      comedia: false,
    });

    plainTransport1.on("tuple", (tuple) => {
      console.log(`🔗 Transport1 Tuple Updated:`, tuple);
    });


    const videoPort1 = plainTransport1.tuple.localPort; 

    await plainTransport1.connect({
      ip: CONTAINER_IP, // FFmpeg container IP
      port: videoPort1,
      rtcpPort: videoPort1 + 1,
    });


    const consumer1 = await plainTransport1.consume({
      producerId: producer1.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });


    const videoCodec1 =
      consumer1.rtpParameters.codecs[0].mimeType.split("/")[1];
    const videoPayloadType1 = consumer1.rtpParameters.codecs[0].payloadType;

    const plainTransport2 = await router.createPlainTransport({
      listenIp: process.env.LOCAL_BIND_IP || "127.0.0.1",
      rtcpMux: false,
      comedia: false,
    });

  

    plainTransport2.on("tuple", (tuple) => {
      console.log(`🔗 Transport1 Tuple Updated:`, tuple);
    });

    const videoPort2 = plainTransport2.tuple.localPort;

    console.log(
      "Port1: " +
        plainTransport1.tuple.localPort +
        " Port2: " +
        plainTransport2.tuple.localPort
    );

    await plainTransport2.connect({
      ip: CONTAINER_IP, // FFmpeg container IP
      port: videoPort2,
      rtcpPort: videoPort2 + 1,
    });

    const consumer2 = await plainTransport2.consume({
      producerId: producer2.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    const videoCodec2 =
      consumer2.rtpParameters.codecs[0].mimeType.split("/")[1];
    const videoPayloadType2 = consumer2.rtpParameters.codecs[0].payloadType;


    plainTransport1.on("trace", (trace) => {
      // RTP/RTCP packet info
      console.log("Trace:", trace);
    });


    plainTransport2.on("trace", (trace) => {
      // RTP/RTCP packet info
      console.log("Trace:", trace);
    });

    const verificationInterval = setInterval(async () => {
      try {
        const stats1 = await consumer1.getStats();
        const stats2 = await consumer2.getStats();

        console.log(stats1);
        console.log(stats2);

      } catch (e) {
        console.error("Error getting consumer stats:", e);
        clearInterval(verificationInterval);
      }
    }, 10000);

    consumer1.on("trace", (trace) => {
      if (trace.type === "rtp") {
        console.log("Consumer1 RTP Packet Received:", trace);
      }
    });

    consumer2.on("trace", (trace) => {
      if (trace.type === "rtp") {
        console.log("Consumer2 RTP Packet Received:", trace);
      }
    });

    //send an api request to the worker node
    const nodeIp = process.env.STREAMPROCESS_WORKER_NODE_IP;
    const sharedKey = process.env.SHARD_KEY;

    if (!nodeIp) return console.error("WORKER IP not found");

    await axios.post("http://" + nodeIp + "/api/start", {
      streams: [
        {
          videoPort: videoPort1,
          videoCodec: videoCodec1,
          videoPayloadType: videoPayloadType1,
        },
        {
          videoPort: videoPort2,
          videoCodec: videoCodec2,
          videoPayloadType: videoPayloadType2,
        },
      ],
      roomId: roomId,
    });
  } catch (e: any) {
    console.error("sendStreamError: " + e.message);
  }
}
