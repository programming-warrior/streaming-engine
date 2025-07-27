import Redis from "ioredis";
import { User } from "./types";
import fs from "fs";
import path from "path";
export const WAITING_USER_QUEUE = "waiting_user_queue";
import { peers, streamRoom } from "./global";
import { randomUUID } from "crypto";
import { send } from "./handleSocketConnection";

const luaScriptDir = path.resolve(__dirname, "../scripts");
const checkAndUpdateWaitingUserScript = fs.readFileSync(
  luaScriptDir + "/checkandupdate-waiting-user.lua",
  "utf8"
);
console.log("Lua script loaded for checking and updating waiting users");

export class RedisSingleton {
  private static instance: Redis | null = null;

  private constructor() {}

  public static getInstance(): Redis {
    if (!RedisSingleton.instance) {
      RedisSingleton.instance = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
        password: process.env.REDIS_PASSWORD || undefined,
      });

      RedisSingleton.instance.on("error", (err) => {
        console.error("Redis Connection Error:", err);
      });
    }
    return RedisSingleton.instance;
  }

  public static async getStreamRoom(
    roomId: string
  ): Promise<{ users: string[]; offerer: string; answerer: string; streamUrl: string } | null> {
    const roomData = await RedisSingleton.getInstance().get(`streamRoom:${roomId}`);
    if (roomData) {
      return JSON.parse(roomData);
    }
    return null;
  }

  public static async addUserToRoom(
    userId: string,
  ): Promise<void> {
    const peer = peers.get(userId);
    if (!peer || !peer.socket || !peer.transport || !peer.producer) {
      peers.delete(userId);
      console.error(`Peer not found for user ${userId}`);
      return;
    }
    const matchedUserId = await RedisSingleton.tryAndMatchUser(userId);
    if (matchedUserId) {
      console.log(`User ${userId} matched with user ${matchedUserId}`);
      const matchedPeer = peers.get(matchedUserId);
      if (
        !matchedPeer ||
        !matchedPeer.socket ||
        !matchedPeer.transport ||
        !matchedPeer.producer
      ) {
        console.error(` matched user with id: ${matchedUserId} not found`);
        return;
      }
      const roomId = randomUUID();
      const roomData = {
        users: [matchedUserId, userId], //offerer, answerer
        offerer: matchedUserId,
        answerer: userId,
        streamUrl: "",
      };

      //store the streamRoom in redis
      await RedisSingleton.getInstance().set(
        `streamRoom:${roomId}`,
        JSON.stringify(roomData)
      );

      send(matchedPeer.socket, "matched", {
        roomId,
        matchedUserId: userId,
        matchedUserTransportId: peer.transport.id,
        producerId: peer.producer.id,
      });
      send(peer.socket, "matched", {
        roomId,
        matchedUserId,
        matchedUserTransportId: matchedPeer.transport.id,
        producerId: matchedPeer.producer.id,
      });
    } else {
      send(peer.socket, "waiting-for-user", {});
    }
  }
  public static async tryAndMatchUser(userId: string): Promise<string | null> {
    const result = await this.getInstance().eval(
      checkAndUpdateWaitingUserScript,
      1,
      WAITING_USER_QUEUE,
      userId
    );
    if (typeof result === "string" && result.length > 0) {
      try {
        return JSON.parse(result);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
}
