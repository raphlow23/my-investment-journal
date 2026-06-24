import {
  Account,
  AppState,
  Asset,
  Checklist,
  ChecklistResult,
  DashboardMetrics,
  Market,
  Position,
  Trade,
  WarningItem
} from "../types";

const emotionalStates = new Set(["fomo", "anxiety", "averaging_urge", "revenge", "loss_aversion"]);

const isUsdAsset = (asset?: { currency?: string; market?: Market }) =>
  asset?.currency === "USD" || asset?.market === "US" || asset?.market === "ETF_US";

const tradePriceCurrency = (trade: Trade, asset?: { currency?: string; market?: Market }) => {
  if (trade.priceCurrency) return trade.priceCurrency;
  if (!isUsdAsset(asset)) return "KRW";
  return trade.fxRate && trade.fxRate > 10 ? "USD" : "KRW";
};

const tradeValueKrw = (trade: Trade, asset?: { currency?: string; market?: Market }) => {
  if (trade.priceKrw && trade.priceKrw > 0) {
    return trade.quantity * trade.priceKrw;
  }
  const currency = tradePriceCurrency(trade, asset);
  return trade.quantity * trade.price * (currency === "USD" ? trade.fxRate || 1 : 1);
};

export const calculatePositions = (state: AppState): Position[] => {
  const lots = new Map<
    string,
    {
      accountId: string;
      assetId: string;
      quantity: number;
      costKrw: number;
      totalBuyAmountKrw: number;
      realizedPnlKrw: number;
      lastFxRate: number;
    }
  >();

  [...state.trades]
    .sort((a, b) => `${a.date}-${a.createdAt}`.localeCompare(`${b.date}-${b.createdAt}`))
    .forEach((trade) => {
      const key = `${trade.accountId}:${trade.assetId}`;
      const lot =
        lots.get(key) ??
        {
          accountId: trade.accountId,
          assetId: trade.assetId,
          quantity: 0,
          costKrw: 0,
          totalBuyAmountKrw: 0,
          realizedPnlKrw: 0,
          lastFxRate: trade.fxRate || 1
        };

      const asset = state.assets.find((item) => item.id === trade.assetId);
      const gross = tradeValueKrw(trade, asset);
      if (trade.side === "buy") {
        const cost = gross + trade.fee + trade.tax;
        lot.quantity += trade.quantity;
        lot.costKrw += cost;
        lot.totalBuyAmountKrw += cost;
      } else {
        const sellQuantity = Math.min(trade.quantity, lot.quantity);
        const averageCost = lot.quantity > 0 ? lot.costKrw / lot.quantity : 0;
        const costBasis = averageCost * sellQuantity;
        const sellRatio = trade.quantity > 0 ? sellQuantity / trade.quantity : 0;
        const proceeds = gross * sellRatio - (trade.fee + trade.tax) * sellRatio;
        lot.quantity -= sellQuantity;
        lot.costKrw -= costBasis;
        lot.realizedPnlKrw += proceeds - costBasis;
      }
      lot.lastFxRate = trade.fxRate || lot.lastFxRate;
      lots.set(key, lot);
    });

  const totalMarketValue = Array.from(lots.values()).reduce((sum, lot) => {
    const asset = state.assets.find((item) => item.id === lot.assetId);
    if (!asset || lot.quantity <= 0) return sum;
    return sum + lot.quantity * asset.currentPrice * (asset.currentFxRate || lot.lastFxRate || 1);
  }, 0);

  const accountTotals = new Map<string, number>();
  Array.from(lots.values()).forEach((lot) => {
    const asset = state.assets.find((item) => item.id === lot.assetId);
    if (!asset || lot.quantity <= 0) return;
    const value = lot.quantity * asset.currentPrice * (asset.currentFxRate || lot.lastFxRate || 1);
    accountTotals.set(lot.accountId, (accountTotals.get(lot.accountId) ?? 0) + value);
  });

  return Array.from(lots.values())
    .filter((lot) => lot.quantity > 0.000001 || Math.abs(lot.realizedPnlKrw) > 0.01)
    .map((lot) => {
      const asset = state.assets.find((item) => item.id === lot.assetId);
      const currentFxRate = asset?.currentFxRate || lot.lastFxRate || 1;
      const currentPrice = asset?.currentPrice ?? 0;
      const marketValueKrw = lot.quantity > 0 ? lot.quantity * currentPrice * currentFxRate : 0;
      const unrealizedPnlKrw = marketValueKrw - lot.costKrw;
      const accountTotal = accountTotals.get(lot.accountId) ?? 0;
      return {
        key: `${lot.accountId}:${lot.assetId}`,
        accountId: lot.accountId,
        assetId: lot.assetId,
        quantity: lot.quantity,
        averageCostKrw: lot.quantity > 0 ? lot.costKrw / lot.quantity : 0,
        totalBuyAmountKrw: lot.totalBuyAmountKrw,
        currentPrice,
        currentFxRate,
        marketValueKrw,
        unrealizedPnlKrw,
        unrealizedReturnRate: lot.costKrw > 0 ? (unrealizedPnlKrw / lot.costKrw) * 100 : 0,
        realizedPnlKrw: lot.realizedPnlKrw,
        portfolioWeight: totalMarketValue > 0 ? (marketValueKrw / totalMarketValue) * 100 : 0,
        accountWeight: accountTotal > 0 ? (marketValueKrw / accountTotal) * 100 : 0
      };
    });
};

