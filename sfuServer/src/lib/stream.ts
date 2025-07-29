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

    // 1. Create a transport specifically for the first producer
    const plainTransport1 = await router.createPlainTransport({
      listenIp: "172.24.240.1",
      rtcpMux: false,
      comedia: true,
    });

    const consumer1 = await plainTransport1.consume({
      producerId: producer1.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    const videoPort1 = plainTransport1.tuple.localPort;
    const videoCodec1 =
      consumer1.rtpParameters.codecs[0].mimeType.split("/")[1];
    const videoPayloadType1= consumer1.rtpParameters.codecs[0].payloadType;
    

    // const listenIp = plainTransport1.tuple.localIp;
    //TODO - remove hardcoded ip
    const listenIp = "172.24.240.1"


    const plainTransport2 = await router.createPlainTransport({
      listenIp: "172.24.240.1",
      rtcpMux: false,
      comedia: true,
    });

    
    const consumer2 = await plainTransport2.consume({
      producerId: producer2.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: false,
    });

    const videoPort2 = plainTransport2.tuple.localPort;
    const videoCodec2 =
      consumer2.rtpParameters.codecs[0].mimeType.split("/")[1];
    const videoPayloadType2= consumer2.rtpParameters.codecs[0].payloadType;

    plainTransport1.on("trace", (trace) => {
      // RTP/RTCP packet info
      console.log("Trace:", trace);
    });

    plainTransport2.on("trace", (trace) => {
      // RTP/RTCP packet info
      console.log("Trace:", trace);
    });

    //send an api request to the worker node
    const nodeIp = process.env.STREAMPROCESS_WORKER_NODE_IP;
    const sharedKey = process.env.SHARD_KEY;

    if (!nodeIp) return console.error("WORKER IP not found");

    await axios.post(nodeIp + "/api/start", {
      listenIp,
      streams: [
        { videoPort: videoPort1, videoCodec: videoCodec1, videoPayloadType: videoPayloadType1 },
        { videoPort: videoPort2, videoCodec: videoCodec2, videoPayloadType: videoPayloadType2 },
      ],
      outputDir: `/streams/${roomId}`,
      roomId: roomId,
    });
  } catch (e:any) {
    console.log(e.message);
  }
}
