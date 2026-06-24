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

const isEtfName = (name) =>
  /\bETF\b|KODEX|TIGER|KIWOOM|ACE|RISE|SOL|PLUS|HANARO|KOSEF|ARIRANG/i.test(name);

const toSuggestion = (item) => {
  const nationCode = String(item?.nationCode || "").toUpperCase();
  const isKorean = nationCode === "KOR";
  const name = cleanText(item?.name);
  const ticker = String(item?.code || "").trim().toUpperCase();
  const providerSymbol = String(item?.reutersCode || item?.code || "").trim().toUpperCase();
  const isEtf = isEtfName(name) || /ETF/i.test(`${item?.typeName || ""} ${item?.category || ""}`);

  if (!name || !ticker || !providerSymbol || !["KOR", "USA"].includes(nationCode)) return null;
  return {
    name,
    ticker,
    providerSymbol,
    market: isKorean ? (isEtf ? "ETF_KR" : "KR") : (isEtf ? "ETF_US" : "US"),
    currency: isKorean ? "KRW" : "USD",
    country: isKorean ? "KR" : "US",
    assetClass: isEtf ? "etf" : "stock",
    source: "naver"
  };
};

const searchNaver = async (query) => {
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
  if (!response.ok || !data?.isSuccess) throw new Error("네이버증권 종목 검색에 실패했습니다.");
  return (Array.isArray(data?.result?.items) ? data.result.items : [])
    .map(toSuggestion)
    .filter(Boolean)
    .filter((item, index, items) =>
      items.findIndex((candidate) => candidate.market === item.market && candidate.providerSymbol === item.providerSymbol) === index
    )
    .slice(0, 12);
};

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "local";
  if (limited(ip)) return json(res, 429, { error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." });
  const query = String(req.query?.q || "").trim();
  if (query.length < 2) return json(res, 200, { items: [] });

  try {
    json(res, 200, { items: await searchNaver(query) });
  } catch (error) {
    json(res, 502, { error: error instanceof Error ? error.message : "네이버증권 종목 검색 실패" });
  }
}