export const calculateMetrics = (state: AppState, positions = calculatePositions(state)): DashboardMetrics => {
  const activePositions = positions.filter((position) => position.quantity > 0);
  const totalMarketValue = activePositions.reduce((sum, position) => sum + position.marketValueKrw, 0);
  const totalInvested = activePositions.reduce(
    (sum, position) => sum + position.averageCostKrw * position.quantity,
    0
  );
  const unrealizedPnl = activePositions.reduce((sum, position) => sum + position.unrealizedPnlKrw, 0);
  const realizedPnl = positions.reduce((sum, position) => sum + position.realizedPnlKrw, 0);
  const cashValue = activePositions.reduce((sum, position) => {
    const asset = state.assets.find((item) => item.id === position.assetId);
    return asset?.assetClass === "cash" ? sum + position.marketValueKrw : sum;
  }, 0);
  const recentLine = new Date();
  recentLine.setDate(recentLine.getDate() - 30);
  const month = new Date().toISOString().slice(0, 7);
  return {
    totalMarketValue,
    totalInvested,
    unrealizedPnl,
    realizedPnl,
    totalReturnRate: totalInvested > 0 ? ((unrealizedPnl + realizedPnl) / totalInvested) * 100 : 0,
    cashWeight: totalMarketValue > 0 ? (cashValue / totalMarketValue) * 100 : 0,
    recent30DayTradeCount: state.trades.filter((trade) => new Date(trade.date) >= recentLine).length,
    monthlyEmotionalTradeCount: state.trades.filter(
      (trade) => trade.date.startsWith(month) && emotionalStates.has(trade.emotion)
    ).length
  };
};

export const calculateScopedMetrics = (state: AppState, positions: Position[]): DashboardMetrics => {
  const metrics = calculateMetrics(state, positions);
  const accountIds = new Set(positions.map((position) => position.accountId));
  const recentLine = new Date();
  recentLine.setDate(recentLine.getDate() - 30);
  const month = new Date().toISOString().slice(0, 7);
  return {
    ...metrics,
    recent30DayTradeCount: state.trades.filter(
      (trade) => accountIds.has(trade.accountId) && new Date(trade.date) >= recentLine
    ).length,
    monthlyEmotionalTradeCount: state.trades.filter(
      (trade) => accountIds.has(trade.accountId) && trade.date.startsWith(month) && emotionalStates.has(trade.emotion)
    ).length
  };
};

