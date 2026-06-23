const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const buckets = new Map();

let kisToken = null;
let kisTokenExpiresAt = 0;
let usdKrwRate = null;
let usdKrwRateExpiresAt = 0;

const KIS_BASE_URL = process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443";
const US_EXCHANGE_CODES = ["NAS", "NYS", "AMS"];

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
  if (!response.ok) throw new Error(`조회 실패: ${response.status}`);
  return new TextDecoder(encoding).decode(buffer);
};

const cleanText = (value) =>
  String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const numberFrom = (...values) => {
  for (const value of values) {
    const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const getUsdKrwRate = async () => {
  if (usdKrwRate && Date.now() < usdKrwRateExpiresAt) return usdKrwRate;

  const response = await fetch("https://open.er-api.com/v6/latest/USD");
  const data = await response.json();
  const rate = numberFrom(data?.rates?.KRW);
  if (!response.ok || !rate) throw new Error("USD/KRW 환율 조회 실패");

  usdKrwRate = rate;
  usdKrwRateExpiresAt = Date.now() + 30 * 60_000;
  return rate;
};

const hasKisCredentials = () => Boolean(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);

const getKisToken = async () => {
  if (!hasKisCredentials()) throw new Error("KIS_APP_KEY 또는 KIS_APP_SECRET이 설정되지 않았습니다.");
  if (kisToken && Date.now() < kisTokenExpiresAt - 60_000) return kisToken;

  const response = await fetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.msg1 || data.error_description || "한국투자증권 토큰 발급 실패");

  kisToken = data.access_token;
  kisTokenExpiresAt = Date.now() + Number(data.expires_in || 86400) * 1000;
  return kisToken;
};

const kisHeaders = async (trId) => ({
  "Content-Type": "application/json; charset=utf-8",
  authorization: `Bearer ${await getKisToken()}`,
  appkey: process.env.KIS_APP_KEY,
  appsecret: process.env.KIS_APP_SECRET,
  tr_id: trId,
  custtype: "P"
});

const kisFetch = async (path, trId, params) => {
  const url = new URL(`${KIS_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: await kisHeaders(trId) });
  const data = await response.json();
  if (!response.ok || data.rt_cd === "1") throw new Error(data.msg1 || `한국투자증권 조회 실패: ${response.status}`);
  return data.output || data;
};

const quoteKisDomestic = async (symbol) => {
  const code = String(symbol || "").match(/\d{6}/)?.[0];
  if (!code) throw new Error("국내 주식은 6자리 종목코드가 필요합니다.");
  const output = await kisFetch("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: code
  });
  const price = numberFrom(output.stck_prpr, output.prpr, output.last);
  if (!price) throw new Error("한국투자증권 국내 현재가를 받지 못했습니다.");
  return { code, price, provider: "kis" };
};

const quoteKisUs = async (symbol) => {
  const ticker = String(symbol || "").trim().toUpperCase();
  if (!ticker) throw new Error("미국 주식 티커가 필요합니다.");

  const failures = [];
  for (const exchange of US_EXCHANGE_CODES) {
    try {
      const output = await kisFetch("/uapi/overseas-price/v1/quotations/price", "HHDFS00000300", {
        AUTH: "",
        EXCD: exchange,
        SYMB: ticker
      });
      const price = numberFrom(output.last, output.base, output.ovrs_nmix_prpr, output.stck_prpr, output.price);
      if (price) return { code: ticker, price, fxRate: await getUsdKrwRate(), provider: `kis-${exchange}` };
      failures.push(`${exchange}: 가격 없음`);
    } catch (error) {
      failures.push(`${exchange}: ${error instanceof Error ? error.message : "조회 실패"}`);
    }
  }
  throw new Error(`한국투자증권 미국 현재가 조회 실패 (${failures.join(" / ")})`);
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

  const price = numberFrom(data.close, data.price, data.previous_close);
  if (!price) throw new Error("Twelve Data에서 유효한 가격을 받지 못했습니다.");
  return price;
};

const resolveNaverCode = async (query) => {
  const raw = String(query || "").trim();
  const directCode = raw.match(/\b\d{6}\b/);
  if (directCode) return directCode[0];

  const searchUrl = new URL("https://finance.naver.com/search/searchList.naver");
  searchUrl.searchParams.set("query", raw);
  const html = await fetchText(searchUrl, "euc-kr");
  const links = [...html.matchAll(/item\/main\.naver\?code=(\d{6})["'][^>]*>([\s\S]*?)<\/a>/g)];
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

  const html = await fetchText(url, "euc-kr");
  const noToday = html.match(/<p class="no_today">([\s\S]*?)<\/p>/);
  const price = numberFrom(noToday ? cleanText(noToday[1]) : "");
  if (!price) throw new Error("네이버 금융에서 유효한 현재가를 받지 못했습니다.");
  return { code, price, provider: "naver" };
};

const quoteWithFallback = async (market, symbol) => {
  const errors = [];
  const isKorean = market === "KR" || market === "ETF_KR";

  if (hasKisCredentials()) {
    try {
      return isKorean ? await quoteKisDomestic(symbol) : await quoteKisUs(symbol);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "한국투자증권 조회 실패");
    }
  }

  try {
    if (isKorean) return await quoteNaverFinance(symbol);
    return { code: symbol, price: await quoteTwelveData(symbol), fxRate: await getUsdKrwRate(), provider: "twelve_data" };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "대체 가격 조회 실패");
  }

  throw new Error(errors.join(" / ") || "가격 조회 실패");
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
      const symbol = String(item.providerSymbol || item.ticker || item.name || "").trim().toUpperCase();

      if (!symbol || !["KR", "ETF_KR", "US", "ETF_US"].includes(market)) {
        errors.push({ instrumentId: item.instrumentId, ticker: item.ticker, message: "자동 가격 조회를 지원하지 않는 시장입니다." });
        continue;
      }

      try {
        const result = await quoteWithFallback(market, symbol);
        quotes.push({
          instrumentId: item.instrumentId,
          ticker: result.code || item.ticker,
          market,
          price: result.price,
          currency: market === "KR" || market === "ETF_KR" ? "KRW" : item.currency || "USD",
          fxRate: result.fxRate || 1,
          source: "api",
          provider: result.provider,
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
