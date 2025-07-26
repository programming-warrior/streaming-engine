import { WebSocket } from "ws";
import { RedisSingleton } from "./redisConnection";
import { User } from "./types";

export const streamRoom : Record<string, any>= {};

export const handleSocketConnection = async (
  socket: WebSocket,
  userId: string
) => {
  console.log(`New WebSocket connection from user ${userId}`);

  const matchedUserId = await RedisSingleton.tryAndMatchUser(userId);
  if (matchedUserId) {
    const roomId = `room-${userId}-${matchedUserId}`;
    streamRoom[roomId] = {
        users: [userId, matchedUserId],
        offerer: userId,
        answerer: matchedUserId, 
        streamUrl: ""
    };
    console.log(`User ${userId} matched with user ${matchedUserId}`);
    socket.send(JSON.stringify({ type: "match-found", yourId: userId, roomId, offerer: userId, answerer: matchedUserId }));
  } else {
    socket.send(JSON.stringify({ type: "waiting-for-user" , yourId: userId }));
  }

  socket.on("message", (message) => {
    console.log(`Received message from ${userId}: ${message}`);
  });

  socket.on("close", () => {
    console.log(`WebSocket connection closed for user ${userId}`);
  });
};