export const aggregateAssetPositions = (state: AppState, positions: Position[]) => {
  const totalValue = positions
    .filter((position) => position.quantity > 0)
    .reduce((sum, position) => sum + position.marketValueKrw, 0);
  const groups = new Map<
    string,
    {
      assetId: string;
      quantity: number;
      marketValueKrw: number;
      unrealizedPnlKrw: number;
      realizedPnlKrw: number;
      costKrw: number;
      weight: number;
    }
  >();

  positions.forEach((position) => {
    const existing =
      groups.get(position.assetId) ??
      {
        assetId: position.assetId,
        quantity: 0,
        marketValueKrw: 0,
        unrealizedPnlKrw: 0,
        realizedPnlKrw: 0,
        costKrw: 0,
        weight: 0
      };
    existing.quantity += position.quantity;
    existing.marketValueKrw += position.marketValueKrw;
    existing.unrealizedPnlKrw += position.unrealizedPnlKrw;
    existing.realizedPnlKrw += position.realizedPnlKrw;
    existing.costKrw += position.averageCostKrw * position.quantity;
    groups.set(position.assetId, existing);
  });

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      returnRate: item.costKrw > 0 ? (item.unrealizedPnlKrw / item.costKrw) * 100 : 0,
      weight: totalValue > 0 ? (item.marketValueKrw / totalValue) * 100 : 0,
      asset: state.assets.find((asset) => asset.id === item.assetId)
    }))
    .sort((a, b) => b.marketValueKrw - a.marketValueKrw);
};

