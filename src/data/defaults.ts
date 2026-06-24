import { Account, AppState } from "../types";

const now = () => new Date().toISOString();

export const defaultAccounts: Account[] = [
  { id: "account-taxable", name: "일반계좌", type: "taxable", currency: "KRW", memo: "", createdAt: now() },
  { id: "account-isa", name: "ISA", type: "isa", currency: "KRW", memo: "", createdAt: now() },
  { id: "account-pension", name: "연금저축", type: "pension", currency: "KRW", memo: "", createdAt: now() },
  { id: "account-dc", name: "DC", type: "dc", currency: "KRW", memo: "", createdAt: now() },
  { id: "account-cash", name: "현금", type: "cash", currency: "KRW", memo: "", createdAt: now() }
];

export const createEmptyState = (): AppState => ({
  version: 1,
  updatedAt: now(),
  accounts: defaultAccounts,
  assets: [],
  priceQuotes: [],
  trades: [],
  theses: [],
  checklists: [],
  swapReviews: [],
  monthlyReviews: [],
  settings: {
    darkMode: false,
    backupPasswordHint: "",
    defaultPriceProvider: "twelve_data",
    cloudSync: {
      enabled: false
    },
    driveSync: {
      connected: false
    }
  }
});

export const mergeWithDefaults = (value: Partial<AppState> | null): AppState => {
  const empty = createEmptyState();
  if (!value) return empty;

  const inferTradePriceCurrency = (trade: NonNullable<typeof value.trades>[number]) => {
    const asset = value.assets?.find((item) => item.id === trade.assetId);
    const isUsdAsset = asset?.currency === "USD" || asset?.market === "US" || asset?.market === "ETF_US";
    if (!isUsdAsset) return "KRW";
    return trade.fxRate && trade.fxRate > 10 ? "USD" : "KRW";
  };

  return {
    ...empty,
    ...value,
    accounts: value.accounts?.length
      ? value.accounts.map((account) => ({ ...account, memo: account.memo ?? "" }))
      : empty.accounts,
    assets: (value.assets ?? []).map((asset) => ({
      ...asset,
      priceProvider: asset.market === "US" || asset.market === "ETF_US" ? "twelve_data" : "manual",
      providerSymbol: asset.providerSymbol ?? asset.ticker ?? asset.name,
      priceSource: asset.priceSource ?? "manual",
      priceUpdateError: asset.priceUpdateError ?? undefined
    })),
    priceQuotes: value.priceQuotes ?? [],
    trades: (value.trades ?? []).map((trade) => {
      const asset = value.assets?.find((item) => item.id === trade.assetId);
      const priceCurrency = trade.priceCurrency ?? inferTradePriceCurrency(trade);
      return {
        ...trade,
        priceCurrency,
        priceKrw: trade.priceKrw ?? (
          priceCurrency === "USD" && trade.fxRate > 0
            ? trade.price * trade.fxRate
            : trade.price
        ),
        totalAmountKrw: trade.totalAmountKrw ?? trade.quantity * (
          trade.priceKrw ?? trade.price * (priceCurrency === "USD" ? trade.fxRate : 1)
        ) + trade.fee + trade.tax,
        assetNameSnapshot: trade.assetNameSnapshot ?? asset?.name ?? "",
        tickerSnapshot: trade.tickerSnapshot ?? asset?.ticker ?? "",
        marketSnapshot: trade.marketSnapshot ?? asset?.market ?? "KR",
        thesisSnapshot: trade.thesisSnapshot ?? "",
        riskMemo: trade.riskMemo ?? "",
        reviewMemo: trade.reviewMemo ?? ""
      };
    }),
    theses: (value.theses ?? []).map((thesis) => ({
      ...thesis,
      grade: thesis.grade === "exclude" ? "exclude" : thesis.grade ?? "B",
      targetPrice: thesis.targetPrice ?? 0,
      stopLossPrice: thesis.stopLossPrice ?? 0,
      addBuyPrice: thesis.addBuyPrice ?? 0,
      holdingConditionTags: thesis.holdingConditionTags ?? thesis.summary?.filter(Boolean) ?? [],
      holdingMemo: thesis.holdingMemo ?? thesis.summary?.filter(Boolean).join("\n") ?? "",
      keyRiskTags: thesis.keyRiskTags ?? [],
      invalidationConditionTags: thesis.invalidationConditionTags ?? [],
      addConditionTags: thesis.addConditionTags ?? [],
      noAddCondition: thesis.noAddCondition ?? "",
      noAddConditionTags: thesis.noAddConditionTags ?? [],
      partialSellConditionTags: thesis.partialSellConditionTags ?? [],
      fullExitConditionTags: thesis.fullExitConditionTags ?? [],
      alternativeAssetIds: thesis.alternativeAssetIds ?? [],
      alternativePresetTags: thesis.alternativePresetTags ?? [],
      nextReviewAt: thesis.nextReviewAt ?? thesis.lastReviewedAt ?? ""
    })),
    checklists: (value.checklists ?? []).map((checklist) => ({
      ...checklist,
      accountId: checklist.accountId ?? empty.accounts[0]?.id ?? "",
      buyReason: checklist.buyReason ?? "",
      trend: checklist.trend ?? "확인 안함",
      overheated: checklist.overheated ?? "확인 안함",
      supply: checklist.supply ?? "확인 안함",
      positionWeightMemo: checklist.positionWeightMemo ?? "",
      stopLossPlan: checklist.stopLossPlan ?? "",
      targetPricePlan: checklist.targetPricePlan ?? "",
      finalDecision: checklist.finalDecision ?? "",
      riskSizingChecked: checklist.riskSizingChecked ?? false,
      eventRiskChecked: checklist.eventRiskChecked ?? false,
      marketDefenseChecked: checklist.marketDefenseChecked ?? false
    })),
    swapReviews: value.swapReviews ?? [],
    monthlyReviews: value.monthlyReviews ?? [],
    settings: {
      ...empty.settings,
      ...value.settings,
      defaultPriceProvider: "twelve_data",
      cloudSync: {
        ...empty.settings.cloudSync,
        ...value.settings?.cloudSync
      },
      driveSync: {
        ...empty.settings.driveSync,
        ...value.settings?.driveSync
      }
    }
  };
};
