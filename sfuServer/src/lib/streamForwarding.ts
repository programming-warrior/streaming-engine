import { RedisSingleton } from "./redisConnection";
import { peers } from "./global";
import axios from "axios";
import { router } from "../mediaSoupManager";


const CONTAINER_IP = process.env.FFMPEG_CONTAINER_IP;

export async function sendStream(roomId: string) {
  try {
    // Listen for producers' stream events
    const room = await RedisSingleton.getStreamRoom(roomId);

    if (!room) {
      console.error(`Room with ID ${roomId} not found`);
      return;
    }

    const userIds = room.users;
    const videoProducer1 = peers.get(userIds[0])?.videoProducer;
    const audioProducer1 = peers.get(userIds[0])?.audioProducer;
    const videoProducer2 = peers.get(userIds[1])?.videoProducer;
    const audioProducer2 = peers.get(userIds[1])?.audioProducer;

    if (
      !videoProducer1 ||
      !videoProducer2 ||
      !audioProducer1 ||
      !audioProducer2
    ) {
      console.error("Producers not found for the room");
      return;
    }

    if (!router) {
      console.error("Router not initialized");
      return;
    }


    // Base ports - will increment for each stream
    let currentPort = 40750;

    // Create transports and consumers for all producers
    const user1Video = await createTransportAndConsumer(
      videoProducer1,
      currentPort
    );
    currentPort += 10; // Leave gap between ports

    const user1Audio = await createTransportAndConsumer(
      audioProducer1,
      currentPort
    );
    currentPort += 10;

    const user2Video = await createTransportAndConsumer(
      videoProducer2,
      currentPort
    );
    currentPort += 10;

    const user2Audio = await createTransportAndConsumer(
      audioProducer2,
      currentPort
    );

    if(!user1Audio || !user2Audio || !user1Video || !user2Video){
      throw new Error("error creating plain tranport");
    }
    console.log("Stream setup complete:");
    console.log(
      `User1 Video - Port: ${user1Video.port}, Codec: ${user1Video.codec}, PayloadType: ${user1Video.payloadType}`
    );
    console.log(
      `User1 Audio - Port: ${user1Audio.port}, Codec: ${user1Audio.codec}, PayloadType: ${user1Audio.payloadType}`
    );
    console.log(
      `User2 Video - Port: ${user2Video.port}, Codec: ${user2Video.codec}, PayloadType: ${user2Video.payloadType}`
    );
    console.log(
      `User2 Audio - Port: ${user2Audio.port}, Codec: ${user2Audio.codec}, PayloadType: ${user2Audio.payloadType}`
    );

    // Optional: Stats monitoring
    // const verificationInterval = setInterval(async () => {
    //   try {
    //     const stats = await Promise.all([
    //       user1Video.consumer.getStats(),
    //       user1Audio.consumer.getStats(),
    //       user2Video.consumer.getStats(),
    //       user2Audio.consumer.getStats()
    //     ]);
    //     console.log("Consumer Stats:", stats);
    //   } catch (e) {
    //     console.error("Error getting consumer stats:", e);
    //     clearInterval(verificationInterval);
    //   }
    // }, 10000);

    // Send API request to worker node with all stream data
    const nodeIp = process.env.STREAMPROCESS_WORKER_NODE_IP;
    const sharedKey = process.env.SHARD_KEY;

    if (!nodeIp) return console.error("WORKER IP not found");

    await axios.post("http://" + nodeIp + "/api/start", {
      streams: [
        {
          userId: userIds[0],
          video: {
            port: user1Video.port,
            codec: user1Video.codec,
            payloadType: user1Video.payloadType,
          },
          audio: {
            port: user1Audio.port,
            codec: user1Audio.codec,
            payloadType: user1Audio.payloadType,
          },
        },
        {
          userId: userIds[1],
          video: {
            port: user2Video.port,
            codec: user2Video.codec,
            payloadType: user2Video.payloadType,
          },
          audio: {
            port: user2Audio.port,
            codec: user2Audio.codec,
            payloadType: user2Audio.payloadType,
          },
        },
      ],
      roomId: roomId,
    });

    // Store references for cleanup later
    const streamData = {
      roomId,
      transports: [
        user1Video.transport,
        user1Audio.transport,
        user2Video.transport,
        user2Audio.transport,
      ],
      consumers: [
        user1Video.consumer,
        user1Audio.consumer,
        user2Video.consumer,
        user2Audio.consumer,
      ],
    };

    // Store in a global map for cleanup when needed
    // activeStreams.set(roomId, streamData);

    console.log(`✅ Stream started successfully for room ${roomId}`);
    return streamData;
  } catch (e: any) {
    console.error("sendStreamError: " + e.message);
  }
}

// Helper function to create transport and consumer
async function createTransportAndConsumer(producer: any, basePort: number) {
  
  if(!router) return null;

  const plainTransport = await router.createPlainTransport({
    listenIp: process.env.LOCAL_BIND_IP || "127.0.0.1",
    rtcpMux: false,
    comedia: false,
  });

  await plainTransport.connect({
    ip: CONTAINER_IP,
    port: basePort,
    rtcpPort: basePort + 1,
  });

  const consumer = await plainTransport.consume({
    producerId: producer.id,
    rtpCapabilities: router.rtpCapabilities,
    paused: false,
  });

  const codec = consumer.rtpParameters.codecs[0].mimeType.split("/")[1];
  const payloadType = consumer.rtpParameters.codecs[0].payloadType;

  // Add event listeners
  plainTransport.on("tuple", (tuple) => {
    console.log(`🔗 Transport ${basePort} Tuple Updated:`, tuple);
  });

  plainTransport.on("trace", (trace) => {
    console.log(`Transport ${basePort} Trace:`, trace);
  });

  consumer.on("trace", (trace) => {
    console.log(`Consumer ${basePort} RTP Packet:`, trace);
  });

  return {
    transport: plainTransport,
    consumer,
    port: basePort,
    codec,
    payloadType,
    kind: producer.kind, // 'video' or 'audio'
  };
}
