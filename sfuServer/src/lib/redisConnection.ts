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
      RedisSingleton.instance.on("close", () => {
        console.error("Redis closing...");
      })
      RedisSingleton.instance.on("reconnecting", () => {
        console.error("Redis ReConnecting...");
      })
    }
    return RedisSingleton.instance;
  }

   public static async getParterUserId(roomId: string, userId: string): Promise<
    string
   | null> {
    const roomDataStr = await RedisSingleton.getInstance().get(
      `streamRoom:${roomId}`
    );
    if (roomDataStr) {
      const parsedRoomData= JSON.parse(roomDataStr);
      const partnerUserId: string = parsedRoomData.users.find((id:string)=> id!==userId)
      return partnerUserId;
    }
    return null;
  }

  public static async getStreamRoom(roomId: string): Promise<{
    users: string[];
    offerer: string;
    answerer: string;
    streamUrl: string;
  } | null> {
    const roomData = await RedisSingleton.getInstance().get(
      `streamRoom:${roomId}`
    );
    if (roomData) {
      return JSON.parse(roomData);
    }
    return null;
  }

  public static async removeUserFromtheQueeu(userId: string): Promise<any> {
    try{
      await this.getInstance().lrem(WAITING_USER_QUEUE, 1, userId)
    }
    catch(e:any){
      console.error(e.message);
    }
  }


  public static async addUserToRoom(userId: string): Promise<string | null> {
    try {
      console.log(`Adding user ${userId} to room`);
      const peer = peers.get(userId);
      if (
        !peer ||
        !peer.socket ||
        !peer.sendTransport ||
        !peer.receiveTransport
        || !peer.audioProducer || 
        !peer.videoProducer
      ) {
        peers.delete(userId);
        console.error(`Peer not found for user ${userId}`);
        return null;
      }
      const matchedUserId = await RedisSingleton.tryAndMatchUser(userId);
      console.log(matchedUserId);
      if (matchedUserId) {
        console.log(`User ${userId} matched with user ${matchedUserId}`);
        const matchedPeer = peers.get(matchedUserId);
        if (
          !matchedPeer ||
          !matchedPeer.socket ||
          !matchedPeer.sendTransport ||
          !matchedPeer.receiveTransport ||
          !matchedPeer.videoProducer || 
          !matchedPeer.audioProducer
        ) {
          console.error(` matched user with id: ${matchedUserId} not found`);
          return null;
        }
        const roomId = randomUUID();
        const falseRoomId= "1234"
        const roomData = {
          users: [matchedUserId, userId], //offerer, answerer
          offerer: matchedUserId,
          answerer: userId,
          streamUrl: `https://${process.env.BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/live-stream/${roomId}/master.m3u8`,
        };

        //store the streamRoom in redis
        await RedisSingleton.getInstance().set(
          `streamRoom:${roomId}`,
          JSON.stringify(roomData)
        );

        send(matchedPeer.socket, "matched", {
          roomId,
          matchedUserId: userId,
          matchedUserTransportId: peer.sendTransport.id,
          videoProducerId: peer.videoProducer.id,
          audioProducerId: peer.audioProducer.id
        });
        send(peer.socket, "matched", {
          roomId,
          matchedUserId,
          matchedUserTransportId: matchedPeer.sendTransport.id,
          videoProducerId: matchedPeer.videoProducer.id,
          audioProducerId: matchedPeer.audioProducer.id
        });

        return roomId;
      } else {
        send(peer.socket, "waiting-for-user", {});
        return null;
      }
    } catch (error) {
      console.error("Error adding user to room:", error);
      return null;
    }
  }
  public static async tryAndMatchUser(userId: string): Promise<string | null> {
    const result = await this.getInstance().eval(
      checkAndUpdateWaitingUserScript,
      1,
      WAITING_USER_QUEUE,
      userId
    );
    console.log(result);
    if (typeof result === "string" && result.length > 0) {
      try {
        return result;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
}
