const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5500;
const BASE_URL = "https://www.animefillerlist.com";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Shared axios instance with browser-like headers ──────────────────────────
const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif," +
      "image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
    Referer: "https://www.animefillerlist.com/",
  },
});

// ── Slug helpers ──────────────────────────────────────────────────────────────

function basicSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Generate multiple slug candidates from a title.
 * animefillerlist.com uses slugs like:
 *   "Naruto"                           → naruto
 *   "Naruto: Shippuden"                → naruto-shippuden
 *   "Fullmetal Alchemist: Brotherhood" → fullmetal-alchemist-brotherhood
 *   "Dragon Ball Z"                    → dragon-ball-z
 *   "JoJo's Bizarre Adventure"         → jojos-bizarre-adventure
 *   "Hunter x Hunter (2011)"           → hunter-x-hunter-2011
 */
function slugCandidates(name) {
  const raw = String(name || "").trim();
  const candidates = new Set();

  // 1. Direct basic slug
  candidates.add(basicSlug(raw));

  // 2. Strip subtitle after colon → "Naruto" from "Naruto: Shippuden"
  const noSubtitle = raw.replace(/[:\-–—].*$/, "").trim();
  if (noSubtitle !== raw) candidates.add(basicSlug(noSubtitle));

  // 3. Join subtitle removing colon/comma → "naruto-shippuden"
  const colonJoined = raw.replace(/[:\-–—,]+\s*/g, " ").trim();
  candidates.add(basicSlug(colonJoined));

  // 4. Drop year like "(2011)" or "[2011]"
  const noYear = raw.replace(/[\[(]\d{4}[\])]/g, "").trim();
  candidates.add(basicSlug(noYear));
  candidates.add(basicSlug(noYear.replace(/[:\-–—,]+\s*/g, " ").trim()));

  // 5. Strip apostrophes ("JoJo's" → "jojos")
  const noApos = raw.replace(/[''`]/g, "");
  candidates.add(basicSlug(noApos));
  candidates.add(basicSlug(noApos.replace(/[:\-–—,]+\s*/g, " ").trim()));

  // 6. Strip "the " prefix
  const noThe = raw.replace(/^the\s+/i, "");
  if (noThe !== raw) {
    candidates.add(basicSlug(noThe));
    candidates.add(basicSlug(noThe.replace(/[:\-–—,]+\s*/g, " ").trim()));
  }

  // 7. Roman → Arabic numerals for common suffixes
  const romanMap = {
    " IV": " 4", " III": " 3", " II": " 2", " I": " 1",
    "-IV": "-4", "-III": "-3", "-II": "-2",
  };
  let romanConverted = raw;
  for (const [r, a] of Object.entries(romanMap)) {
    romanConverted = romanConverted.replace(
      new RegExp(r.replace("-", "\\-") + "(?=[^a-z]|$)", "i"),
      a
    );
  }
  if (romanConverted !== raw) {
    candidates.add(basicSlug(romanConverted));
    candidates.add(basicSlug(romanConverted.replace(/[:\-–—,]+\s*/g, " ").trim()));
  }

  // 8. "&" ↔ "and"
  if (raw.includes(" & ")) {
    candidates.add(basicSlug(raw.replace(/ & /g, " and ")));
  }
  if (/\band\b/i.test(raw)) {
    candidates.add(basicSlug(raw.replace(/\band\b/gi, "&")));
  }

  // 9. Remove common parenthetical suffixes entirely
  const noParens = raw.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (noParens !== raw) {
    candidates.add(basicSlug(noParens));
    candidates.add(basicSlug(noParens.replace(/[:\-–—,]+\s*/g, " ").trim()));
  }

  // 10. Drop stop words ("on", "of", "the", "in", "a")
  const stopWords = /\b(on|of|the|in|a|an)\b/gi;
  const noStopWords = raw.replace(stopWords, " ").replace(/\s+/g, " ").trim();
  if (noStopWords !== raw) {
    candidates.add(basicSlug(noStopWords));
  }

  // 11. Ultra strict (strip everything except letters/numbers)
  candidates.add(raw.toLowerCase().replace(/[^a-z0-9]/g, ""));


  return [...candidates].filter(Boolean);
}

// ── Show-list fuzzy search ────────────────────────────────────────────────────

let showListCache = null;
let showListFetchedAt = 0;

async function getShowList() {
  const TTL = 30 * 60 * 1000; // cache 30 min
  if (showListCache && Date.now() - showListFetchedAt < TTL) return showListCache;

  const res = await http.get(`${BASE_URL}/shows`);
  const $ = cheerio.load(res.data);
  const shows = [];

  $("a[href^='/shows/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const slug = href.replace("/shows/", "").replace(/\/$/, "").trim();
    const label = $(el).text().trim();
    if (slug && label && slug !== "shows") shows.push({ slug, label });
  });

  showListCache = shows;
  showListFetchedAt = Date.now();
  return shows;
}

function matchScore(a, b) {
  a = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  b = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const bigrams = (s) => {
    const bg = new Set();
    for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
    return bg;
  };
  const bg1 = bigrams(a);
  const bg2 = bigrams(b);
  let shared = 0;
  for (const g of bg1) if (bg2.has(g)) shared++;
  return (2 * shared) / (bg1.size + bg2.size + 1);
}

async function findSlugFromShowList(title) {
  try {
    const shows = await getShowList();
    if (!shows.length) return null;

    let best = null;
    let bestScore = 0;

    for (const show of shows) {
      const score = matchScore(title, show.label);
      if (score > bestScore) {
        bestScore = score;
        best = show;
      }
    }

    if (bestScore >= 0.70 && best) return best.slug;
  } catch (_) { /* silent */ }
  return null;
}

// ── Episode text parser ───────────────────────────────────────────────────────

function parseEpisodeText(text) {
  if (!text) return [];
  return text
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const dashMatch = part.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
      if (dashMatch) {
        const start = Number(dashMatch[1]);
        const end = Number(dashMatch[2]);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          return Array.from({ length: end - start + 1 }, (_, i) => start + i);
        }
        return [];
      }
      const n = Number(part);
      return Number.isFinite(n) && n > 0 ? [n] : [];
    });
}

// ── Core HTML scraper ─────────────────────────────────────────────────────────

async function scrapeBySlug(slug) {
  const url = `${BASE_URL}/shows/${slug}`;
  const response = await http.get(url);
  const $ = cheerio.load(response.data);

  // Detect 404 / not-found page
  if (
    response.status === 404 ||
    $("body").text().toLowerCase().includes("page not found")
  ) {
    throw Object.assign(new Error("Not found"), { notFound: true });
  }

  const title = $("h1").first().text().trim() || slug;

  // ── Helper: try multiple CSS selectors, return first non-empty text ──
  const trySelectors = (selectors) => {
    for (const sel of selectors) {
      try {
        const text = $(sel).first().text().trim();
        if (text) return text;
      } catch (_) { /* bad selector */ }
    }
    return "";
  };

  // ── Strategy 1: direct class selectors ──
  let mangaCanonRaw = trySelectors([
    ".manga_canon .Episodes",
    ".manga_canon td.Episodes",
    '[class*="manga_canon"] .Episodes',
    '[class*="manga_canon"] td',
  ]);

  // Use attribute wildcard selector instead of escaped "/"
  let mixedRaw = trySelectors([
    '[class*="mixed_canon"] .Episodes',
    '[class*="mixed_canon"] td.Episodes',
    '[class*="mixed"] .Episodes',
    '[class*="mixed"] td',
  ]);

  let fillerRaw = trySelectors([
    ".filler .Episodes",
    ".filler td.Episodes",
    '[class="filler"] .Episodes',
    '[class="filler"] td',
  ]);

  let animeCanonRaw = trySelectors([
    ".anime_canon .Episodes",
    ".anime_canon td.Episodes",
    '[class*="anime_canon"] .Episodes',
    '[class*="anime_canon"] td',
  ]);

  // ── Strategy 2: walk every element with a type-like class ──
  if (!mangaCanonRaw && !mixedRaw && !fillerRaw && !animeCanonRaw) {
    $("*").each((_, el) => {
      const cls = ($(el).attr("class") || "").toLowerCase();
      if (!cls) return;
      const epText =
        $(el).find(".Episodes, td.Episodes").first().text().trim() ||
        $(el).find("td").last().text().trim();
      if (!epText) return;

      if ((cls.includes("manga_canon") || cls.includes("manga-canon")) && !mangaCanonRaw)
        mangaCanonRaw = epText;
      if ((cls.includes("mixed_canon") || cls.includes("mixed-canon") || cls === "mixed") && !mixedRaw)
        mixedRaw = epText;
      if (
        (cls === "filler" || (cls.includes("filler") && !cls.includes("mixed") && !cls.includes("canon"))) &&
        !fillerRaw
      )
        fillerRaw = epText;
      if ((cls.includes("anime_canon") || cls.includes("anime-canon")) && !animeCanonRaw)
        animeCanonRaw = epText;
    });
  }

  // ── Strategy 3: scrape the full episode list table row by row ──
  //   The site renders a table where each row has a type badge and episode number.
  //   We collect per-episode types and group them.
  if (!mangaCanonRaw && !mixedRaw && !fillerRaw && !animeCanonRaw) {
    const canonNums = [];
    const mixedNums = [];
    const fillerNums = [];
    const animeNums = [];

    // Try episode list structure (one row per episode with type badge)
    $("tr, li").each((_, el) => {
      const rowText = $(el).text().toLowerCase();
      const epNumMatch = $(el).text().match(/\b(\d+)\b/);
      if (!epNumMatch) return;
      const epNum = Number(epNumMatch[1]);
      if (!Number.isFinite(epNum) || epNum <= 0) return;

      const cls = ($(el).attr("class") || "").toLowerCase();
      const typeCells = $(el).find('[class*="type"], [class*="badge"], td').map((_, c) =>
        $(c).text().toLowerCase().trim()
      ).get();
      const typeStr = cls + " " + typeCells.join(" ");

      if (typeStr.includes("manga canon") || typeStr.includes("manga_canon")) {
        canonNums.push(epNum);
      } else if (typeStr.includes("mixed")) {
        mixedNums.push(epNum);
      } else if (typeStr.includes("anime canon") || typeStr.includes("anime_canon")) {
        animeNums.push(epNum);
      } else if (typeStr.includes("filler")) {
        fillerNums.push(epNum);
      }
    });

    if (canonNums.length) mangaCanonRaw = canonNums.join(",");
    if (mixedNums.length) mixedRaw = mixedNums.join(",");
    if (fillerNums.length) fillerRaw = fillerNums.join(",");
    if (animeNums.length) animeCanonRaw = animeNums.join(",");
  }

  const mangaCanonEpisodes = parseEpisodeText(mangaCanonRaw);
  const animeCanonEpisodes = parseEpisodeText(animeCanonRaw);
  const mixedCanonFillerEpisodes = parseEpisodeText(mixedRaw);
  const fillerEpisodes = parseEpisodeText(fillerRaw);

  // Merge manga + anime canon
  const allCanon = [...new Set([...mangaCanonEpisodes, ...animeCanonEpisodes])];

  const totalEpisodes = new Set([
    ...allCanon,
    ...mixedCanonFillerEpisodes,
    ...fillerEpisodes,
  ]).size;

  if (!allCanon.length && !mixedCanonFillerEpisodes.length && !fillerEpisodes.length) {
    throw new Error("No episode data found on source page");
  }

  return {
    title,
    source: url,
    manga_canon_episodes: allCanon,
    mixed_canon_filler_episodes: mixedCanonFillerEpisodes,
    filler_episodes: fillerEpisodes,
    total_episodes: totalEpisodes,
  };
}

// ── Main entry: try all slug candidates + show list fallback ──────────────────

async function scrapeFillerData(inputName) {
  const candidates = slugCandidates(inputName);
  const tried = new Set();
  let lastError = null;

  for (const slug of candidates) {
    if (tried.has(slug)) continue;
    tried.add(slug);
    try {
      return await scrapeBySlug(slug);
    } catch (err) {
      lastError = err;
      // Hard abort on non-404 network errors
      if (err.response && ![404, 403].includes(err.response.status)) throw err;
    }
    await new Promise((r) => setTimeout(r, 250)); // polite delay
  }

  // Fuzzy search the show listing
  try {
    const foundSlug = await findSlugFromShowList(inputName);
    if (foundSlug && !tried.has(foundSlug)) {
      tried.add(foundSlug);
      return await scrapeBySlug(foundSlug);
    }
  } catch (err) {
    lastError = err;
  }

  throw lastError || new Error(`"${inputName}" not found on Anime Filler List`);
}

// ── Express routes ────────────────────────────────────────────────────────────

app.get("/api/filler/:name", async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name).trim();
    if (!name) return res.status(400).json({ error: "Anime name is required" });

    const data = await scrapeFillerData(name);
    return res.json(data);
  } catch (error) {
    const isNotFound =
      error?.notFound ||
      error?.response?.status === 404 ||
      (error?.message || "").toLowerCase().includes("not found");

    return res.status(isNotFound ? 404 : 500).json({
      error: isNotFound
        ? "Show not found in database"
        : "Failed to fetch filler data",
      details: isNotFound 
        ? "Series like Mushoku Tensei often have 0% filler and may not be in the database. It is likely all canon!"
        : error.message,
    });
  }
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅  Onimatch → http://localhost:${PORT}   (filler: /api/filler/:name)`);
});
