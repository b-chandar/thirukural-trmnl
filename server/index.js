const express = require("express");
const axios = require("axios");
const NodeCache = require("node-cache");

const app = express();
const PORT = process.env.PORT || 3000;

// Cache kural for 24h, image URL for 23h
const kuralCache = new NodeCache({ stdTTL: 86400 });
const imageCache = new NodeCache({ stdTTL: 82800 });

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Deterministic kural number for today (UTC).
 * Same result for any call within the same UTC day.
 * Cycles through 1–1330.
 */
function dailyKuralNumber() {
  const now = new Date();
  // Days since Unix epoch (UTC)
  const dayIndex = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  return (dayIndex % 1330) + 1;
}

/**
 * Fetch a Thirukural by number.
 * Uses https://tamil-kural-api.vercel.app/api/kural/{num}
 */
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

/**
 * Generate an ink-sketch image via OpenRouter's Image API.
 * Model: black-forest-labs/flux-2-klein (cheap, ~$0.014/image, great for line art)
 *
 * Requires env var: OPENROUTER_API_KEY
 * Falls back gracefully if key not set or generation fails.
 */
async function generateImage(kural) {
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
    "https://openrouter.ai/api/v1/images/generations",
    {
      model: "black-forest-labs/flux-2-klein",
      prompt,
      n: 1,
      size: "512x512",
    },
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

  const url = response.data?.data?.[0]?.url || null;
  if (url) imageCache.set(cacheKey, url);
  return url;
}

// ─────────────────────────────────────────────
// Route: GET /data
// TRMNL polls this endpoint every refresh cycle
// ─────────────────────────────────────────────
app.get("/data", async (req, res) => {
  try {
    const num = dailyKuralNumber();
    const kural = await fetchKural(num);

    const lines = Array.isArray(kural.kural) ? kural.kural : [];
    const line1 = lines[0] || "";
    const line2 = lines[1] || "";
    const meaning_en = kural.meaning?.en || "";
    // Tamil meaning — prefer mu_va (concise), fall back to salamon
    const meaning_ta = kural.meaning?.ta_mu_va || kural.meaning?.ta_salamon || "";
    const chapter = kural.chapter || "";
    const section = kural.section || "";
    const number = kural.number || num;

    // Generate image only if API key is present
    let image_url = null;
    if (process.env.OPENROUTER_API_KEY) {
      try {
        image_url = await generateImage(kural);
      } catch (imgErr) {
        console.error("Image generation failed:", imgErr.message);
        // Non-fatal: plugin still renders text without image
      }
    }

    res.json({
      number,
      line1,
      line2,
      meaning_en,
      meaning_ta,
      chapter,
      section,
      image_url,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error in /data:", err.message);
    res.status(500).json({ error: "Failed to fetch Thirukural", detail: err.message });
  }
});

// Health check
app.get("/", (req, res) =>
  res.json({ status: "ok", plugin: "Thirukural TRMNL", today: dailyKuralNumber() })
);

app.listen(PORT, () => {
  console.log(`Thirukural TRMNL server running on port ${PORT}`);
});
