import { WebSocket } from "ws";
import { User, WebSocketWithUserId } from "./types";
import { randomUUID } from "crypto";
import {
  handleGetRouterRtpCapabilities,
  handleConnectWebRtcTransport,
  handleCreateWebRtcTransport,
  handleProduce,
  handleConsumeAll,
  handleConsumerResume,
} from "./signallingHandlers";
import { WebSocketMessageType } from "./types";
import { peers } from "./global";
import { RedisSingleton } from "./redisConnection";

export function send(ws: WebSocket, event: string, payload: any) {
  const message = JSON.stringify({ event, payload });
  ws.send(message);
}

export const handleSocketConnection = async (socket: WebSocketWithUserId) => {
  const userId = randomUUID();
  console.log(`New WebSocket connection from user ${userId}`);
  socket.userId = userId;
  peers.set(userId, {
    socket,
    sendTransport: null,
    receiveTransport: null,
    id: userId
  });

  send(socket, "welcome", { userId });

  socket.on("close", async () => {
    const peer = peers.get(userId);
    console.log(`Socket connection closed for user: ${userId}`);
    if (peer?.sendTransport && !peer.sendTransport.closed) {
      console.log("closing sendTransport for user: ", userId);
      peer.sendTransport.close();
    }
    if (peer?.receiveTransport && !peer.receiveTransport.closed) {
      console.log("closing receiveTransport for user: ", userId);
      peer.receiveTransport.close();
    }
    peers.delete(userId);
    RedisSingleton.removeUserFromtheQueeu(userId)
      .then(() =>
        console.log("removed from the waiting queue, userId: ", userId)
      )
      .catch((e) => {});
  });

  socket.on("message", async (message: WebSocketMessageType) => {
    const jsonMessage = JSON.parse(message.toString());
    const { event, payload } = jsonMessage;

    console.log(`Received action: ${event}`);

    switch (event) {
      case "getRouterRtpCapabilities":
        handleGetRouterRtpCapabilities(socket);
        break;

      case "createWebRtcTransport":
        await handleCreateWebRtcTransport(socket);
        break;

      case "connectWebRtcTransport":
        await handleConnectWebRtcTransport(socket, payload);
        break;

      case "produce":
        await handleProduce(socket, payload);
        break;

      case "consume":
        await handleConsumeAll(socket, payload);
        break;

      case "resume":
        await handleConsumerResume(socket, payload);
        break;
      default:
        console.warn(`Unknown action: ${event}`);
    }
  });

  socket.on("error", (error) => {
    console.error(`Socket error for user ${userId}:`, error);
  });
};
