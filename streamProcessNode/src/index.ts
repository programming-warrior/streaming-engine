import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { exec, spawn } from "child_process";
import net from "net";
import dgram from "dgram";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

// Port1: 42409 Port2: 40752
const port1 = 42409;
const port2 = 40752;

const CONTAINER_IP = "172.25.0.10";

async function createSdpFile(
  containerIp: string,
  streamInfo: any,
  outputPath: string
) {
  // VP8-optimized SDP with better RTP parameters
  const sdpContent = `v=0
o=- 0 0 IN IP4 ${process.env.BIND_IP}
s=Mediasoup-Broadcast
c=IN IP4 ${process.env.BIND_IP}
t=0 0
a=tool:ffmpeg
m=video ${streamInfo[0].videoPort} RTP/AVP ${streamInfo[0].videoPayloadType}
c=IN IP4 ${process.env.BIND_IP}
a=rtpmap:${streamInfo[0].videoPayloadType} VP8/90000
a=framerate:30
a=fmtp:${streamInfo[0].videoPayloadType} max-fr=30;max-fs=8160;picture-id=15
a=recvonly
a=rtcp-fb:${streamInfo[0].videoPayloadType} nack
a=rtcp-fb:${streamInfo[0].videoPayloadType} nack pli
a=rtcp-fb:${streamInfo[0].videoPayloadType} ccm fir
m=video ${streamInfo[1].videoPort} RTP/AVP ${streamInfo[1].videoPayloadType}
c=IN IP4 ${process.env.BIND_IP}
a=rtpmap:${streamInfo[1].videoPayloadType} VP8/90000
a=framerate:30
a=fmtp:${streamInfo[1].videoPayloadType} max-fr=30;max-fs=8160;picture-id=15
a=recvonly
a=rtcp-fb:${streamInfo[1].videoPayloadType} nack
a=rtcp-fb:${streamInfo[1].videoPayloadType} nack pli
a=rtcp-fb:${streamInfo[1].videoPayloadType} ccm fir`;

  try {
    const fullOutputPath = path.join(__dirname, outputPath);

    if (!fs.existsSync(path.dirname(fullOutputPath))) {
      fs.mkdirSync(path.dirname(fullOutputPath), { recursive: true });
    }

    fs.writeFileSync(fullOutputPath, sdpContent);
    console.log(`SDP file created at: ${outputPath}`);
    return fullOutputPath;
  } catch (error) {
    console.error("Error creating SDP file:", error);
    throw error;
  }
}

app.post("/api/start", async (req: Request, res: Response) => {
  const { listenIp, streams, outputDir, roomId } = req.body;

  if (!streams || !roomId) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  try {
    // Extract ports for verification
    const ports = streams.map((stream: any) => stream.videoPort);

    console.log(" Creating SDP file...");
    const outputPath = path.join("tmp", `stream-${roomId}.sdp`);
    const fullSdpPath = await createSdpFile(CONTAINER_IP, streams, outputPath);

    const portMappings = streams
      .map((stream: any) => `-p ${stream.videoPort}:${stream.videoPort}/udp`)
      .join(" ");

    console.log(portMappings);

    // monitorUdpPort(streams[0].videoPort);
    // monitorUdpPort(streams[1].videoPort);

    // Simplified Docker command focusing on the core issue
    const dockerCmd =
      `sudo docker run --rm ${portMappings} ` +
      `--ulimit nofile=65536:65536 ` + // Increase file descriptor limits
      `-e S3_BUCKET=${process.env.AWS_S3_BUCKET} ` +
      `-e AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY} ` +
      `-e AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_KEY} ` +
      `-e AWS_REGION=${process.env.AWS_REGION} ` +
      `-v "${fullSdpPath}":/app/stream.sdp ` +
      `--name streaming-container-${roomId} ` +
      `${process.env.FFMPEG_DOCKERIMAGE_URL}`;

    console.log("Executing Docker command:", dockerCmd);

    const dockerProcess = exec(
      dockerCmd,
      {
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for logs
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Error:", error.message);
          console.error("Signal:", error.signal);
        }
        console.log("STDOUT:", stdout);
        console.log("STDERR:", stderr);
      }
    );

    let stdout = "";
    let stderr = "";

    dockerProcess.stdout?.on("data", (data) => {
      stdout += data;
      console.log("Docker stdout:", data.toString());
    });

    dockerProcess.stderr?.on("data", (data) => {
      stderr += data;
      console.log("Docker stderr:", data.toString());
    });

    dockerProcess.on("close", (code) => {
      if (code === 0) {
        console.log("Docker process completed successfully");
      } else {
        console.error(`Docker process exited with code ${code}`);
      }
    });

    dockerProcess.on("error", (error) => {
      console.error("Docker execution error:", error);
      res.status(500).json({
        error: "Failed to start Docker container",
        details: error.message,
      });
    });

    return res.status(202).json({
      message: "Container started",
    });
  } catch (e: any) {
    console.error("Server error:", e);
    return res.status(500).json({ error: e.message });
  }
});

const PORT = 4002;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Optional: Add UDP socket monitoring for debugging
function monitorUdpPort(port: number) {
  const socket = dgram.createSocket("udp4");

  socket.on("message", (msg, rinfo) => {
    console.log(
      `[Port ${port}] RTP Packet from ${rinfo.address}:${rinfo.port}, size: ${msg.length}`
    );
  });

  socket.on("listening", () => {
    const address = socket.address();
    console.log(`UDP Monitor listening on ${address.address}:${address.port}`);
  });

  socket.on("error", (err) => {
    console.error(`UDP Monitor error on port ${port}:`, err);
  });

  try {
    socket.bind(port);
  } catch (error) {
    console.error(`Failed to bind UDP monitor to port ${port}:`, error);
  }

  return socket;
}

// Uncomment to enable UDP monitoring
