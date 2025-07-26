import Redis from "ioredis";
import { User } from "./types";
import fs from "fs";
import path from "path";
export const WAITING_USER_QUEUE = "waiting_user_queue";

const luaScriptDir= path.resolve(
  __dirname,
  "../scripts"
);
const checkAndUpdateWaitingUserScript = fs.readFileSync(luaScriptDir+"/checkandupdate-waiting-user.lua", "utf8");
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

      RedisSingleton.instance.on('error', (err) => {
        console.error('Redis Connection Error:', err);
      
      });
    }
    return RedisSingleton.instance;
  }

  public static async tryAndMatchUser(userId: string): Promise<User | null> {
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
