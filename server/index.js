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
  const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
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

  // Step 1: Submit to fal.ai queue
  const submitRes = await axios.post(
    "https://queue.fal.run/fal-ai/flux/schnell",
    { prompt, image_size: "square", num_images: 1 },
    {
      headers: {
        Authorization: `Key ${process.env.FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );

  const requestId = submitRes.data?.request_id;
  if (!requestId) throw new Error("fal.ai: no request_id returned");

  // Step 2: Poll for result
  let imageUrl = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await axios.get(
      `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}`,
      {
        headers: { Authorization: `Key ${process.env.FAL_API_KEY}` },
        timeout: 10000,
      }
    );
    const status = statusRes.data?.status;
    if (status === "COMPLETED") {
      imageUrl = statusRes.data?.output?.images?.[0]?.url || null;
      break;
    } else if (status === "FAILED") {
      throw new Error("fal.ai: generation failed");
    }
  }

  if (!imageUrl) throw new Error("fal.ai: timed out waiting for image");

  // Step 3: Download and save to disk (fal.ai URLs expire)
  const imgRes = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 30000 });
  const filename = `kural_${kural.number}.jpg`;
  fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(imgRes.data));
  const hostedUrl = `${baseUrl}/image/${filename}`;

  imageCache.set(cacheKey, hostedUrl);
  console.log("Image saved:", filename);
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
    if (process.env.ab418d4d-cb24-4958-9451-c44923851ae3:f4e7349eae6c81886a3b01eae988a81f) {
      try {
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        image_url = await generateImage(kural, baseUrl);
      } catch (imgErr) {
        console.error("Image generation failed:", imgErr.message);
        image_url = null;
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
