import type { AssetClass } from "../types";

export const inferAssetClassification = (name: string, ticker: string, assetClass: AssetClass) => {
  const text = `${name} ${ticker}`.toUpperCase();
  const rules: Array<{ words: string[]; sector: string; themes: string[] }> = [
    { words: ["삼성전자", "SK하이닉스", "반도체", "SEMICONDUCTOR", "NVDA", "AMD", "AVGO", "MICRON", "MU"], sector: "반도체", themes: ["AI", "반도체"] },
    { words: ["APPLE", "AAPL", "MICROSOFT", "MSFT", "SOFTWARE", "소프트웨어"], sector: "정보기술", themes: ["기술주"] },
    { words: ["LILLY", "LLY", "PHARMA", "BIO", "제약", "바이오"], sector: "헬스케어", themes: ["제약·바이오"] },
    { words: ["BANK", "FINANCIAL", "은행", "금융"], sector: "금융", themes: ["금융"] },
    { words: ["자동차", "MOTOR", "TESLA", "TSLA"], sector: "자동차", themes: ["모빌리티"] },
    { words: ["BATTERY", "2차전지", "이차전지"], sector: "소재", themes: ["2차전지"] },
    { words: ["S&P500", "S&P 500", "나스닥", "NASDAQ", "다우존스", "DOW JONES"], sector: "시장지수", themes: ["미국지수"] },
    { words: ["배당", "DIVIDEND"], sector: "배당전략", themes: ["배당"] },
    { words: ["채권", "BOND", "TREASURY"], sector: "채권", themes: ["채권"] }
  ];
  const matched = rules.find((rule) => rule.words.some((word) => text.includes(word)));
  if (matched) return { sector: matched.sector, themes: matched.themes };
  return assetClass === "etf"
    ? { sector: "ETF", themes: ["ETF"] }
    : { sector: "", themes: [] as string[] };
};
