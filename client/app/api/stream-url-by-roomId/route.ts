import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/app/lib/redis";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get("roomId");
    console.log(roomId);
    const roomString = await redis.get(`streamRoom:${roomId}`);
    console.log(roomString);
    if (!roomString)
      return NextResponse.json({ error: "room not found" }, { status: 404 });
    const roomObject = JSON.parse(roomString as string);
    return NextResponse.json({ url: roomObject.streamUrl });
  } catch (error) {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
