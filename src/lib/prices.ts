import { AppState, Asset, PriceQuote } from "../types";
import { calculatePositions } from "./calculations";

export interface PriceRefreshResult {
  state: AppState;
  updatedCount: number;
  failedCount: number;
  message: string;
}

interface PriceRequestItem {
  instrumentId: string;
  ticker: string;
  market: Asset["market"];
  providerSymbol: string;
  currency: Asset["currency"];
}

interface PriceApiResponse {
  quotes?: PriceQuote[];
  errors?: Array<{ instrumentId: string; ticker: string; message: string }>;
}

const apiMarkets = new Set(["US", "ETF_US"]);

export const canUseApiPrice = (asset: Asset) =>
  apiMarkets.has(asset.market) && Boolean(asset.providerSymbol || asset.ticker || asset.name);

const categorizePriceFailure = (message: string) => {
  const normalized = message.toLowerCase();
  if (normalized.includes("429") || normalized.includes("rate") || normalized.includes("limit") || normalized.includes("quota")) {
    return "갱신 제한 초과";
  }
  if (normalized.includes("fx") || normalized.includes("exchange") || normalized.includes("환율")) {
    return "환율 실패";
  }
  if (normalized.includes("ticker") || normalized.includes("symbol") || normalized.includes("티커") || normalized.includes("심볼")) {
    return "티커 누락";
  }
  return "API 실패";
};

const buildNoTargetMessage = (state: AppState) => {
  const activeAssetIds = new Set(
    calculatePositions(state)
      .filter((position) => position.quantity > 0)
      .map((position) => position.assetId)
  );
  if (!activeAssetIds.size) return "보유 종목 없음: 가격 갱신할 보유 종목이 없습니다.";

  const heldAssets = state.assets.filter((asset) => activeAssetIds.has(asset.id));
  const hasUsAsset = heldAssets.some((asset) => apiMarkets.has(asset.market));
  const hasMissingTicker = heldAssets.some(
    (asset) => apiMarkets.has(asset.market) && !asset.providerSymbol && !asset.ticker && !asset.name
  );
  if (hasMissingTicker) return "티커 누락: 자동 가격 갱신에 필요한 종목 식별값이 없습니다.";
  if (!hasUsAsset) return "보유 종목 없음: 국내 종목은 MVP에서 수동 현재가 입력 대상입니다.";
  return "API 실패: 자동 가격 갱신 대상 종목을 만들 수 없습니다.";
};

export const buildPriceTargets = (state: AppState): PriceRequestItem[] => {
  const heldAssetIds = new Set(
    calculatePositions(state)
      .filter((position) => position.quantity > 0)
      .map((position) => position.assetId)
  );

  return state.assets
    .filter((asset) => heldAssetIds.has(asset.id) && canUseApiPrice(asset))
    .map((asset) => ({
      instrumentId: asset.id,
      ticker: asset.ticker,
      market: asset.market,
      providerSymbol: asset.providerSymbol || asset.ticker || asset.name,
      currency: asset.currency
    }));
};

const postQuotes = (url: string, items: PriceRequestItem[]) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "twelve_data", symbols: items })
  });

const requestQuotes = async (items: PriceRequestItem[]) => {
  let response = await postQuotes("/api/price-quotes", items);
  if (response.status === 404) {
    response = await postQuotes("/.netlify/functions/price-quotes", items);
  }

  if (!response.ok) {
    throw new Error(`가격 API 요청 실패: ${response.status}`);
  }
  return (await response.json()) as PriceApiResponse;
};

export const refreshApiPrices = async (state: AppState): Promise<PriceRefreshResult> => {
  const targets = buildPriceTargets(state);
  const updatedAt = new Date().toISOString();
  if (!targets.length) {
    const message = buildNoTargetMessage(state);
    return {
      state: {
        ...state,
        settings: {
          ...state.settings,
          lastPriceRefreshAt: updatedAt,
          lastPriceRefreshError: message
        }
      },
      updatedCount: 0,
      failedCount: 0,
      message
    };
  }

  const quotes: PriceQuote[] = [];
  const errors: Array<{ instrumentId: string; ticker: string; message: string }> = [];

  try {
    const result = await requestQuotes(targets);
    quotes.push(...(result.quotes ?? []));
    errors.push(...(result.errors ?? []));
  } catch (error) {
    targets.forEach((item) =>
      errors.push({
        instrumentId: item.instrumentId,
        ticker: item.ticker,
        message: error instanceof Error ? `${categorizePriceFailure(error.message)}: ${error.message}` : "API 실패: 가격 업데이트에 실패했습니다."
      })
    );
  }

  const quoteMap = new Map(quotes.map((quote) => [quote.instrumentId, quote]));
  const errorMap = new Map(errors.map((error) => [error.instrumentId, error.message]));
  const nextAssets = state.assets.map((asset) => {
    const quote = quoteMap.get(asset.id);
    if (quote) {
      if (quote.currency === "USD" && !quote.fxRate) {
        return { ...asset, priceUpdateError: "환율 실패: 달러 종목 원화 평가용 환율이 없습니다." };
      }
      return {
        ...asset,
        currentPrice: quote.price,
        currentFxRate: quote.fxRate || asset.currentFxRate || 1,
        priceSource: quote.source,
        priceUpdatedAt: quote.updatedAt,
        priceUpdateError: undefined
      };
    }
    const error = errorMap.get(asset.id);
    return error ? { ...asset, priceUpdateError: error } : asset;
  });

  const nextState = {
    ...state,
    assets: nextAssets,
    priceQuotes: [...quotes, ...state.priceQuotes].slice(0, 500),
    settings: {
      ...state.settings,
      lastPriceRefreshAt: updatedAt,
      lastPriceRefreshError: errors.length
        ? `${errors.length}개 종목 업데이트 실패: ${Array.from(new Set(errors.map((error) => categorizePriceFailure(error.message)))).join(", ")}`
        : undefined
    }
  };

  return {
    state: nextState,
    updatedCount: quotes.length,
    failedCount: errors.length,
    message: errors.length
      ? `${quotes.length}개 가격을 업데이트했고 ${errors.length}개는 실패했습니다.`
      : `${quotes.length}개 가격을 업데이트했습니다.`
  };
};

export const buildManualQuote = (asset: Asset): PriceQuote => ({
  instrumentId: asset.id,
  ticker: asset.ticker,
  market: asset.market,
  price: asset.currentPrice,
  currency: asset.currency,
  fxRate: asset.currentFxRate || 1,
  source: "manual",
  updatedAt: asset.priceUpdatedAt ?? new Date().toISOString()
});
