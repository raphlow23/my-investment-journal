const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const buckets = new Map();

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

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`조회 실패: ${response.status}`);
  return text;
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

const searchNaverFinance = async (query) => {
  const url = new URL("https://finance.naver.com/search/searchList.naver");
  url.searchParams.set("query", query);
  const html = await fetchText(url);
  const matches = [...html.matchAll(/href=["']\/item\/main\.naver\?code=(\d{6})["'][^>]*>([\s\S]*?)<\/a>/g)];

  return uniqueBy(matches, (match) => match[1]).slice(0, 10).map((match) => {
    const code = match[1];
    const name = cleanText(match[2]);
    return {
      name,
      ticker: code,
      providerSymbol: code,
      market: "KR",
      currency: "KRW",
      country: "KR",
      assetClass: "stock",
      source: "naver"
    };
  });
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
  if (!response.ok) throw new Error("Yahoo Finance 검색 실패");

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

export const handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "GET만 지원합니다." }) };
  }

  const ip = event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "local";
  if (limited(ip)) {
    return { statusCode: 429, body: JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }) };
  }

  const query = String(event.queryStringParameters?.q || "").trim();
  if (query.length < 2) {
    return { statusCode: 200, body: JSON.stringify({ items: [] }) };
  }

  const results = await Promise.allSettled([searchNaverFinance(query), searchYahooFinance(query)]);
  const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  return {
    statusCode: 200,
    body: JSON.stringify({ items: uniqueBy(items, (item) => `${item.market}:${item.ticker}`).slice(0, 12) })
  };
};
