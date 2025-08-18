import { send } from "./handleSocketConnection";
import { router } from "../mediaSoupManager";
import { config } from "../config/mediasoupConfig";
import { peers, streamRoom } from "./global";
import { WebSocketWithUserId } from "./types";
import { RedisSingleton } from "./redisConnection";
import { sendStream } from "./streamForwarding";

export function handleGetRouterRtpCapabilities(socket: WebSocketWithUserId) {
  if (!router) return;
  if (!socket.userId) {
    console.error("Socket userId is not set");
    socket.close();
    return;
  }
  send(socket, "routerRtpCapabilities", router.rtpCapabilities);
}

export async function handleCreateWebRtcTransport(socket: WebSocketWithUserId) {
  try {
    console.log("createWebRtcTransport handler called");
    if (!router) {
      console.error("mediaSoupRouter not initialized");
      return;
    }
    if (!socket.userId) {
      console.error("Socket userId is not set");
      socket.close();
      return;
    }
    const peer = peers.get(socket.userId);
    if (!peer) {
      console.error(`Peer not found for user ${socket.userId}`);
      socket.close();
      return;
    }

    if (peer.sendTransport) peer.sendTransport.close();
    if (peer.receiveTransport) peer.receiveTransport.close();

    const sendTransport = await router.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );
    const receiveTransport = await router.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );

    sendTransport.on("dtlsstatechange", (dtlsState) => {
      console.log("dtlsstatechange event called for sendTransport");
      console.log(dtlsState);
      if (dtlsState === "closed") {
        console.log(`Transport closed for user`);
        sendTransport.close();
      }
    });

    receiveTransport.on("dtlsstatechange", (dtlsState) => {
      console.log("dtlsstatechange event called for receiveTransport");
      console.log(dtlsState);
      if (dtlsState === "closed") {
        console.log(`Transport closed for user`);
        receiveTransport.close();
      }
    });

    peer.sendTransport = sendTransport;
    peer.receiveTransport = receiveTransport;

    send(socket, "webRtcTransportCreated", {
      sendTransport: {
        id: sendTransport.id,
        iceParameters: sendTransport.iceParameters,
        iceCandidates: sendTransport.iceCandidates,
        dtlsParameters: sendTransport.dtlsParameters,
      },
      receiveTransport: {
        id: receiveTransport.id,
        iceParameters: receiveTransport.iceParameters,
        iceCandidates: receiveTransport.iceCandidates,
        dtlsParameters: receiveTransport.dtlsParameters,
      },
    });
  } catch (error) {
    console.error("Failed to create WebRTC transport:", error);
    send(socket, "error", { error: "Failed to create transport" });
  }
}

export async function handleConnectWebRtcTransport(
  socket: WebSocketWithUserId,
  payload: any
) {
  const { dtlsParameters, transportId } = payload;

  if (!dtlsParameters) {
    console.error("Invalid parameters for connecting WebRTC transport");
    send(socket, "error", { error: "Invalid parameters" });
    return;
  }

  if (!socket.userId) {
    console.error("Socket userId is not set");
    socket.close();
    return;
  }

  const peer = peers.get(socket.userId);
  if (!peer || !peer.sendTransport || !peer.receiveTransport) {
    console.error("Trying to connect to tranport but it is not created yet");
    //close the connection for the user
    socket.close();
    return;
  }

  if (
    peer.sendTransport.id !== transportId &&
    peer.receiveTransport.id !== transportId
  ) {
    console.error("Transport ID mismatch");
    //malicious user
    socket.close();
    return;
  }

  try {
    const transport =
      peer.sendTransport.id === transportId
        ? peer.sendTransport
        : peer.receiveTransport;
    await transport.connect({ dtlsParameters });

    send(socket, "webRtcTransportConnected", {});
  } catch (error) {
    console.error("Failed to connect WebRTC transport:", error);
    send(socket, "error", { error: "Failed to connect transport" });
  }
}

