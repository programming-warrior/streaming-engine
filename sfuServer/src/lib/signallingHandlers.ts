import { send } from "./handleSocketConnection";
import { router } from "../mediaSoupManager";
import { config } from "../config/mediasoupConfig";
import { streamRoom } from "./handleSocketConnection";
import { socketTransportsMap } from "../mediaSoupManager";

export function handleGetRouterRtpCapabilities(socket: any) {
  if (!router) return;
  send(socket, "routerRtpCapabilities", router.rtpCapabilities);
}

export async function handleCreateWebRtcTransport(socket: any) {
  try {
    if (!router) return;
    const transport = await router.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        console.log(`Transport closed for user`);
        transport.close();
      }
    });

    socketTransportsMap.set(socket, { transport });

    send(socket, "webRtcTransportCreated", {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  } catch (error) {
    console.error("Failed to create WebRTC transport:", error);
    send(socket, "error", { error: "Failed to create transport" });
  }
}

export async function handleConnectWebRtcTransport(socket: any, payload: any) {
  const { dtlsParameters, transportId } = payload;

  if (!dtlsParameters || !transportId) {
    console.error("Invalid parameters for connecting WebRTC transport");
    send(socket, "error", { error: "Invalid parameters" });
    return;
  }

  const peer = socketTransportsMap.get(socket);
  if (!peer || !peer.transport || peer.transport.id !== transportId) {
    console.error("Transport not found");
    send(socket, "error", { error: "Transport not found" });
    return;
  }

  try {
    await peer.transport.connect({ dtlsParameters });
    send(socket, "webRtcTransportConnected", {});
  } catch (error) {
    console.error("Failed to connect WebRTC transport:", error);
    send(socket, "error", { error: "Failed to connect transport" });
  }
}


export async function handleProduce(socket: any, payload: any) {
  const { kind, rtpParameters, transportId } = payload;

  if (!kind || !rtpParameters || !transportId) {
    console.error("Invalid parameters for producing");
    send(socket, "error", { error: "Invalid parameters" });
    return;
  }

  const peer = socketTransportsMap.get(socket);
  if (!peer || !peer.transport || peer.transport.id !== transportId) {
    console.error("Transport not found for producing");
    send(socket, "error", { error: "Transport not found" });
    return;
  }
  const producer = await peer.transport.produce({ kind, rtpParameters });
  peer.producer = producer;

  send(socket, "produceSuccess", { id: producer.id });
}