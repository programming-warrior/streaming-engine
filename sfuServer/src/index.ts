import dotenv from "dotenv";
dotenv.config();
import { createMedisoup, worker, router } from "./mediaSoupManager";
import http from "http";
import { WebSocketServer } from "ws";
import {
  handleSocketConnection,
} from "./lib/handleSocketConnection";
import { WebSocketMessageType, WebSocketWithUserId } from "./lib/types";

import { randomUUID } from "crypto";
import { RedisSingleton } from "./lib/redisConnection";
import * as mediasoup from "mediasoup";




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
    wss.on("connection", (socket:WebSocketWithUserId) => {
      handleSocketConnection(socket);
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