export async function handleProduce(socket: WebSocketWithUserId, payload: any) {
  const { kind, rtpParameters } = payload;

  if (!kind || !rtpParameters || !["audio", "video"].includes(kind)) {
    console.error("Invalid parameters for producing");
    send(socket, "error", { error: "Invalid parameters" });
    return;
  }

  if (!socket.userId) {
    console.error("Socket userId is not set");
    socket.close();
    return;
  }

  const peer = peers.get(socket.userId);
  if (!peer || !peer.sendTransport || !peer.sendTransport.id) {
    console.error("Transport not found for producing");
    send(socket, "error", { error: "Transport not found" });
    return;
  }
  console.log(`creating ${kind} producer`);
  const producer = await peer.sendTransport.produce({ kind, rtpParameters });
  if (kind === "audio") {
    peer.audioProducer = producer;
  } else if (kind === "video") {
    peer.videoProducer = producer;
  }

  producer.on("transportclose", async () => {
    console.log(`Producer's transport closed for user ${socket.userId}`);
    if (kind === "audio") {
      delete peer.audioProducer;
    } else if (kind === "video") {
      delete peer.videoProducer;
    }
    if (peer.roomId) {
      const otherUserId = await RedisSingleton.getParterUserId(
        peer.roomId,
        peer.id
      );
      if (otherUserId) {
        const otherPeer = peers.get(otherUserId);
        if (kind === "audio" && otherPeer?.audioConsumer) {
          delete otherPeer.audioConsumer;
        } else if (kind === "video" && otherPeer?.videoConsumer) {
          delete otherPeer.videoConsumer;
        }
      }
    }
  });
  //once the user has created the producer, we can add them to the room
  send(socket, "produceSuccess", { producerId: producer.id });

  //add the user to the room after both the producer has been created
  if (peer.audioProducer && peer.videoProducer) {
    let roomId = await RedisSingleton.addUserToRoom(socket.userId).catch(
      (error) => {
        console.error(`Failed to add user ${socket.userId} to room:`, error);
      }
    );
    if (roomId) {
      peer.roomId = roomId;
      //start the ffmpeg docker container
      sendStream(roomId);
    }
  }
}

