export type AccountType = "taxable" | "isa" | "pension" | "dc" | "cash";
export type Currency = "KRW" | "USD";
export type Market = "KR" | "US" | "ETF_KR" | "ETF_US";
export type AssetClass = "stock" | "etf" | "cash" | "bond" | "pension";
export type PriceProvider = "manual" | "twelve_data";
export type PriceSource = "manual" | "api";
export type TradeSide = "buy" | "sell";
export type TradeKind =
  | "initial_holding"
  | "new"
  | "add"
  | "partial_sell"
  | "full_sell"
  | "rebalance"
  | "switch";
export type Horizon = "1m" | "3m" | "6m" | "long";
export type Emotion =
  | "planned"
  | "fomo"
  | "anxiety"
  | "averaging_urge"
  | "revenge"
  | "loss_aversion"
  | "neutral";
export type ThesisGrade = "A" | "B" | "C" | "D" | "exclude";
export type SwapDecision =
  | "hold"
  | "switch_after_rebound"
  | "partial_switch"
  | "full_switch"
  | "no_switch";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  memo: string;
  createdAt: string;
}

export interface Asset {
  id: string;
  name: string;
  ticker: string;
  market: Market;
  assetClass: AssetClass;
  sector: string;
  themes: string[];
  country: string;
  currency: Currency;
  benchmark: string;
  currentPrice: number;
  currentFxRate: number;
  priceProvider: PriceProvider;
  providerSymbol: string;
  priceSource: PriceSource;
  priceUpdatedAt?: string;
  priceUpdateError?: string;
  isLeveraged?: boolean;
  isGrowth?: boolean;
  createdAt: string;
}

export interface Trade {
  id: string;
  date: string;
  accountId: string;
  assetId: string;
  side: TradeSide;
  kind: TradeKind;
  quantity: number;
  price: number;
  priceCurrency?: Currency;
  fee: number;
  tax: number;
  fxRate: number;
  totalAmountKrw: number;
  assetNameSnapshot: string;
  tickerSnapshot: string;
  marketSnapshot: Market;
  reason: string;
  invalidation: string;
  horizon: Horizon;
  emotion: Emotion;
  thesisSnapshot: string;
  riskMemo: string;
  reviewMemo: string;
  memo: string;
  createdAt: string;
}

export interface Thesis {
  id: string;
  assetId: string;
  grade: ThesisGrade;
  summary: [string, string, string];
  targetPrice: number;
  stopLossPrice: number;
  addBuyPrice: number;
  holdingConditionTags: string[];
  holdingMemo: string;
  keyRisk: string;
  keyRiskTags: string[];
  invalidationPrice: number;
  invalidationCondition: string;
  invalidationConditionTags: string[];
  addCondition: string;
  addConditionTags: string[];
  noAddCondition: string;
  noAddConditionTags: string[];
  partialSellCondition: string;
  partialSellConditionTags: string[];
  fullExitCondition: string;
  fullExitConditionTags: string[];
  alternatives: string;
  alternativeAssetIds: string[];
  alternativePresetTags: string[];
  lastReviewedAt: string;
  nextReviewAt: string;
}

export interface Checklist {
  id: string;
  date: string;
  accountId: string;
  assetId: string;
  buyReason: string;
  trend: string;
  overheated: string;
  supply: string;
  positionWeightMemo: string;
  stopLossPlan: string;
  targetPricePlan: string;
  finalDecision: string;
  planned: boolean;
  fomo: boolean;
  averaging: boolean;
  thesisImproved: boolean;
  maChecked: boolean;
  earningsChecked: boolean;
  relativeReturnChecked: boolean;
  sectorWeightOk: boolean;
  riskSizingChecked: boolean;
  eventRiskChecked: boolean;
  marketDefenseChecked: boolean;
  hasInvalidation: boolean;
  result: ChecklistResult;
  memo: string;
}

export type ChecklistResult =
  | "buy_ok"
  | "small_split_only"
  | "chasing_risk"
  | "averaging_risk"
  | "no_add_buy"
  | "not_enough_data";

export interface SwapReview {
  id: string;
  date: string;
  currentAssetId: string;
  candidateAssetId: string;
  currentReturnRate: number;
  thesisStillValid: boolean;
  recoveredMovingAverages: boolean;
  candidateThesis: string;
  candidateStrength: string;
  candidateRisk: string;
  taxFeeMemo: string;
  decision: SwapDecision;
}

export interface MonthlyReview {
  id: string;
  month: string;
  totalReturnRate: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitLossRatio: number;
  expectancy: number;
  bestTrade: string;
  worstTrade: string;
  emotionalTrades: string;
  nextMonthRules: string;
}

export interface DriveSyncMeta {
  connected: boolean;
  email?: string;
  fileId?: string;
  lastBackupAt?: string;
  lastRestoreAt?: string;
  lastDriveModifiedAt?: string;
}

export type CloudSyncStatus =
  | "local"
  | "signed_out"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export interface CloudSyncMeta {
  enabled: boolean;
  userId?: string;
  lastSyncedAt?: string;
  lastError?: string;
  pendingDeletes?: CloudDelete[];
}

export interface CloudDelete {
  collection: "accounts" | "instruments" | "tradeLogs" | "positionPlans" | "priceSnapshots" | "preTradeChecklists" | "switchReviews" | "monthlyReviews";
  id: string;
  deletedAt: string;
}

export interface Settings {
  darkMode: boolean;
  backupPasswordHint: string;
  defaultPriceProvider: PriceProvider;
  lastPriceRefreshAt?: string;
  lastPriceRefreshError?: string;
  cloudSync: CloudSyncMeta;
  driveSync: DriveSyncMeta;
}

export interface AppState {
  version: number;
  updatedAt: string;
  accounts: Account[];
  assets: Asset[];
  priceQuotes: PriceQuote[];
  trades: Trade[];
  theses: Thesis[];
  checklists: Checklist[];
  swapReviews: SwapReview[];
  monthlyReviews: MonthlyReview[];
  settings: Settings;
}

export interface PriceQuote {
  instrumentId: string;
  ticker: string;
  market: Market;
  price: number;
  currency: Currency;
  fxRate: number;
  source: PriceSource;
  updatedAt: string;
}

export interface Position {
  key: string;
  accountId: string;
  assetId: string;
  quantity: number;
  averageCostKrw: number;
  totalBuyAmountKrw: number;
  currentPrice: number;
  currentFxRate: number;
  marketValueKrw: number;
  unrealizedPnlKrw: number;
  unrealizedReturnRate: number;
  realizedPnlKrw: number;
  portfolioWeight: number;
  accountWeight: number;
}

export interface DashboardMetrics {
  totalMarketValue: number;
  totalInvested: number;
  unrealizedPnl: number;
  realizedPnl: number;
  totalReturnRate: number;
  cashWeight: number;
  recent30DayTradeCount: number;
  monthlyEmotionalTradeCount: number;
}

export interface WarningItem {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}
