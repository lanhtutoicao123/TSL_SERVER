const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const winston = require("winston");
const WebSocket = require("ws");

const app = express();
const PORT = 3000;

// Logger setup
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) =>
      `${timestamp} [${level}]: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(logsDir, "server.log") }),
  ],
});

// CORS
app.use(cors({
  // This is the test for frontend : API REQUEST https://tsl-client.vercel.app
  origin: "https://tsl-client.vercel.app",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Serve static processed files
const processedDir = path.join(__dirname, "processed");
const uploadsDir = path.join(__dirname, "uploads");
app.use("/processed", express.static(processedDir));

[processedDir, uploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer config
const upload = multer({
  dest: uploadsDir,
  fileFilter: (req, file, cb) => {
    const isEncode = req.path.includes("upload");
    const isDecode = req.path.includes("decode");

    if (isEncode && !file.originalname.match(/\.(txt)$/)) {
      return cb(new Error("Only .txt files are allowed for encoding!"));
    }
    if (isDecode && !file.originalname.match(/\.(huf)$/)) {
      return cb(new Error("Only .huf files are allowed for decoding!"));
    }
    cb(null, true);
  },
});

// WebSocket setup
const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws) => {
  logger.info("WebSocket connection established.");
  ws.on("message", (msg) => {
    logger.info(`WebSocket received: ${msg}`);
    ws.send(`Server received: ${msg}`);
  });
  ws.on("close", () => logger.info("WebSocket connection closed."));
});

// ENCODE endpoint
app.post("/api/files/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded." });

    const filePath = path.join(uploadsDir, req.file.filename);
    logger.info(`Reading file: ${filePath}`);
    const content = await fs.promises.readFile(filePath, "utf8");

    const result = await runPythonScript("python/huffman.py", ["encode", content]);
    const { encoded_data, crc , codes, tree_image_base64, frequencies, probabilities, build_steps } = JSON.parse(result);

    const outputName = `${Date.now()}_encoded.huf`;
    const outputPath = path.join(processedDir, outputName);

    const hufContent = [
      `Encoded Data: ${encoded_data}`,
      `CRC: ${crc}`,
      `Codes: ${JSON.stringify(codes, null, 2)}`
    ].join("\n\n");

    await fs.promises.writeFile(outputPath, hufContent);

    await fs.promises.unlink(filePath);

    console.log({
      encoded_data,
      crc,
      codes,
      tree_image_base64,
      frequencies,
      probabilities,
      build_steps
    });

    res.status(200).json({
      message: "File encoded successfully",
      encodedData: encoded_data,
      crc: crc,
      downloadUrl: `/api/files/download/${outputName}`,
      filename: outputName,
      codes: codes, 
      tree_image_base64: tree_image_base64, 
      frequencies: frequencies,
      probabilities: probabilities,
      buildSteps: build_steps, // ✅ Sửa đúng tên key theo camelCase
      build_steps: build_steps // (Optional) vẫn giữ thêm nếu frontend fallback
    });
  } catch (err) {
    logger.error("Encoding failed:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// DECODE endpoint
app.post("/api/files/decode", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded." });

    const filePath = path.join(uploadsDir, req.file.filename);
    const hufContent = await fs.promises.readFile(filePath, "utf8");

    const encodedDataMatch = hufContent.match(/Encoded Data: (.*)/);
    const crcMatch = hufContent.match(/CRC: (.*)/);

    if (!encodedDataMatch || !crcMatch)
      throw new Error("Invalid .huf file format");

    const encodedData = encodedDataMatch[1].trim();
    const crc = parseInt(crcMatch[1].trim());

    const result = await runPythonScript("python/huffman.py", ["decode", encodedData]);
    const { decoded_data } = JSON.parse(result);

    const outputName = `${Date.now()}_decoded.huf`;
    const outputPath = path.join(processedDir, outputName);
    await fs.promises.writeFile(outputPath, decoded_data);
    await fs.promises.unlink(filePath);

    res.status(200).json({
      message: "File decoded successfully",
      decodedData: decoded_data,
      crc: crc,
      downloadUrl: `/api/files/download/${outputName}`,
      filename: outputName,
    });
  } catch (err) {
    logger.error("Decoding failed:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.get("/api/files/download/:filename", (req, res) => {
  const fileName = req.params.filename;
  const filePath = path.join(processedDir, fileName);

  fs.promises.stat(filePath)
    .then(() => {
      res.download(filePath, fileName, (err) => {
        if (err) {
          logger.error(`Error downloading file: ${fileName}`, err);
          res.status(500).json({ message: "Error downloading file", error: err.message });
        }
      });
    })
    .catch((err) => {
      logger.error(`File not found: ${fileName}`, err);
      res.status(404).json({ message: "File not found" });
    });
});

// Run Python script helper
function runPythonScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    logger.info(`Executing script: ${scriptPath} with args: ${args}`);
    const process = spawn("python", [scriptPath, ...args]);

    let output = "";
    let errorOutput = "";

    process.stdout.on("data", (data) => output += data.toString());
    process.stderr.on("data", (data) => errorOutput += data.toString());

    process.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(output);
        } catch (err) {
          reject(`JSON parse error: ${err.message}`);
        }
      } else {
        reject(`Python exited with code ${code}: ${errorOutput}`);
      }
    });
  });
}

// Start HTTP server
const server = app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
});

// WebSocket upgrade handler
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// Export app for testing
module.exports = app;