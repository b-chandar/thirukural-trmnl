const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const kuralCache = new NodeCache({ stdTTL: 86400 });
const imageCache = new NodeCache({ stdTTL: 82800 });

const IMAGE_DIR = path.join(__dirname, "images");
if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

function dailyKuralNumber() {
  const now = new Date();
  const dayIndex = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  return (dayIndex % 1330) + 1;
}

async function fetchKural(num) {
  const cacheKey = `kural_${num}`;
  const cached = kuralCache.get(cacheKey);
  if (cached) return cached;
  const response = await axios.get(
    `https://tamil-kural-api.vercel.app/api/kural/${num}`,
    { timeout: 10000 }
  );
  kuralCache.set(cacheKey, response.data);
  return response.data;
}

async function generateImage(kural, baseUrl) {
  const cacheKey = `img_${kural.number}`;
  const cached = imageCache.get(cacheKey);
  if (cached) return cached;

  const englishMeaning = kural.meaning?.en || "";
  const chapter = kural.chapter || "";

  const prompt = [
    "Black and white ink sketch. Fine line art on white background.",
    "Single scene illustration.",
    `Inspired by this ancient Tamil wisdom: "${englishMeaning}"`,
    `Theme: ${chapter}.`,
    "Classical Indian art style. Minimalist composition. No text, no watermarks.",
    "High contrast, suitable for e-ink grayscale display.",
  ].join(" ");

  const response = await axios.post(
    "https://openrouter.ai/api/v1/images",
    { model: "bytedance-seed/seedream-4.5", prompt },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://trmnl-thirukural.onrender.com",
        "X-Title": "Thirukural TRMNL Plugin",
      },
      timeout: 60000,
    }
  );

  const item = response.data?.data?.[0];
  let hostedUrl = null;

  if (item?.url) {
    hostedUrl = item.url;
  } else if (item?.b64_json) {
    const filename = `kural_${kural.number}.jpg`;
    const filepath = path.join(IMAGE_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(item.b64_json, "base64"));
    hostedUrl = `${baseUrl}/image/${filename}`;
    console.log("Saved image to disk:", filename);
  }

  if (hostedUrl) imageCache.set(cacheKey, hostedUrl);
  console.log("Image URL:", hostedUrl || "none");
  return hostedUrl;
}

app.use("/image", express.static(IMAGE_DIR));

app.get("/data", async (req, res) => {
  try {
    const num = dailyKuralNumber();
    const kural = await fetchKural(num);
    const lines = Array.isArray(kural.kural) ? kural.kural : [];
    const line1 = lines[0] || "";
    const line2 = lines[1] || "";
    const meaning_en = kural.meaning?.en || "";
    const meaning_ta = kural.meaning?.ta_mu_va || kural.meaning?.ta_salamon || "";
    const chapter = kural.chapter || "";
    const section = kural.section || "";
    const number = kural.number || num;

    let image_url = null;
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        image_url = await generateImage(kural, baseUrl);
      } catch (imgErr) {
        console.error("Image generation failed:", imgErr.message);
      }
    }

    res.json({ number, line1, line2, meaning_en, meaning_ta, chapter, section, image_url });
  } catch (err) {
    console.error("Error in /data:", err.message);
    res.status(500).json({ error: "Failed to fetch Thirukural", detail: err.message });
  }
});

app.get("/clear-cache", (req, res) => {
  imageCache.flushAll();
  kuralCache.flushAll();
  res.json({ status: "cache cleared" });
});

app.get("/", (req, res) =>
  res.json({ status: "ok", plugin: "Thirukural TRMNL", today: dailyKuralNumber() })
);

app.listen(PORT, () => {
  console.log(`Thirukural TRMNL server running on port ${PORT}`);
});
