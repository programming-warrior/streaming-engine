"use client";

import { useEffect, useRef, useState } from "react";
import { Device } from "mediasoup-client";
import { Transport } from "mediasoup-client/types";
import { useRouter } from "next/navigation";
// import { Transport } from 'mediasoup-client/lib/Transport';

export default function StreamPage() {
  const [isStreaming, setIsStreaming] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const receiveVideoRef = useRef<HTMLVideoElement>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const receiveTransportRef = useRef<Transport | null>(null);
  const router = useRouter();

  const ws_url = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";

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

  useEffect(() => {
    localStorage.setItem("roomId", roomId || "");
  }, [roomId]);

  //   useEffect(()=>{
  //     localStorage.setItem("userId", userId || "");
  //   },[userId])

  const handleWelcome = (data: any, socket: WebSocket) => {
    console.log("Welcome message received:", data);
    const { userId } = data;
    console.log(`User ID: ${userId}`);
    // localStorage.setItem("userId", userId);
  };

  const handleConsumed = async (data: any) => {
    const { id, kind, producerId, rtpParameters } = data;
    const device = deviceRef.current;
    if (!device) {
      console.error("Device not initialized");
      return;
    }

    if (receiveTransportRef.current) {
      receiveTransportRef.current
        .consume({
          id,
          producerId,
          kind,
          rtpParameters,
        })
        .then((consumer) => {
          console.log("Consumer created:", consumer);
          if (!receiveVideoRef.current) {
            console.error("Receive video element not found");
            return;
          }

          receiveVideoRef.current.srcObject = new MediaStream([consumer.track]);
          receiveVideoRef.current.play().catch((error) => {
            console.error("Error playing video:", error);
          });
        })
        .catch((error) => {
          console.error("Error consuming:", error);
        });
    }
  };

  const handlePeerMatched = (data: any, socket: WebSocket) => {
    console.log("Peer matched:", data);
    const { roomId } = data;
    setRoomId(roomId);
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
    routerRtpCapabilities: any,
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
      console.log(socket);
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

    const sendTransport = device.createSendTransport(params.sendTransport);
    const receiveTransport = device.createRecvTransport(
      params.receiveTransport
    );

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
      try {
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
          if (message.type === "produceSuccess") {
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
    });
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
    const track = stream.getVideoTracks()[0];
    await sendTransport.produce({ track });
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
          <video ref={videoRef} autoPlay muted className="w-1/2" />
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
        {!isStreaming && <button onClick={startStreaming} className="bg-red-600 text-white  rounded-sm min-w-[100px] px-1 py-0.5 cursor-pointer">Join</button>}
        {isStreaming && <button onClick={stopStreaming} className="bg-red-600 text-white rounded-sm min-w-[100px] px-1 py-0.5 cursor-pointer">Leave</button>}
      </div>
    </div>
  );
}
