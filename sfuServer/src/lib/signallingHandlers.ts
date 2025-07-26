import { send } from "./handleSocketConnection";
import { router } from "../mediaSoupManager";
import { config } from "../config/mediasoupConfig";
import { streamRoom } from "./handleSocketConnection";

export function handleGetRouterRtpCapabilities(socket: any, payload: any) {
  if (!router) return;
  send(socket, "routerRtpCapabilities", router.rtpCapabilities);
}

export async  function handleCreateWebRtcTransport(socket: any, payload: any) {
  try {
    if (!router) return;
    const transport = await router.createWebRtcTransport(
      config.mediasoup.webRtcTransportOptions
    );

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        console.log(`Transport closed for peer`);
        transport.close();
      }
    });

    // Store the transport with the peer
    // peers.set(ws, { transport });

    send(socket, "webRtcTransportCreated", {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    });
  } catch (error) {
    console.error("Failed to create WebRTC transport:", error);
    send(socket, "error", { message: "Failed to create transport" });
  }
}

export function handleConnectWebRtcTransport(socket: any, payload: any) {}
