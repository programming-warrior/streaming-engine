import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

async function createSdpFile(streamInfo: any, outputPath: string) {
  const sdpContent = `
v=0
o=- 0 0 IN IP4 ${streamInfo.listenIp}
s=Mediasoup-Broadcast
c=IN IP4 ${streamInfo.listenIp}
t=0 0
m=video ${streamInfo.stream1.videoPort} RTP/AVP ${streamInfo.stream1.videoPayloadType}
a=rtpmap:${streamInfo.stream1.videoPayloadType} ${streamInfo.stream1.videoCodec}/90000
m=video ${streamInfo.stream2.videoPort} RTP/AVP ${streamInfo.stream2.videoPayloadType}
a=rtpmap:${streamInfo.stream2.videoPayloadType} ${streamInfo.stream2.videoCodec}/90000
  `.trim();

  try {
    // Ensure the directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    fs.writeFileSync(outputPath, sdpContent);
    console.log(`SDP file created at: ${outputPath}`);
  } catch (error) {
    console.error("Error creating SDP file:", error);
  }
}

app.post("/api/start", async (req: Request, res: Response) => {
  const { listenIp, stream, outputDir, roomId } = req.body;
  if (!listenIp || !outputDir || !stream || !roomId) {
    return res.status(400).json({ error: "invalid parameters" });
  }

  try {
    let outputPath = "tmp/" + `stream-${roomId}.sdp`;
    await createSdpFile(stream, outputPath);

    res.status(201).json({ message: "success" });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

const PORT = 4002;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
