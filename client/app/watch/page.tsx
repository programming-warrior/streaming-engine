"use client";

import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export default function WatchPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>(""); // user input
  const [loading, setLoading] = useState<boolean>(false);

  // Fetch random room stream
  const fetchRandomRoom = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/random-stream-url");
      const data = await res.json();
      setStreamUrl(data.url);
    } catch {
      setStreamUrl(null);
    } finally {
      setLoading(false);
    }
  };

  // Fetch specific room stream
  const fetchSpecificRoom = async () => {
    if (!roomId.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stream-url-by-roomId?roomId=${roomId}`);
      const data = await res.json();
      setStreamUrl(data.url);
    } catch {
      setStreamUrl(null);
    } finally {
      setLoading(false);
    }
  };

  // Setup HLS whenever streamUrl changes
  useEffect(() => {
    if (streamUrl && videoRef.current) {
      if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(streamUrl);
        hls.attachMedia(videoRef.current);
        return () => {
          hls.destroy();
        };
      } else if (
        videoRef.current.canPlayType("application/vnd.apple.mpegurl")
      ) {
        videoRef.current.src = streamUrl;
      }
    }
  }, [streamUrl]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Live Stream</h1>

      <div className="flex gap-4 mb-6">
        <button
          onClick={fetchRandomRoom}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          Watch Random Room
        </button>

        <input
          type="text"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="border rounded-lg px-3 py-2"
        />
        <button
          onClick={fetchSpecificRoom}
          className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
        >
          Watch Specific Room
        </button>
      </div>

      <div className="flex items-center justify-center w-full h-screen">
        {loading ? (
          <p>Loading stream...</p>
        ) : streamUrl ? (
          <video
            ref={videoRef}
            controls
            autoPlay
            style={{ width: "100%", maxHeight: "1500px" }}
          />
        ) : (
          <p>No stream loaded</p>
        )}
      </div>
    </div>
  );
}
