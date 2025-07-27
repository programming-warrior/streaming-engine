import { WebSocket } from "ws";

export type WebSocketWithUserId = WebSocket & { userId?: string };

export type User = {
  id: string;
  socket: WebSocketWithUserId;
};

export type Room = {
  users: User[];
};

export type WebSocketMessageType = {
  event: string;
  payload: any;
};