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
      maxRedirects: 5,
    });

    const contentType = (response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      console.warn("Image proxy: upstream returned non-image content-type:", response.headers["content-type"]);
      return res.status(502).json({ error: "Upstream did not return an image" });
    }

    res.setHeader("Content-Type", response.headers["content-type"] || "image/png");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error("Image proxy error", err.message);
    res.status(502).json({ error: "Failed to fetch image" });
  }
});

export default router;

