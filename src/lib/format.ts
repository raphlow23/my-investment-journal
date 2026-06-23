export const formatKrw = (value: number) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);

export const formatUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);

export const formatPercent = (value: number) =>
  `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;

export const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: digits
  }).format(Number.isFinite(value) ? value : 0);

export const canDisplayNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value);

export const formatKrwOrDash = (value: number | null | undefined) =>
  canDisplayNumber(value) ? formatKrw(value as number) : "—";

export const formatPercentOrDash = (value: number | null | undefined) =>
  canDisplayNumber(value) ? formatPercent(value as number) : "—";

export const formatNumberOrDash = (value: number | null | undefined, digits = 0) =>
  canDisplayNumber(value) ? formatNumber(value as number, digits) : "—";

export const today = () => new Date().toISOString().slice(0, 10);

export const currentMonth = () => new Date().toISOString().slice(0, 7);
