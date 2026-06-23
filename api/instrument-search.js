const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const buckets = new Map();

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const limited = (key) => {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { count: 0, resetAt: now + WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket.count > MAX_REQUESTS;
};

const cleanText = (value) =>
  String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const uniqueBy = (items, keyFn) => {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const naverItem = ({ code, name, raw }) => {
  const isEtf = /\bETF\b/i.test(raw) || /ETF/i.test(name);
  return {
    name,
    ticker: code,
    providerSymbol: code,
    market: isEtf ? "ETF_KR" : "KR",
    currency: "KRW",
    country: "KR",
    assetClass: isEtf ? "etf" : "stock",
    source: "naver"
  };
};

const searchNaverAutocomplete = async (query) => {
  const url = new URL("https://m.stock.naver.com/front-api/search/autoComplete");
  url.searchParams.set("query", query);
  url.searchParams.set("target", "stock");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Referer": "https://m.stock.naver.com/search"
    }
  });
  const data = await response.json();
  if (!response.ok || !data?.isSuccess) throw new Error("Naver stock search failed");

  return (Array.isArray(data?.result?.items) ? data.result.items : [])
    .filter((item) => item?.nationCode === "KOR" && /^\d{6}$/.test(item?.code || ""))
    .slice(0, 10)
    .map((item) => naverItem({
      code: item.code,
      name: cleanText(item.name),
      raw: `${item.name || ""} ${item.typeCode || ""} ${item.typeName || ""}`
    }));
};

const searchYahooFinance = async (query) => {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", "10");
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("enableFuzzyQuery", "true");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json"
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Yahoo Finance search failed");

  const usExchanges = new Set(["NMS", "NYQ", "ASE", "PCX", "BTS", "NCM", "NGM"]);
  const koreanExchanges = new Set(["KSC", "KOQ"]);
  return (Array.isArray(data.quotes) ? data.quotes : [])
    .filter((item) => item.symbol && (usExchanges.has(item.exchange) || koreanExchanges.has(item.exchange) || /\.K[QS]$/i.test(item.symbol)))
    .slice(0, 10)
    .map((item) => {
      const isEtf = String(item.quoteType || "").toUpperCase() === "ETF";
      const isKorean = koreanExchanges.has(item.exchange) || /\.K[QS]$/i.test(item.symbol);
      const ticker = isKorean ? item.symbol.replace(/\.K[QS]$/i, "") : item.symbol;
      return {
        name: item.shortname || item.longname || item.symbol,
        ticker,
        providerSymbol: ticker,
        market: isKorean ? (isEtf ? "ETF_KR" : "KR") : (isEtf ? "ETF_US" : "US"),
        currency: isKorean ? "KRW" : item.currency || "USD",
        country: isKorean ? "KR" : "US",
        assetClass: isEtf ? "etf" : "stock",
        source: "yahoo"
      };
    });
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    json(res, 405, { error: "GET only" });
    return;
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
  if (limited(ip)) {
    json(res, 429, { error: "Too many requests. Try again shortly." });
    return;
  }

  const query = String(req.query?.q || "").trim();
  if (query.length < 2) {
    json(res, 200, { items: [] });
    return;
  }

  const results = await Promise.allSettled([searchNaverAutocomplete(query), searchYahooFinance(query)]);
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  json(res, 200, { items: uniqueBy(items, (item) => `${item.market}:${item.ticker}`).slice(0, 12) });
}
