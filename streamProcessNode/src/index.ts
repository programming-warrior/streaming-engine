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

// Function to verify MediaSoup is sending data
async function verifyRTPStreams(ports: number[], timeout = 10000): Promise<boolean> {
  console.log(`Verifying RTP streams on ports: ${ports.join(', ')}`);
  
  const promises = ports.map(port => {
    return new Promise<boolean>((resolve) => {
      const socket = dgram.createSocket('udp4');
      let packetReceived = false;
      
      const timer = setTimeout(() => {
        socket.close();
        resolve(packetReceived);
      }, timeout);
      
      socket.on('message', (msg, rinfo) => {
        console.log(`Received RTP packet on port ${port} from ${rinfo.address}:${rinfo.port}`);
        packetReceived = true;
        clearTimeout(timer);
        socket.close();
        resolve(true);
      });
      
      socket.on('error', (err) => {
        console.error(`Socket error on port ${port}:`, err);
        clearTimeout(timer);
        socket.close();
        resolve(false);
      });
      
      try {
        socket.bind(port, '0.0.0.0');
        console.log(`Listening for RTP packets on port ${port}`);
      } catch (err) {
        console.error(`Failed to bind to port ${port}:`, err);
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
  
  const results = await Promise.all(promises);
  const allReceived = results.every(result => result);
  
  console.log(`RTP verification results:`, results);
  return allReceived;
}

async function createSdpFile(
  listenIp: string,
  streamInfo: any,
  outputPath: string
) {
  // Enhanced SDP with proper video parameters
  const sdpContent = `v=0
o=- 0 0 IN IP4 ${listenIp}
s=Mediasoup-Broadcast
c=IN IP4 ${listenIp}
t=0 0
m=video ${streamInfo[0].videoPort} RTP/AVP ${streamInfo[0].videoPayloadType}
a=rtpmap:${streamInfo[0].videoPayloadType} ${streamInfo[0].videoCodec}/90000
a=framerate:30
a=fmtp:${streamInfo[0].videoPayloadType} max-fr=30;max-fs=8160
m=video ${streamInfo[1].videoPort} RTP/AVP ${streamInfo[1].videoPayloadType}
a=rtpmap:${streamInfo[1].videoPayloadType} ${streamInfo[1].videoCodec}/90000
a=framerate:30
a=fmtp:${streamInfo[1].videoPayloadType} max-fr=30;max-fs=8160`;

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
  
  if (!listenIp || !outputDir || !streams || !roomId) {
    return res.status(400).json({ error: "Invalid parameters" });
  }

  try {
    // Extract ports for verification
    const ports = streams.map((stream: any) => stream.videoPort);
    
    console.log(" Creating SDP file...");
    const outputPath = path.join("tmp", `stream-${roomId}.sdp`);
    const fullSdpPath = await createSdpFile(listenIp, streams, outputPath);
    
    // CRITICAL: Verify MediaSoup is actually sending RTP streams
    // console.log("Verifying MediaSoup RTP streams...");
    // const streamsActive = await verifyRTPStreams(ports, 15000);
    
    // if (!streamsActive) {
    //   console.error("MediaSoup streams not detected! Check your MediaSoup server.");
    //   return res.status(500).json({ 
    //     error: "MediaSoup streams not active",
    //     details: "No RTP packets detected on expected ports"
    //   });
    // }
    
    
    const portMappings = streams
      .map((stream: any) => `-p ${stream.videoPort}:${stream.videoPort}/udp`)
      .join(" ");
    
    // const outputVolume = path.join(__dirname, "output", roomId);
    // if (!fs.existsSync(outputVolume)) {
    //   fs.mkdirSync(outputVolume, { recursive: true });
    // }
    
    console.log(portMappings);

    // Add network configuration for better container connectivity
    const dockerCmd = `sudo docker run --rm  ${portMappings} -v "${fullSdpPath}":/app/stream.sdp  ${process.env.FFMPEG_DOCKERIMAGE_URL}`;
    
    console.log("Executing Docker command:", dockerCmd);
    
    const dockerProcess = exec(dockerCmd, {
      timeout: 60000, // Increased timeout
    });
    
    let stdout = '';
    let stderr = '';
    
    dockerProcess.stdout?.on('data', (data) => {
      stdout += data;
      console.log('Docker stdout:', data.toString());
    });
    
    dockerProcess.stderr?.on('data', (data) => {
      stderr += data;
      console.log('Docker stderr:', data.toString());
    });
    
    dockerProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Docker process completed successfully');
        res.status(201).json({ 
          message: "success", 
          roomId,
          outputPath: `/output/${roomId}` 
        });
      } else {
        console.error(`Docker process exited with code ${code}`);
        res.status(500).json({ 
          error: "Docker process failed", 
          code,
          details: stderr,
          stdout: stdout
        });
      }
    });
    
    dockerProcess.on('error', (error) => {
      console.error('Docker execution error:', error);
      res.status(500).json({ 
        error: "Failed to start Docker container", 
        details: error.message 
      });
    });
    
  } catch (e: any) {
    console.error('Server error:', e);
    return res.status(500).json({ error: e.message });
  }
});

const PORT = 4002;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});