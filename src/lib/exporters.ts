import { AppState } from "../types";
import { accountName, assetName, buildWarnings, calculateMetrics, calculatePositions } from "./calculations";
import { formatKrw, formatPercent } from "./format";

const csvEscape = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const toCsv = (rows: Array<Record<string, unknown>>) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join(
    "\n"
  );
};

export const buildExportBundle = (state: AppState) => {
  const positions = calculatePositions(state);
  const metrics = calculateMetrics(state, positions);
  const warnings = buildWarnings(state, positions);
  return {
    exportedAt: new Date().toISOString(),
    summary: metrics,
    accounts: state.accounts,
    assets: state.assets,
    priceQuotes: state.priceQuotes,
    positions,
    trades: state.trades,
    theses: state.theses,
    monthlyReviews: state.monthlyReviews,
    warnings,
    lossPositions: positions.filter((position) => position.unrealizedPnlKrw < 0),
    overweightPositions: positions.filter((position) => position.portfolioWeight > 10),
    swapCandidates: state.swapReviews
  };
};

export const exportJson = (state: AppState) => JSON.stringify(buildExportBundle(state), null, 2);

export const exportCsv = (state: AppState) => {
  const positions = calculatePositions(state);
  const positionRows = positions.map((position) => ({
    section: "position",
    account: accountName(state.accounts, position.accountId),
    asset: assetName(state.assets, position.assetId),
    quantity: position.quantity,
    marketValueKrw: position.marketValueKrw,
    unrealizedPnlKrw: position.unrealizedPnlKrw,
    realizedPnlKrw: position.realizedPnlKrw,
    weight: position.portfolioWeight
  }));
  const tradeRows = state.trades.map((trade) => ({
    section: "trade",
    account: accountName(state.accounts, trade.accountId),
    asset: trade.assetNameSnapshot || assetName(state.assets, trade.assetId),
    market: trade.marketSnapshot,
    date: trade.date,
    side: trade.side,
    kind: trade.kind,
    quantity: trade.quantity,
    price: trade.price,
    priceKrw: trade.priceKrw,
    fee: trade.fee,
    tax: trade.tax,
    fxRate: trade.fxRate,
    totalAmountKrw: trade.totalAmountKrw,
    reason: trade.reason,
    emotion: trade.emotion,
    invalidation: trade.invalidation,
    thesisSnapshot: trade.thesisSnapshot,
    riskMemo: trade.riskMemo,
    reviewMemo: trade.reviewMemo
  }));
  return toCsv([...positionRows, ...tradeRows]);
};

export const exportMarkdown = (state: AppState) => {
  const positions = calculatePositions(state);
  const metrics = calculateMetrics(state, positions);
  const warnings = buildWarnings(state, positions);
  const lines = [
    "# My Investment Journal Export",
    "",
    `- Exported: ${new Date().toISOString()}`,
    `- 총 평가금액: ${formatKrw(metrics.totalMarketValue)}`,
    `- 총 투자원금: ${formatKrw(metrics.totalInvested)}`,
    `- 총 평가손익: ${formatKrw(metrics.unrealizedPnl)}`,
    `- 총 실현손익: ${formatKrw(metrics.realizedPnl)}`,
    `- 총 수익률: ${formatPercent(metrics.totalReturnRate)}`,
    "",
    "## 보유 종목",
    "",
    "|계좌|종목|수량|평가금액|평가손익|비중|",
    "|---|---:|---:|---:|---:|---:|",
    ...positions
      .filter((position) => position.quantity > 0)
      .map(
        (position) =>
          `|${accountName(state.accounts, position.accountId)}|${assetName(state.assets, position.assetId)}|${position.quantity}|${formatKrw(position.marketValueKrw)}|${formatKrw(position.unrealizedPnlKrw)}|${formatPercent(position.portfolioWeight)}|`
      ),
    "",
    "## 최근 매매 기록",
    "",
    "|날짜|계좌|종목|시장|구분|유형|수량|단가|총 거래금액|이유|감정|매도검토 조건|보유 기준 스냅샷|리스크|사후 복기|",
    "|---|---|---|---|---|---|---:|---:|---:|---|---|---|---|---|---|",
    ...state.trades
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(
        (trade) =>
          `|${trade.date}|${accountName(state.accounts, trade.accountId)}|${trade.assetNameSnapshot || assetName(state.assets, trade.assetId)}|${trade.marketSnapshot}|${trade.side}|${trade.kind}|${trade.quantity}|${trade.price}|${formatKrw(trade.totalAmountKrw)}|${trade.reason}|${trade.emotion}|${trade.invalidation}|${trade.thesisSnapshot.replace(/\n/g, "<br>")}|${trade.riskMemo}|${trade.reviewMemo}|`
      ),
    "",
    "## 경고",
    "",
    ...warnings.map((warning) => `- [${warning.severity}] ${warning.title}: ${warning.detail}`),
    "",
    "## 종목별 보유·대응 기준",
    "",
    ...state.theses.map((thesis) => {
      const asset = assetName(state.assets, thesis.assetId);
      return [
        `### ${asset}`,
        `- 투자 등급: ${thesis.grade}`,
        `- 보유 조건: ${thesis.holdingConditionTags?.join(", ") || thesis.holdingMemo || "미설정"}`,
        `- 매도검토가: ${thesis.invalidationPrice || "미설정"}`,
        `- 매도검토 조건: ${thesis.invalidationConditionTags?.join(", ") || thesis.invalidationCondition || "미설정"}`,
        `- 추가매수 금지: ${thesis.noAddConditionTags?.join(", ") || thesis.noAddCondition || "미설정"}`,
        `- 일부매도 조건: ${thesis.partialSellConditionTags?.join(", ") || thesis.partialSellCondition || "미설정"}`
      ].join("\n");
    }),
    "",
    "## 월간 복기",
    "",
    ...state.monthlyReviews.map(
      (review) =>
        `### ${review.month}\n- 승률: ${formatPercent(review.winRate)}\n- 기대값: ${formatKrw(review.expectancy)}\n- 다음 달 원칙: ${review.nextMonthRules}`
    )
  ];
  return lines.join("\n");
};

export const downloadText = (filename: string, text: string, type: string) => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