export const groupExposure = (
  state: AppState,
  positions: Position[],
  type: "market" | "currency"
) => {
  const result = new Map<string, number>();
  positions
    .filter((position) => position.quantity > 0)
    .forEach((position) => {
      const asset = state.assets.find((item) => item.id === position.assetId);
      const key =
        type === "currency"
          ? asset?.currency ?? "미분류"
          : asset?.market === "US" || asset?.market === "ETF_US"
            ? "해외"
            : asset?.market === "KR" || asset?.market === "ETF_KR"
              ? "국내"
              : "미분류";
      result.set(key, (result.get(key) ?? 0) + position.marketValueKrw);
    });
  return Array.from(result.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
};

export const groupPositions = (
  state: AppState,
  positions: Position[],
  type: "account" | "sector" | "theme" | "asset"
) => {
  const result = new Map<string, number>();
  positions
    .filter((position) => position.quantity > 0)
    .forEach((position) => {
      const asset = state.assets.find((item) => item.id === position.assetId);
      const account = state.accounts.find((item) => item.id === position.accountId);
      const keys =
        type === "account"
          ? [account?.name ?? "미분류"]
          : type === "sector"
            ? [asset?.sector || "미분류"]
            : type === "theme"
              ? asset?.themes.length
                ? asset.themes
                : ["미분류"]
              : [asset?.name ?? "미분류"];
      keys.forEach((key) => result.set(key, (result.get(key) ?? 0) + position.marketValueKrw));
    });

  return Array.from(result.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
};

export const evaluateChecklist = (checklist: Omit<Checklist, "result">): ChecklistResult => {
  if (checklist.fomo || checklist.averaging) return "no_add_buy";
  if (!checklist.planned || !checklist.maChecked || !checklist.hasInvalidation) {
    return "not_enough_data";
  }
  return "small_split_only";
};

export const buildWarnings = (state: AppState, positions = calculatePositions(state)): WarningItem[] => {
  const warnings: WarningItem[] = [];
  const metrics = calculateMetrics(state, positions);

  state.assets
    .filter((asset) => asset.priceUpdateError)
    .forEach((asset) => {
      warnings.push({
        id: `${asset.id}-price-error`,
        severity: "medium",
        title: `${asset.name} 가격 업데이트 실패`,
        detail: `${asset.priceUpdateError} 마지막 가격 ${asset.currentPrice} ${asset.currency}, ${asset.priceUpdatedAt?.slice(0, 19).replace("T", " ") ?? "업데이트 기록 없음"}`
      });
    });

  positions
    .filter((position) => position.quantity > 0)
    .forEach((position) => {
      const asset = state.assets.find((item) => item.id === position.assetId);
      const name = asset?.name ?? "미등록 종목";
      if (position.unrealizedReturnRate <= -20) {
        warnings.push({
          id: `${position.key}-loss20`,
          severity: "high",
          title: `${name} 손실률 -20% 이하`,
          detail: "교체매매 검토가 필요한 구간입니다."
        });
      } else if (position.unrealizedReturnRate <= -15) {
        warnings.push({
          id: `${position.key}-loss15`,
          severity: "medium",
          title: `${name} 손실률 -15% 이하`,
          detail: "보유 논리와 매도검토 조건을 다시 점검하세요."
        });
      }
      if (position.portfolioWeight > 10) {
        warnings.push({
          id: `${position.key}-weight10`,
          severity: "medium",
          title: `${name} 단일 종목 비중 10% 초과`,
          detail: "추가매수 제한 기준에 해당합니다."
        });
      }
      if (asset?.isLeveraged) {
        warnings.push({
          id: `${position.key}-leveraged`,
          severity: "low",
          title: `${name} 레버리지 ETF 보유`,
          detail: "전술용 보유인지 점검하세요."
        });
      }
      const thesis = state.theses.find((item) => item.assetId === position.assetId);
      if (thesis?.invalidationPrice && asset?.currentPrice && asset.currentPrice < thesis.invalidationPrice) {
        warnings.push({
          id: `${position.key}-sell-review-price`,
          severity: "high",
          title: `${name} 점검 필요`,
          detail: `현재가가 매도검토가 ${thesis.invalidationPrice} 아래입니다. 즉시 매도 신호가 아니라 보유 논리 재점검 기준입니다.`
        });
      }
      if (thesis?.grade === "D" || thesis?.grade === "exclude") {
        warnings.push({
          id: `${position.key}-grade-warning`,
          severity: thesis.grade === "exclude" ? "high" : "medium",
          title: `${name} ${thesis.grade === "exclude" ? "매수금지" : "정리 후보"} 등급`,
          detail: "추가매수 전 보유·대응 기준을 다시 확인하세요."
        });
      }
    });

  state.trades.forEach((trade) => {
    const asset = state.assets.find((item) => item.id === trade.assetId);
    const label = `${trade.date} ${asset?.name ?? "미등록 종목"}`;
    if (!trade.reason.trim()) {
      warnings.push({
        id: `${trade.id}-reason`,
        severity: "medium",
        title: `${label} 매매 이유 없음`,
        detail: "기록 보완이 필요합니다."
      });
    }
    if (!trade.invalidation.trim() && trade.side === "buy") {
      warnings.push({
        id: `${trade.id}-invalidation`,
        severity: "high",
        title: `${label} 매도검토 조건 없음`,
        detail: "보유 논리가 깨졌을 때의 대응 기준을 보완하세요."
      });
    }
    if (trade.emotion === "fomo") {
      warnings.push({
        id: `${trade.id}-fomo`,
        severity: "high",
        title: `${label} FOMO 기록`,
        detail: "추격매수 위험으로 표시됩니다."
      });
    }
    if (trade.emotion === "averaging_urge") {
      warnings.push({
        id: `${trade.id}-averaging`,
        severity: "high",
        title: `${label} 물타기 충동 기록`,
        detail: "물타기 위험으로 표시됩니다."
      });
    }
  });

  const themeGroups = groupPositions(state, positions, "theme");
  const aiSemiconductor = themeGroups
    .filter((item) => ["AI", "반도체"].includes(item.name))
    .reduce((sum, item) => sum + item.value, 0);
  const totalValue = metrics.totalMarketValue;
  if (totalValue > 0 && (aiSemiconductor / totalValue) * 100 > 35) {
    warnings.push({
      id: "theme-ai-semiconductor",
      severity: "medium",
      title: "반도체·AI 테마 비중 35% 초과",
      detail: "신규매수 제한 기준에 해당합니다."
    });
  }

  const growthValue = positions.reduce((sum, position) => {
    const asset = state.assets.find((item) => item.id === position.assetId);
    return asset?.isGrowth ? sum + position.marketValueKrw : sum;
  }, 0);
  if (totalValue > 0 && (growthValue / totalValue) * 100 > 45) {
    warnings.push({
      id: "growth-weight",
      severity: "medium",
      title: "성장주 합산 45% 초과",
      detail: "공격 비중이 과다한지 확인하세요."
    });
  }

  if (totalValue > 0 && metrics.cashWeight < 5) {
    warnings.push({
      id: "cash-low",
      severity: "low",
      title: "현금 비중 5% 미만",
      detail: "하락 대응력이 부족할 수 있습니다."
    });
  }

  return warnings;
};

export const assetName = (assets: Asset[], assetId: string) =>
  assets.find((asset) => asset.id === assetId)?.name ?? "미등록 종목";

export const accountName = (accounts: Account[], accountId: string) =>
  accounts.find((account) => account.id === accountId)?.name ?? "미등록 계좌";

export const marketLabel = (market: Market) =>
  market === "US" || market === "ETF_US" ? "해외" : market === "KR" || market === "ETF_KR" ? "국내" : "미분류";
