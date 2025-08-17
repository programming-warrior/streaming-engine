import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/app/lib/redis";

export async function GET(req: NextRequest) {
    try {
        const keys = await redis.keys("streamRoom:*");
        if (keys.length === 0) {
            return NextResponse.json({ error: "No rooms found" }, { status: 404 });
        }
        const randomKey = keys[Math.floor(Math.random() * keys.length)];
        const randomRoomString= await redis.get(randomKey);
        const randomRoomObject = JSON.parse(randomRoomString as string);
        return NextResponse.json({ url: randomRoomObject.streamUrl });
    } catch (error) {
        return NextResponse.json(
            { error: "Internal Server Error" },
            { status: 500 }
        );
    }
}
