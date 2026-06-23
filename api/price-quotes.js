const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
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

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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

const quoteTwelveData = async (symbol) => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) throw new Error("TWELVE_DATA_API_KEY가 설정되지 않았습니다.");

  const url = new URL("https://api.twelvedata.com/quote");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", key);

  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.status === "error") throw new Error(data.message || "Twelve Data 조회 실패");

  return Number(data.close ?? data.price ?? data.previous_close);
};

const resolveNaverCode = async (query) => {
  const raw = String(query || "").trim();
  const directCode = raw.match(/\b\d{6}\b/);
  if (directCode) return directCode[0];

  const searchUrl = new URL("https://finance.naver.com/search/searchList.naver");
  searchUrl.searchParams.set("query", raw);

  const html = await fetchText(searchUrl);
  const links = [...html.matchAll(/href=["']\/item\/main\.naver\?code=(\d{6})["'][^>]*>([\s\S]*?)<\/a>/g)];
  const normalized = raw.toLowerCase().replace(/\s+/g, "");
  const exact = links.find((match) => cleanText(match[2]).toLowerCase().replace(/\s+/g, "") === normalized);
  const selected = exact || links[0];

  if (!selected) throw new Error("네이버 금융에서 종목 코드를 찾지 못했습니다. 6자리 종목코드로 등록해 주세요.");
  return selected[1];
};

const quoteNaverFinance = async (query) => {
  const code = await resolveNaverCode(query);
  const url = new URL("https://finance.naver.com/item/main.naver");
  url.searchParams.set("code", code);

  const html = await fetchText(url);
  const noToday = html.match(/<p class="no_today">([\s\S]*?)<\/p>/);
  const priceText = noToday ? cleanText(noToday[1]) : "";
  const price = Number(priceText.replace(/[^\d.]/g, ""));

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("네이버 금융에서 유효한 현재가를 받지 못했습니다.");
  }

  return { code, price };
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "POST만 지원합니다." });
    return;
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
  if (limited(ip)) {
    json(res, 429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." });
    return;
  }

  try {
    const body = await readBody(req);
    const symbols = Array.isArray(body.symbols) ? body.symbols.slice(0, 30) : [];
    const quotes = [];
    const errors = [];

    for (const item of symbols) {
      const market = item.market;
      const symbol = String(item.providerSymbol || item.ticker || item.name || "").trim().toUpperCase();

      if (!symbol || !["KR", "ETF_KR", "US", "ETF_US"].includes(market)) {
        errors.push({ instrumentId: item.instrumentId, ticker: item.ticker, message: "자동 가격 조회를 지원하지 않는 시장입니다." });
        continue;
      }

      try {
        const result = market === "KR" || market === "ETF_KR"
          ? await quoteNaverFinance(symbol)
          : { code: symbol, price: await quoteTwelveData(symbol) };

        if (!Number.isFinite(result.price) || result.price <= 0) throw new Error("유효한 가격을 받지 못했습니다.");

        quotes.push({
          instrumentId: item.instrumentId,
          ticker: result.code || item.ticker,
          market,
          price: result.price,
          currency: market === "KR" || market === "ETF_KR" ? "KRW" : item.currency || "USD",
          fxRate: 1,
          source: "api",
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        errors.push({
          instrumentId: item.instrumentId,
          ticker: item.ticker,
          message: error instanceof Error ? error.message : "가격 조회 실패"
        });
      }
    }

    json(res, 200, { quotes, errors });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "가격 프록시 오류" });
  }
}
