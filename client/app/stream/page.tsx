"use client";

import { useEffect, useRef, useState } from "react";
import { Device } from "mediasoup-client";
import { Transport } from "mediasoup-client/types";
import { useRouter } from "next/navigation";
import { RtpCapabilities } from "mediasoup-client/types";
import {
Mic,
MicOff,
Video,
VideoOff
} from "lucide-react";

// import { Transport } from 'mediasoup-client/lib/Transport';

export default function StreamPage() {
  const [isStreaming, setIsStreaming] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const receiveVideoRef = useRef<HTMLVideoElement>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const receiveTransportRef = useRef<Transport | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const router = useRouter();
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [hasRemoteAudio, setHasRemoteAudio] = useState(false);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const videoProducerRef = useRef<any | null>(null);
  const audioProducerRef = useRef<any | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);

  const ws_url = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";

  const toggleCamera = () => {
    if (videoTrackRef.current) {
      videoTrackRef.current.enabled = !isCameraOn;
      setIsCameraOn(!isCameraOn);
    }
  };

  const toggleMic = () => {
    if (audioTrackRef.current) {
      audioTrackRef.current.enabled = !isMicOn;
      setIsMicOn(!isMicOn);
    }
  };
  useEffect(() => {
    const ws = new WebSocket(ws_url);
    ws.onopen = () => {
      console.log("Connected to websocket");
      setSocket(ws);
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      console.log("Received message:", message);

      switch (message.event) {
        case "welcome":
          handleWelcome(message.payload, ws);
          break;
        case "routerRtpCapabilities":
          handleRouterRtpCapabilities(message.payload, ws);
          break;
        case "webRtcTransportCreated":
          handleWebRtcTransportCreated(message.payload, ws);
          break;
        case "matched":
          handlePeerMatched(message.payload, ws);
          break;
        case "consumed":
          handleConsumed(message.payload);
        default:
          break;
      }
    };

    ws.onclose = () => {
      console.log("Disconnected from websocket");
      setSocket(null);
    };

    return () => {
      ws.close();
    };
  }, []);

  //   useEffect(()=>{
  //     localStorage.setItem("userId", userId || "");
  //   },[userId])

  const handleWelcome = (data: any, socket: WebSocket) => {
    console.log("Welcome message received:", data);
    const { userId } = data;
    console.log(`User ID: ${userId}`);
    localStorage.setItem("userId", userId);
  };

  const handleConsumed = async (data: any) => {
    const { id, kind, producerId, rtpParameters } = data;
    const device = deviceRef.current;
    if (!device) {
      console.error("Device not initialized");
      return;
    }

    if (receiveTransportRef.current) {
      try {
        const consumer = await receiveTransportRef.current.consume({
          id,
          producerId,
          kind,
          rtpParameters,
        });

        console.log(`Consumer created for ${kind}:`, consumer);

        if (!receiveVideoRef.current) {
          console.error("Receive video element not found");
          return;
        }

        if (!remoteStreamRef.current) {
          console.log("instantiating remoteStreamRef");
          remoteStreamRef.current = new MediaStream();
        }
        console.log(remoteStreamRef.current);
        // Add the track to the remote stream
        remoteStreamRef.current?.addTrack(consumer.track);

        // Update state based on track kind
        if (kind === "video") {
          setHasRemoteVideo(true);
        } else if (kind === "audio") {
          setHasRemoteAudio(true);
        }

        // Set the stream as the source for the video element
        receiveVideoRef.current.srcObject = remoteStreamRef.current;

        // Play the video element
        try {
          if (kind === "video") {
            await receiveVideoRef.current.play();
            console.log(`Playing media with ${kind} track`);
          }
        } catch (playError: any) {
          console.error("Error playing media:", playError);
          // Handle autoplay policy restrictions
          if (playError.name === "NotAllowedError") {
            console.log("Autoplay prevented - user interaction required");
          }
        }

        console.log(
          `${kind} track added. Video: ${hasRemoteVideo}, Audio: ${hasRemoteAudio}`
        );
      } catch (error) {
        console.error(`Error consuming ${kind}:`, error);
      }
    }
  };

  const handlePeerMatched = (data: any, socket: WebSocket) => {
    console.log("Peer matched:", data);
    const { roomId } = data;
    roomIdRef.current = roomId;
    const device = deviceRef.current;
    if (!device) {
      console.error("Device not initialized");
      return;
    }
    console.log("Sending consume message");
    console.log(device.rtpCapabilities);
    socket?.send(
      JSON.stringify({
        event: "consume",
        payload: { roomId, rtpCapabilities: device.rtpCapabilities },
      })
    );
  };

  const handleRouterRtpCapabilities = async (
    routerRtpCapabilities: RtpCapabilities,
    socket: WebSocket
  ) => {
    try {
      console.log("routerRtpCapabilities handler called");
      const device = new Device();
      await device.load({ routerRtpCapabilities });
      if (!device.canProduce("video")) {
        console.error("Cannot produce video");
        return;
      }
      deviceRef.current = device;
      console.log("sending createWebRtcTransport");
      socket?.send(JSON.stringify({ event: "createWebRtcTransport" }));
      console.log("sent createWebRtcTransport");
    } catch (error) {
      console.error("Error loading device:", error);
    }
  };

  const handleWebRtcTransportCreated = async (
    params: any,
    socket: WebSocket
  ) => {
    const device = deviceRef.current;
    if (!device) {
      console.error("Device not initialized");
      return;
    }

    const sendTransport = device.createSendTransport({
      ...params.sendTransport,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    const receiveTransport = device.createRecvTransport({
      ...params.receiveTransport,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    sendTransportRef.current = sendTransport;
    receiveTransportRef.current = receiveTransport;

    receiveTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        socket.send(
          JSON.stringify({
            event: "connectWebRtcTransport",
            payload: { dtlsParameters, transportId: receiveTransport.id },
          })
        );
        socket.addEventListener(
          "message",
          function onReceiveTransportConnected(event) {
            const message = JSON.parse(event.data);
            if (message.event === "webRtcTransportConnected") {
              socket.send(
                JSON.stringify({
                  event: "resume",
                  payload: { roomId: roomIdRef.current },
                })
              );
            } else if (message.event === "consumer-resumed") {
              console.log("consumer-resumed event received");
              callback();
              socket.removeEventListener(
                "message",
                onReceiveTransportConnected
              );
            }
          }
        );
      }
    );

    sendTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        socket.send(
          JSON.stringify({
            event: "connectWebRtcTransport",
            payload: { dtlsParameters, transportId: sendTransport.id },
          })
        );
        socket.addEventListener(
          "message",
          function onSendTransportConnected(event) {
            const message = JSON.parse(event.data);
            if (message.event === "webRtcTransportConnected") {
              callback();
              socket.removeEventListener("message", onSendTransportConnected);
            }
          }
        );
      }
    );

    sendTransport.on("produce", async (parameters, callback, errback) => {
      console.log(parameters);
      try {
        console.log(
          "sending produce event to server for kind: ",
          parameters.kind
        );
        socket.send(
          JSON.stringify({
            event: "produce",
            payload: {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
            },
          })
        );
        socket.addEventListener("message", function onProduceSuccess(event) {
          const message = JSON.parse(event.data);
          if (message.event === "produceSuccess") {
            console.log("calling callback for kind: ", parameters.kind);
            callback({ id: message.producerId });
            socket.removeEventListener("message", onProduceSuccess);
          }
        });
      } catch (error) {
        errback(error as Error);
      }
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    videoTrackRef.current = videoTrack;
    audioTrackRef.current = audioTrack;

    audioProducerRef.current = await sendTransport.produce({
      track: audioTrack,
    });
    videoProducerRef.current = await sendTransport.produce({
      track: videoTrack,
    });
  };

  const startStreaming = async () => {
    setIsStreaming(true);
    socket?.send(JSON.stringify({ event: "getRouterRtpCapabilities" }));
  };

  const stopStreaming = () => {
    setIsStreaming(false);
    sendTransportRef.current?.close();
    sendTransportRef.current = null;
    router.push("/");
  };

  return (
    <div className="min-h-screen p-10">
      <div className="w-full flex items-center justify-center min-h-[500px]">
        <div className="flex items-center  w-full">
          <video ref={videoRef} autoPlay className="w-1/2" />
          <video
            ref={receiveVideoRef}
            autoPlay
            muted
            playsInline
            className="w-1/2"
          />
        </div>
      </div>
      <div className="mt-8 flex items-center justify-center">
        
        <div className="mt-8 flex items-center justify-center space-x-4">
          {isStreaming && (
            <>
              <button
                onClick={toggleCamera}
                  className="bg-red-500 text-white rounded-full  p-2 cursor-pointer"
              >
                {isCameraOn ? <Video/> : <VideoOff/>}
              </button>
              <button
                onClick={toggleMic}
                className="bg-red-500 text-white rounded-full  p-2 cursor-pointer"
              >
                {isMicOn ? <Mic/> : <MicOff/>}
              </button>
              <button
                onClick={stopStreaming}
                className="bg-red-600 text-white rounded-sm min-w-[100px] px-1 py-0.5 cursor-pointer"
              >
                Leave
              </button>
            </>
          )}
          {!isStreaming && (
            <button
              onClick={startStreaming}
              className="bg-red-600 text-white rounded-sm min-w-[100px] px-1 py-0.5 cursor-pointer"
            >
              Join
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
