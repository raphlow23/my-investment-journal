const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const buckets = new Map();

let usdKrwRate = null;
let usdKrwRateExpiresAt = 0;

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

const numberFrom = (...values) => {
  for (const value of values) {
    const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const naverHeaders = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json",
  "Accept-Language": "ko-KR,ko;q=0.9",
  "Referer": "https://m.stock.naver.com/"
};

const searchNaver = async (query) => {
  const url = new URL("https://m.stock.naver.com/front-api/search/autoComplete");
  url.searchParams.set("query", query);
  url.searchParams.set("target", "stock");
  const response = await fetch(url, { headers: naverHeaders });
  const data = await response.json();
  if (!response.ok || !data?.isSuccess) throw new Error("네이버증권 종목 검색 실패");
  return Array.isArray(data?.result?.items) ? data.result.items : [];
};

const resolveDomesticCode = async (symbol) => {
  const raw = String(symbol || "").trim();
  if (/^[0-9A-Z]{6}$/i.test(raw)) return raw.toUpperCase();
  const items = await searchNaver(raw);
  const normalized = raw.toLowerCase().replace(/\s+/g, "");
  const selected =
    items.find((item) => item?.nationCode === "KOR" && String(item?.name || "").toLowerCase().replace(/\s+/g, "") === normalized) ||
    items.find((item) => item?.nationCode === "KOR");
  if (!selected?.code) throw new Error("네이버증권에서 국내 종목 코드를 찾지 못했습니다. 종목을 다시 선택해 주세요.");
  return String(selected.code).toUpperCase();
};

const resolveUsSymbol = async (symbol) => {
  const raw = String(symbol || "").trim().toUpperCase();
  if (/^[A-Z0-9.-]+\.[A-Z]+$/.test(raw)) {
    return { ticker: raw.split(".")[0], providerSymbol: raw };
  }
  const items = await searchNaver(raw);
  const selected =
    items.find((item) => item?.nationCode === "USA" && String(item?.code || "").toUpperCase() === raw) ||
    items.find((item) => item?.nationCode === "USA");
  if (!selected?.code || !selected?.reutersCode) {
    throw new Error("네이버증권에서 미국 종목 코드를 찾지 못했습니다. 종목을 다시 선택해 주세요.");
  }
  return {
    ticker: String(selected.code).toUpperCase(),
    providerSymbol: String(selected.reutersCode).toUpperCase()
  };
};

const getUsdKrwRate = async () => {
  if (usdKrwRate && Date.now() < usdKrwRateExpiresAt) return usdKrwRate;
  const response = await fetch("https://api.stock.naver.com/marketindex/exchange/FX_USDKRW", { headers: naverHeaders });
  const data = await response.json();
  const rate = numberFrom(data?.exchangeInfo?.closePrice);
  if (!response.ok || !rate) throw new Error("네이버증권에서 USD/KRW 환율을 받지 못했습니다.");
  usdKrwRate = rate;
  usdKrwRateExpiresAt = Date.now() + 30 * 60_000;
  return rate;
};

const quoteNaverDomestic = async (symbol) => {
  const code = await resolveDomesticCode(symbol);
  const response = await fetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`, { headers: naverHeaders });
  const data = await response.json();
  const price = numberFrom(data?.closePrice, data?.regularMarketPrice, data?.price);
  if (!response.ok || !price) throw new Error("네이버증권에서 국내 현재가를 받지 못했습니다.");
  return { ticker: code, providerSymbol: code, price, fxRate: 1 };
};

const quoteNaverUs = async (symbol) => {
  const resolved = await resolveUsSymbol(symbol);
  const response = await fetch(`https://api.stock.naver.com/stock/${encodeURIComponent(resolved.providerSymbol)}/basic`, { headers: naverHeaders });
  const data = await response.json();
  const price = numberFrom(data?.closePrice, data?.regularMarketPrice, data?.price);
  if (!response.ok || !price) throw new Error("네이버증권에서 미국 현재가를 받지 못했습니다.");
  return { ...resolved, price, fxRate: await getUsdKrwRate() };
};

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST만 지원합니다." });
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
  if (limited(ip)) return json(res, 429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." });

  try {
    const body = await readBody(req);
    const symbols = Array.isArray(body.symbols) ? body.symbols.slice(0, 30) : [];
    const quotes = [];
    const errors = [];

    for (const item of symbols) {
      const market = item.market;
      const symbol = String(item.providerSymbol || item.ticker || item.name || "").trim();
      try {
        if (!symbol || !["KR", "ETF_KR", "US", "ETF_US"].includes(market)) throw new Error("자동 가격 조회를 지원하지 않는 시장입니다.");
        const result = market === "KR" || market === "ETF_KR"
          ? await quoteNaverDomestic(symbol)
          : await quoteNaverUs(symbol);
        quotes.push({
          instrumentId: item.instrumentId,
          ticker: result.ticker,
          providerSymbol: result.providerSymbol,
          market,
          price: result.price,
          currency: market === "KR" || market === "ETF_KR" ? "KRW" : "USD",
          fxRate: result.fxRate,
          source: "api",
          provider: "naver",
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        errors.push({
          instrumentId: item.instrumentId,
          ticker: item.ticker,
          message: error instanceof Error ? error.message : "네이버증권 가격 조회 실패"
        });
      }
    }
    json(res, 200, { quotes, errors });
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "가격 프록시 오류" });
  }
}
