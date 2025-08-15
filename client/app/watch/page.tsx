"use client";

import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

export default function WatchPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    // Fetch the live stream URL from the API
    fetch("/api/live-stream-url")
      .then((res) => res.json())
      .then((data) => setStreamUrl(data.url))
      .catch(() => setStreamUrl(null));
  }, []);

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
    <div>
      <h1>Live Stream</h1>
      <div className="flex items-center justify-center w-full h-screen">
        {streamUrl ? (
          <video ref={videoRef} controls autoPlay style={{ width: "100%", maxHeight:"1500px" }} />
        ) : (
          <p>Loading stream...</p>
        )}
      </div>
    </div>
  );
}