async function handleConsume(
  socket: WebSocketWithUserId,
  { rtpCapabilities, roomId, kind }: any // Add kind parameter
) {
  if (!socket.userId) {
    console.error("Socket userId is not set");
    socket.close();
    return;
  }

  // Validate kind parameter
  if (!kind || !["audio", "video"].includes(kind)) {
    console.error("Invalid or missing kind parameter");
    send(socket, "error", { error: "Invalid kind parameter" });
    return;
  }

  const room = await RedisSingleton.getStreamRoom(roomId);
  if (!room) {
    console.error(`Room with ID ${roomId} not found`);
    send(socket, "error", { error: "Room not found" });
    return;
  }

  if (!room.users.includes(socket.userId)) {
    console.error(`User ${socket.userId} is not part of room ${roomId}`);
    send(socket, "error", { error: "User not part of room" });
    return;
  }

  const producerPeerId = room.users.find((userId) => userId !== socket.userId);
  if (!producerPeerId) {
    console.error(`Producer peer not found for user ${socket.userId}`);
    send(socket, "error", { error: "Producer peer not found" });
    return;
  }

  const producerPeer = peers.get(producerPeerId);
  const consumerPeer = peers.get(socket.userId);

  if (!producerPeer) {
    console.error(`Producer peer not found for user ${producerPeerId}`);
    send(socket, "error", { error: "Producer peer not found" });
    return;
  }

  // Check for specific producer type
  const producer =
    kind === "audio" ? producerPeer.audioProducer : producerPeer.videoProducer;
  if (!producer) {
    console.error(`${kind} producer not found for user ${producerPeerId}`);
    send(socket, "error", { error: `${kind} producer not found` });
    return;
  }

  if (
    !consumerPeer ||
    !consumerPeer.receiveTransport ||
    consumerPeer.receiveTransport.closed
  ) {
    console.error(
      `Consumer peer transport not available for user ${socket.userId}`
    );
    send(socket, "error", { error: "Consumer transport not available" });
    return;
  }

  // Check if router can consume this producer
  if (
    !router ||
    !router.canConsume({
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
    console.error(`Cannot consume ${kind} producer`, {
      producerId: producer.id,
      rtpCapabilities,
    });
    send(socket, "error", { error: `Cannot consume ${kind}` });
    return;
  }

  // Check if consumer already exists
  const existingConsumer =
    kind === "audio" ? consumerPeer.audioConsumer : consumerPeer.videoConsumer;
  if (existingConsumer) {
    console.error(`${kind} consumer already exists for user ${socket.userId}`);
    send(socket, "error", { error: `${kind} consumer already exists` });
    return;
  }

  try {
    const consumer = await consumerPeer.receiveTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true, // Start paused, client will resume when ready
    });

    // Store consumer based on kind
    if (kind === "audio") {
      consumerPeer.audioConsumer = consumer;
    } else {
      consumerPeer.videoConsumer = consumer;
    }

    // Handle transport close
    consumer.on("transportclose", () => {
      console.log(`${kind} consumer's transport closed ${consumer.id}`);
      if (kind === "audio") {
        delete consumerPeer.audioConsumer;
      } else {
        delete consumerPeer.videoConsumer;
      }
    });

    // Handle producer close
    consumer.on("producerclose", () => {
      console.log(`Producer for ${kind} consumer closed ${consumer.id}`);
      // Close and clean up the consumer
      consumer.close();
      if (kind === "audio") {
        delete consumerPeer.audioConsumer;
      } else {
        delete consumerPeer.videoConsumer;
      }

      // Notify client that producer closed
      send(socket, "producerClosed", { kind, consumerId: consumer.id });
    });

    console.log("sending consumed message for kind: ", consumer.kind)
    send(socket, "consumed", {
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });

    console.log(
      `${kind} consumer ${consumer.id} created for user ${socket.userId}`
    );
  } catch (error) {
    console.error(`Failed to create ${kind} consumer:`, error);
    send(socket, "error", { error: `Failed to create ${kind} consumer` });
  }
}

// Alternative: Create both consumers at once
export async function handleConsumeAll(
  socket: WebSocketWithUserId,
  { rtpCapabilities, roomId }: any
) {
  const kinds = ["audio", "video"] as const;

  for (const kind of kinds) {
    await handleConsume(socket, { rtpCapabilities, roomId, kind });
  }
}

export async function handleConsumerResume(
  socket: WebSocketWithUserId,
  { roomId }: any
) {
  if (!socket.userId) {
    console.error("Socket userId is not set ");
    socket.close();
    return;
  }
  const room = await RedisSingleton.getStreamRoom(roomId);
  if (!room) {
    console.error(`Room with ID ${roomId} not found`);
    send(socket, "error", { error: "Room not found" });
    return;
  }
  if (!room.users.includes(socket.userId)) {
    console.error(`User ${socket.userId} is not part of room ${roomId}`);
    send(socket, "error", { error: "User not part of room" });
    return;
  }
  const peer = peers.get(socket.userId);

  if (!peer || !peer.audioConsumer || !peer.videoConsumer) {
    console.error(` peer not found for user ${socket.userId}`);
    send(socket, "error", { error: "peer not found" });
    return;
  }

  try {
    console.log('resuming audio consumer');
    await peer.audioConsumer.resume();
    console.log('resuming video consumer');
    await peer.videoConsumer.resume();
    send(socket, "consumer-resumed", {});
    console.log(`audio consumer ${peer.audioConsumer?.id} resumed`);
    console.log(`video consumer ${peer.videoConsumer?.id} resumed`);
  } catch (error) {
    console.error("Failed to create consumer:", error);
  }
}
