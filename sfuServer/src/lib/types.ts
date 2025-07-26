import { WebSocket } from "ws";

export type User = {
  id: string;
  socket: WebSocket;
};

export type Room = {
  users: User[];
};

export type WebSocketMessageType = {
  event: string;
  payload: any;
};