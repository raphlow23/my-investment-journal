const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
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

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "POST만 지원합니다." }) };
  }

  const ip = event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "local";
  if (limited(ip)) {
    return { statusCode: 429, body: JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const symbols = Array.isArray(body.symbols) ? body.symbols.slice(0, 30) : [];

    const quotes = [];
    const errors = [];
    for (const item of symbols) {
      const market = item.market;
      const symbol = String(item.providerSymbol || item.ticker || "").trim().toUpperCase();
      if (!symbol || !["US", "ETF_US"].includes(market)) {
        errors.push({ instrumentId: item.instrumentId, ticker: item.ticker, message: "MVP 자동 업데이트는 미국 주식/ETF만 지원합니다." });
        continue;
      }

      try {
        const price = await quoteTwelveData(symbol);
        if (!Number.isFinite(price) || price <= 0) throw new Error("유효한 가격을 받지 못했습니다.");
        quotes.push({
          instrumentId: item.instrumentId,
          ticker: item.ticker,
          market,
          price,
          currency: item.currency || "USD",
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

    return { statusCode: 200, body: JSON.stringify({ quotes, errors }) };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error instanceof Error ? error.message : "가격 프록시 오류" })
    };
  }
};
