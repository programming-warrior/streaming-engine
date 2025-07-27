import { send } from "./handleSocketConnection";
import { router } from "../mediaSoupManager";
import { config } from "../config/mediasoupConfig";
import { peers, streamRoom } from "./global";
import { WebSocketWithUserId } from "./types";
import { RedisSingleton } from "./redisConnection";

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
    if (!router) return;
    if (!socket.userId) {
      console.error("Socket userId is not set");
      socket.close();
      return;
    }
    const transport = await router.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        console.log(`Transport closed for user`);
        transport.close();
      }
    });

    const peer = peers.get(socket.userId);
    if (!peer) {
      console.error(`Peer not found for user ${socket.userId}`);
      socket.close();
      return;
    }
    peer.transport = transport;

    send(socket, "webRtcTransportCreated", {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
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

  if (!dtlsParameters || !transportId) {
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
  if (!peer || !peer.transport || peer.transport.id !== transportId) {
    console.error("Transport not found");
    send(socket, "error", { error: "Transport not found" });
    return;
  }

  try {
    await peer.transport.connect({ dtlsParameters });

    send(socket, "webRtcTransportConnected", {});
  } catch (error) {
    console.error("Failed to connect WebRTC transport:", error);
    send(socket, "error", { error: "Failed to connect transport" });
  }
}

export async function handleProduce(socket: WebSocketWithUserId, payload: any) {
  const { kind, rtpParameters, transportId } = payload;

  if (!kind || !rtpParameters || !transportId) {
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
  if (!peer || !peer.transport || peer.transport.id !== transportId) {
    console.error("Transport not found for producing");
    send(socket, "error", { error: "Transport not found" });
    return;
  }
  const producer = await peer.transport.produce({ kind, rtpParameters });
  peer.producer = producer;

  producer.on("transportclose", () => {
    console.log(`Producer's transport closed for user ${socket.userId}`);
    peer.producer = null;
  });

  //once the user has created the producer, we can add them to the room
  RedisSingleton.addUserToRoom(socket.userId);

  send(socket, "produceSuccess", { producerId: producer.id });
}

export async function handleConsume(
  socket: WebSocketWithUserId,
  {  rtpCapabilities, roomId }: any
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
  if(!room.users.includes(socket.userId)) {
    console.error(`User ${socket.userId} is not part of room ${roomId}`);
    send(socket, "error", { error: "User not part of room" });
    return;
  }
  const producerPeerId  = room.users.find(
    (userId) => userId !== socket.userId
  ); 

  if(!producerPeerId) {
    console.error(`Producer peer not found for user ${socket.userId}`);
    send(socket, "error", { error: "Producer peer not found" });
    return;
  }

  const producerPeer = peers.get(producerPeerId);
  const consumerPeer = peers.get(socket.userId);

  if (!producerPeer || !producerPeer.producer) {
    console.error(`Producer peer not found for user ${producerPeerId}`);
    send(socket, "error", { error: "Producer peer not found" });
    return;
  }

  if( !consumerPeer || !consumerPeer.transport ) {
    console.error(`Consumer peer not found for user ${socket.userId}`);
    send(socket, "error", { error: "Consumer peer not found" });
    return;
  }

  if (
    !router || !router.canConsume({ producerId: producerPeer.producer.id, rtpCapabilities })
  ) {
    console.error("Cannot consume", { transportExists: !!consumerPeer.transport });
    return;
  }

  try {
    const consumer = await consumerPeer.transport.consume({
      producerId: producerPeer.producer.id,
      rtpCapabilities,
      paused: true, // Start paused, client will resume
    });

    // consumerPeer.consumers.set(consumer.id, consumer);

    // consumer.on("transportclose", () => {
    //   console.log(`Consumer's transport closed ${consumer.id}`);
    //   consumerPeer.consumers.delete(consumer.id);
    // });

    // consumer.on("producerclose", () => {
    //   console.log(`Producer for consumer closed ${consumer.id}`);
    //   // You might want to notify the client that this stream has ended
    //   send(ws, "consumer-closed", { consumerId: consumer.id });
    //   consumerPeer.consumers.delete(consumer.id);
    // });

    send(socket, "consumed", {
      id: consumer.id,
      producerId: producerPeer.producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    });

    // Now that the consumer is created, ask the client to resume it.
    // This is a common pattern to avoid issues with media flow before the client is ready.
    // The client will receive the 'consumed' message and then send back a 'resume-consumer' request.
    // For simplicity here, we'll just log it. In a real app, you'd wait for a resume signal.
    await consumer.resume();
    console.log(`Consumer ${consumer.id} created and resumed`);
  } catch (error) {
    console.error("Failed to create consumer:", error);
  }
}
