import { createMedisoup, worker, router } from "./mediaSoupManager";
import http from "http";
import { WebSocketServer } from "ws";
import {
  handleSocketConnection,
  streamRoom,
} from "./lib/handleSocketConnection";
import { WebSocketMessageType } from "./lib/types";
import dotenv from "dotenv";
dotenv.config();
import { randomUUID } from "crypto";
import { RedisSingleton } from "./lib/redisConnection";
import * as mediasoup from "mediasoup";
import {
  handleGetRouterRtpCapabilities,
  handleConnectWebRtcTransport,
  handleCreateWebRtcTransport,
  handleProduce,
} from "./lib/signallingHandlers";

const socketConnections = new Map<string, any>();

const init = async () => {
  try {
    await RedisSingleton.getInstance();
    console.log("Redis connection established");
    await createMedisoup();
    if (!router || !worker)
      throw new Error("MediaSoup Worker or Router failed to initialized");
    console.log("Mediasoup initialized");

    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => {
      const userId = randomUUID();
      socketConnections.set(userId, socket);
      handleSocketConnection(socket, userId);

      socket.on("close", () => {
        socketConnections.delete(userId);
        console.log(`Socket connection closed for user: ${userId}`);
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

          default:
            console.warn(`Unknown action: ${event}`);
        }
      });

      socket.on("error", (error) => {
        console.error(`Socket error for user ${userId}:`, error);
      });
    });

    server.listen(4001, () => {
      console.log("WebSocket server is listening on port 4001");
    });
  } catch (error) {
    throw error;
  }
};

init().catch((error) => {
  console.error("Error initializing mediasoup:", error);
  process.exit(1);
});
