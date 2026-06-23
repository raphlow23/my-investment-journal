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

const fetchText = async (url, encoding = "utf-8") => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });
  const buffer = await response.arrayBuffer();
  if (!response.ok) throw new Error(`Search failed: ${response.status}`);
  return new TextDecoder(encoding).decode(buffer);
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

const parseJsonish = (text) => {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/^[^(]*\(([\s\S]*)\)\s*;?$/);
    if (!match) throw new Error("Autocomplete response parse failed");
    return JSON.parse(match[1]);
  }
};

const looksLikeName = (value, code) =>
  value &&
  value !== code &&
  !/^\d+$/.test(value) &&
  !/^https?:/i.test(value) &&
  !/^[A-Z]{2,8}$/.test(value) &&
  /[^\d\s.,:;|/\\()[\]{}_-]/.test(value);

const collectNaverRows = (value, rows = []) => {
  if (Array.isArray(value)) {
    const strings = value.map((item) => cleanText(item)).filter(Boolean);
    const code = strings.find((item) => /^\d{6}$/.test(item));
    const name = strings.find((item) => looksLikeName(item, code));
    if (code && name) rows.push({ code, name, raw: strings.join(" ") });

    value.forEach((item) => collectNaverRows(item, rows));
    return rows;
  }

  if (value && typeof value === "object") {
    const strings = Object.values(value).map((item) => cleanText(item)).filter(Boolean);
    const code =
      strings.find((item) => /^\d{6}$/.test(item)) ||
      cleanText(value.code || value.itemCode || value.symbol || value.ticker);
    const name =
      cleanText(value.name || value.itemName || value.nm || value.korName || value.stockName) ||
      strings.find((item) => looksLikeName(item, code));
    if (/^\d{6}$/.test(code) && name) rows.push({ code, name, raw: strings.join(" ") });

    Object.values(value).forEach((item) => collectNaverRows(item, rows));
  }

  return rows;
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
  const url = new URL("https://ac.finance.naver.com/ac");
  url.searchParams.set("q", query);
  url.searchParams.set("q_enc", "UTF-8");
  url.searchParams.set("st", "111");
  url.searchParams.set("r_lt", "111");

  const text = await fetchText(url);
  const data = parseJsonish(text);
  return uniqueBy(collectNaverRows(data), (item) => item.code).slice(0, 10).map(naverItem);
};

const searchNaverFinanceHtml = async (query) => {
  const url = new URL("https://finance.naver.com/search/searchList.naver");
  url.searchParams.set("query", query);
  const html = await fetchText(url, "euc-kr");
  const matches = [...html.matchAll(/item\/main\.naver\?code=(\d{6})["'][^>]*>([\s\S]*?)<\/a>/g)];

  return uniqueBy(matches, (match) => match[1]).slice(0, 10).map((match) => {
    const code = match[1];
    const name = cleanText(match[2]);
    return naverItem({ code, name, raw: name });
  });
};

const searchNaverFinance = async (query) => {
  const autocompleteItems = await searchNaverAutocomplete(query).catch(() => []);
  if (autocompleteItems.length) return autocompleteItems;
  return searchNaverFinanceHtml(query).catch(() => []);
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
  return (Array.isArray(data.quotes) ? data.quotes : [])
    .filter((item) => item.symbol && usExchanges.has(item.exchange))
    .slice(0, 10)
    .map((item) => {
      const isEtf = String(item.quoteType || "").toUpperCase() === "ETF";
      return {
        name: item.shortname || item.longname || item.symbol,
        ticker: item.symbol,
        providerSymbol: item.symbol,
        market: isEtf ? "ETF_US" : "US",
        currency: item.currency || "USD",
        country: "US",
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

  const results = await Promise.allSettled([searchNaverFinance(query), searchYahooFinance(query)]);
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  json(res, 200, { items: uniqueBy(items, (item) => `${item.market}:${item.ticker}`).slice(0, 12) });
}
