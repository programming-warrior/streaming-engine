import { createMedisoup } from "./medisSoupManager";
import http from "http";

import { WebSocketServer } from "ws";
import { handleSocketConnection, streamRoom } from "./lib/handleSocketConnection";
import "./lib/roomManager";
import { randomUUID } from "crypto";


const wss = new WebSocketServer({ port: 4001 });
const socketConnections = new Map<string, any>();

wss.on("connection", (socket) => {
  const userId = randomUUID();
  socketConnections.set(userId, socket);
  handleSocketConnection(socket, userId);
});

console.log("WebSocket server started on port 4001");




