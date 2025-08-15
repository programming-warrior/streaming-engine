import { NextRequest, NextResponse } from "next/server";
import Redis from "ioredis";

console.log(process.env.REDIS_HOST)

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379", 10),
  password: process.env.REDIS_PASSWORD || undefined,
});

export async function GET(req: NextRequest) {
    try {
        const keys = await redis.keys("streamRoom:*");
        if (keys.length === 0) {
            return NextResponse.json({ error: "No rooms found" }, { status: 404 });
        }
        console.log(keys)
        const randomKey = keys[Math.floor(Math.random() * keys.length)];
        console.log(randomKey);
        const randomRoomString= await redis.get(randomKey);
        const randomRoomObject = JSON.parse(randomRoomString as string);
        console.log(randomRoomObject);
        return NextResponse.json({ url: randomRoomObject.streamUrl });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
