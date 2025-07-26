import { createMedisoup } from "./mediaSoupManager";
import http from "http";

import { WebSocketServer } from "ws";
import {
  handleSocketConnection,
  streamRoom,
} from "./lib/handleSocketConnection";
import "./lib/roomManager";
import { randomUUID } from "crypto";
import { RedisSingleton } from "./lib/redisConnection";

const socketConnections = new Map<string, any>();

const init = async () => {
  await RedisSingleton.getInstance();
  console.log("Redis connection established");
  await createMedisoup();
  console.log("Mediasoup initialized");

  const server = http.createServer();
  const wss = new WebSocketServer({ server});
  wss.on("connection", (socket) => {
    const userId = randomUUID();
    socketConnections.set(userId, socket);
    handleSocketConnection(socket, userId);

    socket.on("close", () => {
      socketConnections.delete(userId);
      console.log(`Socket connection closed for user: ${userId}`);
    });

    socket.on("message", async (message) => {
      const jsonMessage = JSON.parse(message.toString());
      const { event, payload } = jsonMessage;

      console.log(`Received action: ${event}`);

  
      
    });

    socket.on("error", (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });
  });
  
  server.listen(4001, () => {
    console.log("WebSocket server is listening on port 4001");
  });
};

init().catch((error) => {
  console.error("Error initializing mediasoup:", error);
  process.exit(1);
});

