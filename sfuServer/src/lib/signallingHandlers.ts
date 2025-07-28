import { send } from "./handleSocketConnection";
import { router } from "../mediaSoupManager";
import { config } from "../config/mediasoupConfig";
import { peers, streamRoom } from "./global";
import { WebSocketWithUserId } from "./types";
import { RedisSingleton } from "./redisConnection";
import { sendStream } from "./streamProcess";

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
    console.log("createWebRtcTransport handler called")
    if (!router) {
      console.error("mediaSoupRouter not initialized")
      return 
    }
    if (!socket.userId) {
      console.error("Socket userId is not set");
      socket.close();
      return;
    }
    const sendTransport = await router.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );
    const receiveTransport = await router.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );

    sendTransport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        console.log(`Transport closed for user`);
        sendTransport.close();
      }
    });

    receiveTransport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        console.log(`Transport closed for user`);
        receiveTransport.close();
      }
    });

    const peer = peers.get(socket.userId);
    if (!peer) {
      console.error(`Peer not found for user ${socket.userId}`);
      socket.close();
      return;
    }
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
  if (!peer || !peer.sendTransport || !peer.receiveTransport  ) {
    console.error("Transport not found");
    send(socket, "error", { error: "Transport not found" });
    return;
  }

  if (peer.sendTransport.id !== transportId && peer.receiveTransport.id !== transportId) {
    console.error("Transport ID mismatch");
    send(socket, "error", { error: "Transport ID mismatch" });
    return;
  }

  try {
    const transport = peer.sendTransport.id === transportId ? peer.sendTransport : peer.receiveTransport;
    await transport.connect({ dtlsParameters });

    send(socket, "webRtcTransportConnected", {});
  } catch (error) {
    console.error("Failed to connect WebRTC transport:", error);
    send(socket, "error", { error: "Failed to connect transport" });
  }
}

export async function handleProduce(socket: WebSocketWithUserId, payload: any) {
  const { kind, rtpParameters } = payload;

  if (!kind || !rtpParameters) {
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
  const producer = await peer.sendTransport.produce({ kind, rtpParameters });
  peer.producer = producer;

  producer.on("transportclose", () => {
    console.log(`Producer's transport closed for user ${socket.userId}`);
    peer.producer = null;
  });

  //once the user has created the producer, we can add them to the room
  
  send(socket, "produceSuccess", { producerId: producer.id });
  let roomId= await RedisSingleton.addUserToRoom(socket.userId).catch((error) => {
    console.error(`Failed to add user ${socket.userId} to room:`, error);
  });
  if(roomId) {
    sendStream(roomId);
  }

}

export async function handleConsume(
  socket: WebSocketWithUserId,
  {  rtpCapabilities, roomId }: any
) {
  console.log(rtpCapabilities)
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

  if( !consumerPeer || !consumerPeer.receiveTransport || !consumerPeer.receiveTransport.id) {
    console.error(`Consumer peer not found for user ${socket.userId}`);
    send(socket, "error", { error: "Consumer peer not found" });
    return;
  }

  if (
    !router || !router.canConsume({ producerId: producerPeer.producer.id, rtpCapabilities })
  ) {
    console.error("Cannot consume", { transportExists: !!consumerPeer.receiveTransport, rtpCapabilities });
    return;
  }

  try {
    const consumer = await consumerPeer.receiveTransport.consume({
      producerId: producerPeer.producer.id,
      rtpCapabilities,
      paused: true, // Start paused, client will resume
    });

    // consumerPeer.consumers.set(consumer.id, consumer);

    consumer.on("transportclose", () => {
      console.log(`Consumer's transport closed ${consumer.id}`);
      // consumerPeer.consumers.delete(consumer.id);
    });

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
