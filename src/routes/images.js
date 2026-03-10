import express from "express";
import axios from "axios";

const router = express.Router();

const ALLOWED_PREFIXES = [
  "https://api.steamapis.com/image/item/",
  "https://community.cloudflare.steamstatic.com/economy/image/",
];

router.get("/proxy", async (req, res) => {
  try {
    const url = req.query.url;
    if (typeof url !== "string" || !url) {
      return res.status(400).json({ error: "Missing url parameter" });
    }

    const decoded = decodeURIComponent(url);
    if (!ALLOWED_PREFIXES.some((p) => decoded.startsWith(p))) {
      return res.status(400).json({ error: "URL not allowed" });
    }

    const response = await axios.get(decoded, {
      responseType: "arraybuffer",
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = response.headers["content-type"] || "image/png";
    res.setHeader("Content-Type", contentType);
    // Allow any frontend origin to use this image in WebGL textures.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error("Image proxy error", err.message);
    res.status(502).json({ error: "Failed to fetch image" });
  }
});

export default router;

