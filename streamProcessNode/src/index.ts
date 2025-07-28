import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
const { exec } = require("child_process");

const app = express();
app.use(express.json());

async function createSdpFile(
  listenIp: string,
  streamInfo: any,
  outputPath: string
) {
  const sdpContent = `
v=0
o=- 0 0 IN IP4 ${listenIp}
s=Mediasoup-Broadcast
c=IN IP4 ${listenIp}
t=0 0
m=video ${streamInfo[0].videoPort} RTP/AVP ${streamInfo[0].videoPayloadType}
a=rtpmap:${streamInfo[0].videoPayloadType} ${streamInfo[0].videoCodec}/90000
m=video ${streamInfo[1].videoPort} RTP/AVP ${streamInfo[1].videoPayloadType}
a=rtpmap:${streamInfo[1].videoPayloadType} ${streamInfo[1].videoCodec}/90000
  `.trim();

  try {
    // Ensure the directory exists
    const fullOutputPath = path.join(__dirname, outputPath);

    console.log(fullOutputPath);

    console.log(path.dirname(fullOutputPath));

    console.log(fs.existsSync(path.dirname(fullOutputPath)));

    if (!fs.existsSync(path.dirname(fullOutputPath))) {
      console.log("creating directory");
      fs.mkdirSync(path.dirname(fullOutputPath), { recursive: true });
    }
    console.log("writing to the file");
    fs.writeFileSync(fullOutputPath, sdpContent);
    console.log(`SDP file created at: ${outputPath}`);
  } catch (error) {
    console.error("Error creating SDP file:", error);
  }
}

app.post("/api/start", async (req: Request, res: Response) => {
  const { listenIp, streams, outputDir, roomId } = req.body;
  console.log(req.body);
  if (!listenIp || !outputDir || !streams || !roomId) {
    return res.status(400).json({ error: "invalid parameters" });
  }

  try {
    let outputPath = path.join("tmp", `stream-${roomId}.sdp`);
    await createSdpFile(listenIp, streams, outputPath);
    // run the docker container
    //DOCKER COMMAND: ---

    const dockerCmd = `docker run --rm -v ${path.join(
      __dirname,
      outputPath
    )}:/input.sdp your-docker-image-name:latest`;

    // Run the Docker command
    exec(dockerCmd, (error: any, stdout: string, stderr: string) => {
      if (error) {
        console.error(`Docker error: ${error.message}`);
        return res
          .status(500)
          .json({ error: "Failed to start Docker container" });
      }
      if (stderr) {
        console.error(`Docker stderr: ${stderr}`);
      }
      console.log(`Docker stdout: ${stdout}`);
      // Send 201 response after successful start
      res
        .status(201)
        .json({ message: "Docker container started successfully" });
    });

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
