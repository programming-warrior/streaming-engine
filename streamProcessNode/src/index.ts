import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

async function createSdpFile(streamInfo: any[], sdpFilePath: string) {
  // Base SDP content
  let sdpContent = `v=0
o=- 0 0 IN IP4 ${process.env.BIND_IP}
s=Mediasoup-Broadcast
c=IN IP4 ${process.env.BIND_IP}
t=0 0
`;

  // Dynamically add media descriptions for each stream
  streamInfo.forEach((stream) => {
    // Add Video part
    if (stream.video) {
      sdpContent += `m=video ${stream.video.port} RTP/AVP ${stream.video.payloadType}\n`;
      sdpContent += `a=rtpmap:${stream.video.payloadType} VP8/90000\n`;
      sdpContent += `a=framerate:30\n`;
      sdpContent += `a=fmtp:${stream.video.payloadType} max-fr=30;max-fs=8160\n`;
    }
    // Add Audio part 🔊
    if (stream.audio) {
      sdpContent += `m=audio ${stream.audio.port} RTP/AVP ${stream.audio.payloadType}\n`;
      sdpContent += `a=rtpmap:${stream.audio.payloadType} opus/48000/2\n`;
    }
  });

  try {
    const fullOutputPath = path.join(__dirname, sdpFilePath);

    if (!fs.existsSync(path.dirname(fullOutputPath))) {
      fs.mkdirSync(path.dirname(fullOutputPath), { recursive: true });
    }

    fs.writeFileSync(fullOutputPath, sdpContent);
    console.log(`SDP file created at: ${sdpFilePath}`);
    console.log("--- SDP Content ---");
    console.log(sdpContent);
    console.log("-------------------");
    return fullOutputPath;
  } catch (error) {
    console.error("Error creating SDP file:", error);
    throw error;
  }
}

app.post("/api/start", async (req: Request, res: Response) => {
  const { streams, roomId } = req.body;

  if (!streams || !roomId) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  try {
    console.log(" Creating SDP file...");
    const sdpFilePath = path.join("tmp", `stream-${roomId}.sdp`);
    const fullSdpPath = await createSdpFile(streams, sdpFilePath);
    const outputPath = path.join(__dirname, "output");
    const portMappings = streams
      .flatMap((stream: any) => [
        `-p ${stream.video.port}:${stream.video.port}/udp`,
        `-p ${stream.audio.port}:${stream.audio.port}/udp`,
      ])
      .join(" ");

    console.log("Updated Port Mappings:", portMappings);

    console.log(portMappings);
    console.log("outpath: ", outputPath);

    // monitorUdpPort(streams[0].videoPort);
    // monitorUdpPort(streams[1].videoPort);

    // Simplified Docker command focusing on the core issue
    const dockerCmd =
      `docker run --rm ${portMappings} ` +
      `-e S3_BUCKET=${process.env.AWS_S3_BUCKET} ` +
      `-e AWS_ACCESS_KEY_ID=${process.env.AWS_ACCESS_KEY} ` +
      `-e AWS_SECRET_ACCESS_KEY=${process.env.AWS_SECRET_KEY} ` +
      `-e AWS_REGION=${process.env.AWS_REGION} ` +
      `-e ROOM_ID=${roomId} ` +
      `-v "${fullSdpPath}":/app/stream.sdp ` +
      `-v "${outputPath}":/output ` +
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
// function monitorUdpPort(port: number) {
//   const socket = dgram.createSocket("udp4");

//   socket.on("message", (msg, rinfo) => {
//     console.log(
//       `[Port ${port}] RTP Packet from ${rinfo.address}:${rinfo.port}, size: ${msg.length}`
//     );
//   });

//   socket.on("listening", () => {
//     const address = socket.address();
//     console.log(`UDP Monitor listening on ${address.address}:${address.port}`);
//   });

//   socket.on("error", (err) => {
//     console.error(`UDP Monitor error on port ${port}:`, err);
//   });

//   try {
//     socket.bind(port);
//   } catch (error) {
//     console.error(`Failed to bind UDP monitor to port ${port}:`, error);
//   }

//   return socket;
// }

// Uncomment to enable UDP monitoring
