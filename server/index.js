import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const PINCODE = process.env.PINCODE || "401105";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SCAN_INTERVAL_MS =
  Number(process.env.SCAN_INTERVAL_SECONDS || 120) * 1000; // default: 2 min
const STATE_FILE = "./stock-state.json";
const MAX_PAGES = 50;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.firstcry.com/search?q=hotwheels",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let latestData = {
  products: [],
  inStock: [],
  lastScanned: null,
  scanning: false,
};

// ---------- Persistent stock state (survives restarts) ----------
// PId (string) -> last known stock. Entries are never dropped on a partial scan.
let stockMap = new Map();
let isFirstRun = true;

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    stockMap = new Map(Object.entries(raw));
    isFirstRun = stockMap.size === 0;
    console.log(`📂 Loaded ${stockMap.size} products from ${STATE_FILE}`);
  } catch {
    console.log("📂 No saved state, first scan will only build the baseline.");
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(stockMap)));
  } catch (e) {
    console.error("Could not save state:", e.message);
  }
}

// ---------- Helpers ----------
function getFirstImageUrl(imgString) {
  if (!imgString) return null;
  const firstFile = imgString.split(";")[0].trim();
  if (!firstFile) return null;
  return `https://cdn.fcglcdn.com/brainbees/images/products/400x400/${firstFile}`;
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const getLink = (p) =>
  `https://www.firstcry.com/hot-wheels/${slugify(p.PNm)}/${p.PId}/product-detail`;

// Escape text for Telegram HTML parse mode (product names can contain _ * [ etc.
// which break Markdown and make Telegram reject the whole message)
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- Telegram ----------
async function tg(method, payload) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // fetch() does NOT throw on 4xx/5xx, so we must check it ourselves
    const err = new Error(body.description || `HTTP ${res.status}`);
    err.retryAfter = body.parameters?.retry_after;
    throw err;
  }
}

async function sendTelegramAlert(text, photoUrl) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("Telegram not configured (missing token or chat id)");
    return;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (photoUrl) {
        try {
          await tg("sendPhoto", {
            chat_id: CHAT_ID,
            photo: photoUrl,
            caption: text,
            parse_mode: "HTML",
          });
          return;
        } catch (e) {
          if (e.retryAfter) throw e;
          console.warn("Photo send failed, falling back to text:", e.message);
        }
      }
      await tg("sendMessage", {
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
      });
      return;
    } catch (e) {
      if (e.retryAfter) {
        await sleep((e.retryAfter + 1) * 1000); // Telegram rate limit
        continue;
      }
      console.error("Telegram notification failed:", e.message);
      return;
    }
  }
}

// ---------- Scraping ----------
async function fetchPage(page) {
  const url = `https://www.firstcry.com/svcs/SearchResult.svc/GetSearchResultProductsPaging?PageNo=${page}&PageSize=20&SortExpression=NewArrivals&OnSale=5&SearchString=brand&MasterBrand=113&pcode=${PINCODE}&isclub=0`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(await res.text());
      return JSON.parse(json.ProductResponse).Products || [];
    } catch (e) {
      if (attempt === 3) throw new Error(`Page ${page} failed: ${e.message}`);
      await sleep(2000 * attempt);
    }
  }
}

async function runScan() {
  if (latestData.scanning) return;
  latestData.scanning = true;
  console.log("🔍 Scanning FirstCry for Hot Wheels...");

  try {
    const all = new Map();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const products = await fetchPage(page); // throws => scan aborted, state untouched
      if (!products.length) break;
      for (const p of products) {
        if (!all.has(p.PId)) {
          all.set(p.PId, {
            ...p,
            imageUrl: getFirstImageUrl(p.Images || p.Img),
          });
        }
      }
      await sleep(1000);
    }

    const products = [...all.values()];
    if (products.length === 0) {
      throw new Error(
        "0 products returned (blocked?) - skipping to avoid false alerts",
      );
    }
    const inStock = products.filter((p) => Number(p.CrntStock) > 0);

    // ---- Detect new arrivals & restocks ----
    const events = [];
    const seenNow = new Set();

    for (const p of products) {
      const key = String(p.PId);
      const stock = Number(p.CrntStock) || 0;
      seenNow.add(key);

      if (!isFirstRun) {
        const prev = stockMap.get(key);
        if (prev === undefined && stock > 0) {
          events.push({ type: "🔥 NEW ARRIVAL", p });
        } else if (prev === 0 && stock > 0) {
          events.push({ type: "🔄 RESTOCK", p });
        }
      }
      stockMap.set(key, stock);
    }

    // Products that vanished from the listing are treated as sold out, so a
    // later reappearance counts as a restock. Guarded so a truncated scan
    // can't wipe the state and cause false alerts.
    if (products.length >= stockMap.size * 0.8) {
      for (const key of stockMap.keys()) {
        if (!seenNow.has(key)) stockMap.set(key, 0);
      }
    }

    isFirstRun = false;
    saveState();

    latestData = {
      products,
      inStock,
      lastScanned: new Date().toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
      }),
      scanning: false,
    };
    console.log(
      `✅ Scan complete. Total: ${products.length}, In stock: ${inStock.length}, New alerts: ${events.length}`,
    );

    // ---- Fire alerts (after state is saved, spaced out for Telegram limits) ----
    for (const ev of events) {
      const msg =
        `<b>${ev.type}!</b>\n\n` +
        `🚗 <b>${esc(ev.p.PNm)}</b>\n` +
        `💰 Price: <b>₹${esc(ev.p.discprice)}</b>\n` +
        `📦 Stock: <b>${esc(ev.p.CrntStock)} available</b>\n\n` +
        `<a href="${getLink(ev.p)}">🔗 Snatch on FirstCry</a>`;

      await sendTelegramAlert(msg, ev.p.imageUrl);
      console.log(`Alert sent for: ${ev.p.PNm}`);
      await sleep(1100);
    }
  } catch (e) {
    console.error("Scan error:", e.message);
    latestData.scanning = false;
  }
}

// ---------- Boot ----------
loadState();
runScan();
setInterval(runScan, SCAN_INTERVAL_MS);

app.get("/api/status", (req, res) => {
  res.json(latestData);
});

app.post("/api/scan", async (req, res) => {
  await runScan();
  res.json(latestData);
});

app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
  sendTelegramAlert("✅ <b>Hot Wheels Sniper started</b>");
});
