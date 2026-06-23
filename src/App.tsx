import {
  BarChart3,
  CheckCircle2,
  Cloud,
  Clock3,
  Download,
  FileJson,
  Moon,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  Sun,
  Upload
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";
import {
  Account,
  AccountType,
  AppState,
  Asset,
  AssetClass,
  CloudSyncStatus,
  Checklist,
  Currency,
  Emotion,
  Horizon,
  Market,
  MonthlyReview,
  SwapDecision,
  Thesis,
  ThesisGrade,
  Trade,
  TradeKind,
  TradeSide
} from "./types";
import { createEmptyState, mergeWithDefaults } from "./data/defaults";
import {
  accountName,
  aggregateAssetPositions,
  assetName,
  buildWarnings,
  calculateMetrics,
  calculatePositions,
  calculateScopedMetrics,
  evaluateChecklist,
  groupExposure,
  groupPositions
} from "./lib/calculations";
import { createId } from "./lib/id";
import {
  currentMonth,
  formatKrw,
  formatKrwOrDash,
  formatNumber,
  formatNumberOrDash,
  formatPercent,
  formatPercentOrDash,
  today
} from "./lib/format";
import { loadState, resetState, saveState } from "./lib/storage";
import { downloadText, exportCsv, exportJson, exportMarkdown } from "./lib/exporters";
import { buildManualQuote, refreshApiPrices } from "./lib/prices";
import {
  getFirebaseServices,
  getFirebaseAuthErrorMessage,
  handleRedirectLoginResult,
  isFirebaseConfigured,
  listenToFirebaseUser,
  signInWithGoogle,
  signOutFirebase
} from "./lib/firebaseClient";
import {
  downloadCloudState,
  hasUserData,
  mergeLocalAndCloud,
  uploadStateToCloud
} from "./lib/cloudSync";

type TabKey =
  | "dashboard"
  | "manage"
  | "trades"
  | "holdings"
  | "thesis"
  | "checklist"
  | "swap"
  | "review"
  | "backup"
  | "more";

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "dashboard", label: "대시보드" },
  { key: "trades", label: "매매" },
  { key: "holdings", label: "보유" },
  { key: "checklist", label: "매수점검" },
  { key: "more", label: "더보기" }
];

const accountTypeLabels: Record<AccountType, string> = {
  taxable: "일반",
  isa: "ISA",
  pension: "연금저축",
  dc: "DC",
  cash: "현금"
};

const marketLabels: Record<Market, string> = {
  KR: "한국 주식",
  US: "미국 주식",
  ETF_KR: "한국 ETF",
  ETF_US: "미국 ETF"
};

const assetClassLabels: Record<AssetClass, string> = {
  stock: "주식",
  etf: "ETF",
  cash: "현금",
  bond: "채권",
  pension: "연금"
};

const sideLabels: Record<TradeSide, string> = {
  buy: "매수",
  sell: "매도"
};

const tradeKindLabels: Record<TradeKind, string> = {
  initial_holding: "초기보유",
  new: "신규",
  add: "추가매수",
  partial_sell: "일부매도",
  full_sell: "전량매도",
  rebalance: "리밸런싱",
  switch: "교체매매"
};

const horizonLabels: Record<Horizon, string> = {
  "1m": "1개월",
  "3m": "3개월",
  "6m": "6개월",
  long: "장기"
};

const emotionLabels: Record<Emotion, string> = {
  planned: "계획매수",
  fomo: "FOMO",
  anxiety: "불안",
  averaging_urge: "물타기 충동",
  revenge: "보복매매",
  loss_aversion: "손실회피",
  neutral: "중립"
};

const gradeLabels: Record<ThesisGrade, string> = {
  A: "A / 핵심 보유",
  B: "B / 보유·관찰",
  C: "C / 소액 관찰",
  D: "D / 정리 후보",
  exclude: "X / 매수금지"
};

const holdingConditionOptions = [
  "실적 성장 지속",
  "업황 회복",
  "시장점유율 확대",
  "밸류에이션 매력",
  "배당 안정성",
  "장기 테마 유효",
  "지수 대비 강세",
  "포트폴리오 분산 역할"
];

const riskOptions = [
  "실적 둔화",
  "마진 악화",
  "금리 상승",
  "환율 변동",
  "경쟁 심화",
  "정책·규제",
  "테마 과열",
  "단일 고객 의존"
];

const sellReviewConditionOptions = [
  "매도검토가 이탈",
  "실적 전망 하향",
  "투자 테마 훼손",
  "지수 대비 3개월 이상 부진",
  "20일선·60일선 동시 이탈",
  "핵심 리스크 현실화",
  "목표 기간 초과 후 논리 약화"
];

const addConditionOptions = [
  "실적 개선 확인",
  "지지선 확인",
  "목표 비중 미달",
  "시장 조정 후 반등",
  "기준지수 대비 강세",
  "보유 논리 강화"
];

const noAddConditionOptions = [
  "투자 등급 D 또는 X",
  "매도검토가 하회",
  "단일 종목 비중 과다",
  "동일 테마 비중 과다",
  "FOMO 매수 위험",
  "물타기 충동",
  "실적 확인 전"
];

const partialSellConditionOptions = [
  "목표 비중 초과",
  "단기 급등",
  "실적 기대 과반영",
  "테마 과열",
  "리스크 확대",
  "교체 후보 우위"
];

const fullExitConditionOptions = [
  "투자 논리 훼손",
  "매도검토가 장기 하회",
  "실적 추세 전환",
  "교체 후보 명확",
  "리스크 현실화",
  "투자 등급 X"
];

const alternativePresetOptions = [
  "S&P500 ETF",
  "나스닥100 ETF",
  "S&P500 모멘텀 ETF",
  "배당 ETF",
  "단기채 ETF",
  "현금 대기"
];

const swapDecisionLabels: Record<SwapDecision, string> = {
  hold: "보유 유지",
  switch_after_rebound: "반등 후 교체",
  partial_switch: "일부 손절 후 교체",
  full_switch: "전량 교체",
  no_switch: "교체 금지"
};

const checklistResultLabels = {
  buy_ok: "소액 분할매수 가능",
  small_split_only: "소액 분할만 가능",
  chasing_risk: "추격매수 위험",
  averaging_risk: "물타기 위험",
  no_add_buy: "매수 금지",
  not_enough_data: "보류"
};

const syncStatusLabels: Record<CloudSyncStatus, string> = {
  local: "로컬 모드",
  signed_out: "로그아웃",
  syncing: "동기화 중",
  synced: "동기화 완료",
  offline: "오프라인",
  conflict: "충돌 있음",
  error: "동기화 실패"
};

const chartColors = ["#0f766e", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#4d7c0f", "#be123c"];

const Section = ({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) => (
  <section className="panel">
    <div className="mb-4 flex items-center gap-2">
      {icon}
      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
    </div>
    {children}
  </section>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="grid gap-1">
    <span className="label">{label}</span>
    {children}
  </label>
);

const MultiSelectField = ({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
}) => (
  <Field label={label}>
    <select
      className="field min-h-28"
      multiple
      value={value}
      onChange={(event) =>
        onChange(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))
      }
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  </Field>
);

const inputNumber = (value: string) => Number(value || 0);

const displayDateTime = (value?: string) => value?.slice(0, 16).replace("T", " ") || "데이터 부족";

const sourceLabel = (source?: string) => (source === "api" ? "자동" : source === "manual" ? "수동" : "데이터 부족");

const latestPriceBasis = (assets: Asset[]) => {
  const dated = assets
    .filter((asset) => asset.priceUpdatedAt)
    .sort((a, b) => new Date(b.priceUpdatedAt || "").getTime() - new Date(a.priceUpdatedAt || "").getTime());
  const latest = dated[0];
  return latest ? `${displayDateTime(latest.priceUpdatedAt)} / ${sourceLabel(latest.priceSource)}` : "데이터 부족";
};

const latestFxBasis = (assets: Asset[]) => {
  const dated = assets
    .filter((asset) => asset.currency === "USD" && asset.currentFxRate > 0 && asset.priceUpdatedAt)
    .sort((a, b) => new Date(b.priceUpdatedAt || "").getTime() - new Date(a.priceUpdatedAt || "").getTime());
  const latest = dated[0];
  return latest ? `${displayDateTime(latest.priceUpdatedAt)} / ${sourceLabel(latest.priceSource)}` : "원화 종목만 있거나 데이터 부족";
};

const missingPriceCount = (state: AppState, positions: ReturnType<typeof calculatePositions>) =>
  positions.filter((position) => {
    if (position.quantity <= 0) return false;
    const asset = state.assets.find((item) => item.id === position.assetId);
    return !asset || asset.currentPrice <= 0 || (asset.currency === "USD" && asset.currentFxRate <= 0);
  }).length;

const isUsMarket = (market: Market) => market === "US" || market === "ETF_US";

const defaultCurrencyForMarket = (market: Market): Currency => (isUsMarket(market) ? "USD" : "KRW");

const defaultAssetClassForMarket = (market: Market): AssetClass =>
  market === "ETF_KR" || market === "ETF_US" ? "etf" : "stock";

const defaultBenchmarkForMarket = (market: Market) =>
  market === "US" ? "S&P500" : market === "ETF_US" ? "NASDAQ100" : "KOSPI200";

const buildAssetFromTrade = ({
  name,
  market,
  currentPrice,
  fxRate
}: {
  name: string;
  market: Market;
  currentPrice: number;
  fxRate: number;
}): Asset => {
  const trimmedName = name.trim();
  const symbol = trimmedName.toUpperCase();
  const currency = defaultCurrencyForMarket(market);
  return {
    id: createId("asset"),
    name: trimmedName,
    ticker: symbol,
    market,
    assetClass: defaultAssetClassForMarket(market),
    sector: "",
    themes: [],
    country: isUsMarket(market) ? "US" : "KR",
    currency,
    benchmark: defaultBenchmarkForMarket(market),
    currentPrice,
    currentFxRate: currency === "KRW" ? 1 : fxRate || 1,
    priceProvider: isUsMarket(market) ? "twelve_data" : "manual",
    providerSymbol: symbol,
    priceSource: "manual",
    priceUpdatedAt: new Date().toISOString(),
    priceUpdateError: undefined,
    isLeveraged: false,
    isGrowth: false,
    createdAt: new Date().toISOString()
  };
};

function App() {
  const [state, setState] = useState<AppState>(() => createEmptyState());
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [moreSection, setMoreSection] = useState<MoreSectionKey | null>(null);
  const [notice, setNotice] = useState("");
  const [priceRefreshing, setPriceRefreshing] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [syncStatus, setSyncStatus] = useState<CloudSyncStatus>(navigator.onLine ? "signed_out" : "offline");
  const [syncMessage, setSyncMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestStateRef = useRef(state);
  const applyingCloudRef = useRef(false);
  const autoSyncedUidRef = useRef("");
  const redirectHandledRef = useRef(false);

  useEffect(() => {
    loadState()
      .then((stored) => {
        setState(stored);
        document.documentElement.classList.toggle("dark", stored.settings.darkMode);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => listenToFirebaseUser(setFirebaseUser), []);

  useEffect(() => {
    const online = () => {
      setSyncStatus(firebaseUser ? "syncing" : "signed_out");
      if (firebaseUser) void syncWithCloud("merge");
    };
    const offline = () => setSyncStatus("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [firebaseUser]);

  useEffect(() => {
    if (!ready || !firebaseUser || autoSyncedUidRef.current === firebaseUser.uid) return;
    autoSyncedUidRef.current = firebaseUser.uid;
    if (latestStateRef.current.settings.cloudSync.enabled) {
      void syncWithCloud("merge", firebaseUser);
    } else {
      void chooseAndSyncAfterLogin(firebaseUser);
    }
  }, [ready, firebaseUser]);

  useEffect(() => {
    if (!ready || redirectHandledRef.current) return;
    redirectHandledRef.current = true;
    handleRedirectLoginResult()
      .then((user) => {
        if (!user || autoSyncedUidRef.current === user.uid) return;
        setFirebaseUser(user);
        autoSyncedUidRef.current = user.uid;
        void chooseAndSyncAfterLogin(user);
      })
      .catch((error) => {
        setSyncStatus("error");
        setNotice(getFirebaseAuthErrorMessage(error));
      });
  }, [ready]);

  useEffect(() => {
    if (!ready || !firebaseUser) return;
    const timer = window.setInterval(() => {
      if (navigator.onLine && !applyingCloudRef.current) void syncWithCloud("merge", firebaseUser);
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready, firebaseUser]);

  const persist = async (next: AppState, message?: string) => {
    const saved = await saveState({
      ...next,
      settings: {
        ...next.settings,
        cloudSync: {
          ...next.settings.cloudSync,
          enabled: Boolean(firebaseUser) || next.settings.cloudSync.enabled
        }
      }
    });
    setState(saved);
    latestStateRef.current = saved;
    document.documentElement.classList.toggle("dark", saved.settings.darkMode);
    if (message) setNotice(message);
    if (firebaseUser && !applyingCloudRef.current) {
      void uploadCurrentState(firebaseUser, saved);
    }
  };

  const updateState = (producer: (current: AppState) => AppState, message?: string) => {
    void persist(producer(state), message);
  };

  const uploadCurrentState = async (user: User, snapshot = latestStateRef.current) => {
    if (!navigator.onLine) {
      setSyncStatus("offline");
      return;
    }
    const firebase = getFirebaseServices();
    if (!firebase) {
      setSyncStatus("local");
      setSyncMessage("Firebase 설정이 없어 로컬 모드로 동작합니다.");
      return;
    }
    try {
      setSyncStatus("syncing");
      await uploadStateToCloud(firebase.db, user.uid, snapshot);
      const synced = {
        ...snapshot,
        settings: {
          ...snapshot.settings,
          cloudSync: {
            enabled: true,
            lastSyncedAt: new Date().toISOString()
          }
        }
      };
      const saved = await saveState(synced);
      setState(saved);
      latestStateRef.current = saved;
      setSyncStatus("synced");
      setSyncMessage("동기화 완료");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(error instanceof Error ? error.message : "동기화 실패");
    }
  };

  const syncWithCloud = async (mode: "upload" | "download" | "merge", user = firebaseUser) => {
    if (!user) return;
    if (!navigator.onLine) {
      setSyncStatus("offline");
      return;
    }
    const firebase = getFirebaseServices();
    if (!firebase) {
      setSyncStatus("local");
      setSyncMessage("Firebase 설정이 없어 로컬 모드로 동작합니다.");
      return;
    }
    setSyncStatus("syncing");
    applyingCloudRef.current = true;
    try {
      const current = latestStateRef.current;
      if (mode === "upload") {
        await uploadStateToCloud(firebase.db, user.uid, current);
        await persist({
          ...current,
          settings: {
            ...current.settings,
            cloudSync: { enabled: true, lastSyncedAt: new Date().toISOString() }
          }
        });
      } else {
        const next = mode === "download"
          ? await downloadCloudState(firebase.db, user.uid, current)
          : await mergeLocalAndCloud(firebase.db, user.uid, current);
        await persist(next);
      }
      setSyncStatus("synced");
      setSyncMessage("동기화 완료");
    } catch (error) {
      setSyncStatus("error");
      setSyncMessage(error instanceof Error ? error.message : "동기화 실패");
    } finally {
      applyingCloudRef.current = false;
    }
  };

  const chooseAndSyncAfterLogin = async (user: User) => {
    const firebase = getFirebaseServices();
    if (!firebase) return;
    const local = latestStateRef.current;
    const cloud = await downloadCloudState(firebase.db, user.uid, local);
    const localHasData = hasUserData(local);
    const cloudHasData = hasUserData(cloud);
    let mode: "upload" | "download" | "merge" = "merge";
    if (localHasData && !cloudHasData) {
      mode = "upload";
    } else if (!localHasData && cloudHasData) {
      mode = "download";
    }
    await syncWithCloud(mode, user);
  };

  const connectFirebase = async () => {
    if (!isFirebaseConfigured()) {
      setNotice("Firebase 설정이 없습니다. .env에 Firebase 웹 앱 설정을 먼저 입력하세요.");
      return;
    }
    try {
      setNotice("");
      setSyncMessage("");
      setSyncStatus("syncing");
      const user = await signInWithGoogle();
      if (user) await chooseAndSyncAfterLogin(user);
      else setSyncMessage("팝업이 차단되어 전체 화면 로그인으로 전환합니다.");
    } catch (error) {
      setSyncStatus("error");
      setNotice(getFirebaseAuthErrorMessage(error));
    }
  };

  const disconnectFirebase = async () => {
    await signOutFirebase();
    setFirebaseUser(null);
    setSyncStatus("signed_out");
    setSyncMessage("로그아웃했습니다. 로컬 모드는 계속 사용할 수 있습니다.");
  };

  const refreshPrices = async (manual = false) => {
    if (priceRefreshing) return;
    setPriceRefreshing(true);
    try {
      const result = await refreshApiPrices(latestStateRef.current);
      await persist(result.state, manual ? result.message : undefined);
      latestStateRef.current = result.state;
    } catch (error) {
      const message = error instanceof Error ? error.message : "가격 업데이트에 실패했습니다.";
      await persist(
        {
          ...latestStateRef.current,
          settings: {
            ...latestStateRef.current.settings,
            lastPriceRefreshAt: new Date().toISOString(),
            lastPriceRefreshError: message
          }
        },
        manual ? message : undefined
      );
    } finally {
      setPriceRefreshing(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    void refreshPrices(false);
    const timer = window.setInterval(() => void refreshPrices(false), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready]);

  const positions = useMemo(() => calculatePositions(state), [state]);
  const metrics = useMemo(() => calculateMetrics(state, positions), [state, positions]);
  const warnings = useMemo(() => buildWarnings(state, positions), [state, positions]);

  const openTab = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab !== "more") setMoreSection(null);
  };

  const openMoreSection = (section: MoreSectionKey) => {
    setActiveTab("more");
    setMoreSection(section);
  };

  const openInitialHolding = () => {
    setActiveTab("trades");
    setMoreSection(null);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("investment-journal:initial-holding"));
    }, 0);
  };

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="flex items-center gap-3 text-sm">
          <RefreshCw className="h-5 w-5 animate-spin" />
          데이터를 불러오는 중
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-teal-700 dark:text-teal-400">
              로컬 우선 매매일지
            </p>
            <h1 className="text-xl font-black text-slate-950 dark:text-white">My Investment Journal</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden text-right text-xs text-slate-500 dark:text-slate-400 sm:block">
              <p className="font-semibold text-slate-700 dark:text-slate-200">{firebaseUser?.email ?? "로컬 사용자"}</p>
              <p>{syncStatusLabels[syncStatus]}</p>
            </div>
            {firebaseUser ? (
              <button className="secondary-button" type="button" onClick={() => void disconnectFirebase()}>
                <Cloud className="h-4 w-4" />
                로그아웃
              </button>
            ) : (
              <button className="secondary-button" type="button" onClick={() => void connectFirebase()}>
                <Cloud className="h-4 w-4" />
                Google 로그인
              </button>
            )}
            <button
              className="secondary-button h-10 w-10 px-0"
              type="button"
              title={state.settings.darkMode ? "밝은 모드" : "어두운 모드"}
              onClick={() =>
                updateState(
                  (current) => ({
                    ...current,
                    settings: { ...current.settings, darkMode: !current.settings.darkMode }
                  }),
                  state.settings.darkMode ? "밝은 모드로 전환했습니다." : "어두운 모드로 전환했습니다."
                )
              }
            >
              {state.settings.darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 pb-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition ${
                activeTab === tab.key
                  ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              type="button"
              onClick={() => openTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-5">
        {notice && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-100">
            <span>{notice}</span>
            <button className="font-semibold" type="button" onClick={() => setNotice("")}>
              닫기
            </button>
          </div>
        )}
        {activeTab === "dashboard" && (
          <Dashboard
            state={state}
            positions={positions}
            metrics={metrics}
            warnings={warnings}
            priceRefreshing={priceRefreshing}
            onRefreshPrices={() => void refreshPrices(true)}
            onOpenTab={openTab}
            onOpenBackup={() => openMoreSection("backup")}
            onInitialHolding={openInitialHolding}
          />
        )}
        {activeTab === "manage" && <Manage state={state} updateState={updateState} />}
        {activeTab === "trades" && <Trades state={state} updateState={updateState} />}
        {activeTab === "holdings" && (
          <Holdings
            state={state}
            updateState={updateState}
            positions={positions}
            metrics={metrics}
            onInitialHolding={openInitialHolding}
          />
        )}
        {activeTab === "thesis" && <ThesisManager state={state} updateState={updateState} />}
        {activeTab === "checklist" && <ChecklistView state={state} updateState={updateState} />}
        {activeTab === "swap" && <SwapView state={state} updateState={updateState} />}
        {activeTab === "review" && <MonthlyReviewView state={state} updateState={updateState} metrics={metrics} />}
        {activeTab === "backup" && (
          <BackupView
            state={state}
            persist={persist}
            fileInputRef={fileInputRef}
            firebaseUser={firebaseUser}
            syncStatus={syncStatus}
            syncMessage={syncMessage}
          />
        )}
        {activeTab === "more" && (
          <MoreView
            section={moreSection}
            setSection={setMoreSection}
            state={state}
            updateState={updateState}
            metrics={metrics}
            persist={persist}
            fileInputRef={fileInputRef}
            firebaseUser={firebaseUser}
            syncStatus={syncStatus}
            syncMessage={syncMessage}
          />
        )}
      </main>
    </div>
  );
}

function Dashboard({
  state,
  positions,
  metrics,
  warnings,
  priceRefreshing,
  onRefreshPrices,
  onOpenTab,
  onOpenBackup,
  onInitialHolding
}: {
  state: AppState;
  positions: ReturnType<typeof calculatePositions>;
  metrics: ReturnType<typeof calculateMetrics>;
  warnings: ReturnType<typeof buildWarnings>;
  priceRefreshing: boolean;
  onRefreshPrices: () => void;
  onOpenTab: (tab: TabKey) => void;
  onOpenBackup: () => void;
  onInitialHolding: () => void;
}) {
  const [accountScope, setAccountScope] = useState<AccountType | "all">("all");
  const scopedPositions =
    accountScope === "all"
      ? positions
      : positions.filter((position) =>
          state.accounts.some((account) => account.id === position.accountId && account.type === accountScope)
        );
  const scopedMetrics = accountScope === "all" ? metrics : calculateScopedMetrics(state, scopedPositions);
  const accountData = groupPositions(state, positions, "account");
  const sectorData = groupPositions(state, scopedPositions, "sector");
  const themeData = groupPositions(state, scopedPositions, "theme");
  const marketData = groupExposure(state, scopedPositions, "market");
  const currencyData = groupExposure(state, scopedPositions, "currency");
  const assetData = aggregateAssetPositions(state, scopedPositions).slice(0, 10);
  const activePositions = scopedPositions.filter((position) => position.quantity > 0);
  const biggestLosers = [...activePositions].sort((a, b) => a.unrealizedReturnRate - b.unrealizedReturnRate).slice(0, 5);
  const contributors = [...activePositions].sort((a, b) => b.unrealizedPnlKrw - a.unrealizedPnlKrw).slice(0, 5);
  const dataGapCount = missingPriceCount(state, positions);
  const hasCostBasis = scopedMetrics.totalInvested > 0;
  const hasPortfolioData = positions.some((position) => position.quantity > 0) || state.trades.length > 0;
  const accountTabs: Array<{ key: AccountType | "all"; label: string }> = [
    { key: "all", label: "전체" },
    { key: "taxable", label: "일반계좌" },
    { key: "isa", label: "ISA" },
    { key: "pension", label: "연금저축" },
    { key: "dc", label: "DC" }
  ];

  return (
    <div className="grid gap-4">
      <div className="panel flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="label">현재가 기준시점</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
            <Clock3 className="h-4 w-4 text-teal-700" />
            {latestPriceBasis(state.assets)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">환율 기준: {latestFxBasis(state.assets)}</p>
          {state.settings.lastPriceRefreshError && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{state.settings.lastPriceRefreshError}</p>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <button className="primary-button" type="button" onClick={() => onOpenTab("trades")}><Plus className="h-4 w-4" />매매 입력</button>
          <button className="secondary-button" type="button" onClick={() => onOpenTab("holdings")}>보유 보기</button>
          <button className="secondary-button" type="button" onClick={() => onOpenTab("checklist")}>매수점검</button>
          <button className="secondary-button" type="button" onClick={onInitialHolding}>초기보유 입력</button>
          <button className="secondary-button" type="button" onClick={onRefreshPrices} disabled={priceRefreshing}>
            <RefreshCw className={`h-4 w-4 ${priceRefreshing ? "animate-spin" : ""}`} />
            가격 새로고침
          </button>
        </div>
      </div>

      {!hasPortfolioData && (
        <Section title="초기 세팅 안내" icon={<CheckCircle2 className="h-5 w-5 text-teal-700" />}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button className="rounded-md border border-slate-200 bg-white p-4 text-left transition hover:border-teal-500 hover:bg-teal-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500 dark:hover:bg-slate-950" type="button" onClick={onInitialHolding}>
              <p className="font-bold text-slate-950 dark:text-white">초기보유 입력</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">앱 사용 전 이미 갖고 있던 종목을 시작 잔고로 넣습니다.</p>
            </button>
            <button className="rounded-md border border-slate-200 bg-white p-4 text-left transition hover:border-teal-500 hover:bg-teal-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500 dark:hover:bg-slate-950" type="button" onClick={() => onOpenTab("trades")}>
              <p className="font-bold text-slate-950 dark:text-white">매매 입력</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">앱 사용 후 실제 체결된 매수·매도 기록을 저장합니다.</p>
            </button>
            <button className="rounded-md border border-slate-200 bg-white p-4 text-left transition hover:border-teal-500 hover:bg-teal-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500 dark:hover:bg-slate-950" type="button" onClick={onOpenBackup}>
              <p className="font-bold text-slate-950 dark:text-white">Google 자동 저장 상태</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                상단 Google 로그인 후 같은 계정으로 자동 저장·불러오기를 사용합니다.
              </p>
            </button>
            <button className="rounded-md border border-slate-200 bg-white p-4 text-left transition hover:border-teal-500 hover:bg-teal-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500 dark:hover:bg-slate-950" type="button" onClick={onRefreshPrices} disabled={priceRefreshing}>
              <p className="font-bold text-slate-950 dark:text-white">가격 새로고침</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{state.settings.lastPriceRefreshError ?? "보유 종목이 생기면 자동 가격 갱신을 시도합니다."}</p>
            </button>
          </div>
        </Section>
      )}

      {!hasPortfolioData ? null : (
        <>

      <div className="flex gap-2 overflow-x-auto">
        {accountTabs.map((tab) => (
          <button
            key={tab.key}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold ${
              accountScope === tab.key
                ? "bg-teal-700 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-800"
            }`}
            type="button"
            onClick={() => setAccountScope(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="총 평가금액" value={dataGapCount ? "데이터 부족" : formatKrw(scopedMetrics.totalMarketValue)} />
        <MetricCard label="총 평가손익" value={dataGapCount ? "데이터 부족" : formatKrw(scopedMetrics.unrealizedPnl)} tone={scopedMetrics.unrealizedPnl >= 0 ? "good" : "bad"} />
        <MetricCard label="원가기준 누적수익률" value={hasCostBasis ? formatPercent(scopedMetrics.totalReturnRate) : "—"} tone={scopedMetrics.totalReturnRate >= 0 ? "good" : "bad"} />
        <MetricCard label="실현손익" value={formatKrw(scopedMetrics.realizedPnl)} tone={scopedMetrics.realizedPnl >= 0 ? "good" : "bad"} />
        <MetricCard label="평가손익" value={dataGapCount ? "데이터 부족" : formatKrw(scopedMetrics.unrealizedPnl)} tone={scopedMetrics.unrealizedPnl >= 0 ? "good" : "bad"} />
        <MetricCard label="데이터 부족 종목" value={`${dataGapCount}개`} tone={dataGapCount ? "warn" : "good"} />
        <MetricCard label="현재가 기준시점" value={latestPriceBasis(state.assets)} />
        <MetricCard label="환율 기준시점" value={latestFxBasis(state.assets)} />
        <MetricCard label="현금 비중" value={formatPercent(scopedMetrics.cashWeight)} />
        <MetricCard label="최근 30일 매매" value={`${scopedMetrics.recent30DayTradeCount}회`} />
        <MetricCard label="이번 달 감정 매매" value={`${scopedMetrics.monthlyEmotionalTradeCount}회`} tone={scopedMetrics.monthlyEmotionalTradeCount ? "warn" : "good"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Section title="계좌별 평가금액" icon={<BarChart3 className="h-5 w-5 text-teal-700" />}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={accountData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(value) => `${Math.round(Number(value) / 10000)}만`} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => formatKrw(Number(value))} />
                <Bar dataKey="value" name="평가금액" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
        <Section title="종목별 비중 TOP 10">
          <div className="grid gap-2">
            {assetData.map((item) => (
              <WeightRow key={item.assetId} label={item.asset?.name ?? "미등록 종목"} value={item.marketValueKrw} total={scopedMetrics.totalMarketValue} />
            ))}
            {!assetData.length && <EmptyText text="보유 포지션이 아직 없습니다." />}
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PiePanel title="섹터별 비중" data={sectorData} />
        <PiePanel title="테마별 비중" data={themeData} />
        <PiePanel title="국내/해외 비중" data={marketData} />
        <PiePanel title="원화/달러 노출" data={currencyData} />
      </div>

      <Section title={accountScope === "all" ? "전체 보유종목" : `${accountTabs.find((tab) => tab.key === accountScope)?.label} 보유종목`}>
        <AccountPositionTable state={state} positions={scopedPositions} totalValue={scopedMetrics.totalMarketValue} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="손실률 큰 종목">
          <PositionMiniList positions={biggestLosers} state={state} mode="return" />
        </Section>
        <Section title="수익 기여도 큰 종목">
          <PositionMiniList positions={contributors} state={state} mode="pnl" />
        </Section>
        <Section title="자동 경고" icon={<ShieldAlert className="h-5 w-5 text-amber-600" />}>
          <div className="grid gap-2">
            {warnings.slice(0, 8).map((warning) => (
              <div
                key={warning.id}
                className={`rounded-md border px-3 py-2 text-sm ${
                  warning.severity === "high"
                    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
                    : warning.severity === "medium"
                      ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
                      : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                }`}
              >
                <p className="font-semibold">{warning.title}</p>
                <p className="mt-1 text-xs opacity-80">{warning.detail}</p>
              </div>
            ))}
            {!warnings.length && <EmptyText text="현재 표시할 경고가 없습니다." />}
          </div>
        </Section>
      </div>
        </>
      )}
    </div>
  );
}

const MetricCard = ({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" | "warn" }) => (
  <div className="panel">
    <p className="label">{label}</p>
    <p
      className={`mt-2 break-words text-lg font-black ${
        tone === "good"
          ? "text-teal-700 dark:text-teal-300"
          : tone === "bad"
            ? "text-red-600 dark:text-red-300"
            : tone === "warn"
              ? "text-amber-700 dark:text-amber-300"
              : "text-slate-950 dark:text-white"
      }`}
    >
      {value}
    </p>
  </div>
);

const WeightRow = ({ label, value, total }: { label: string; value: number; total: number }) => (
  <div className="grid gap-1">
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="font-semibold">{label}</span>
      <span className="text-slate-500 dark:text-slate-400">{total > 0 ? formatPercent((value / total) * 100) : "—"}</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.min(total > 0 ? (value / total) * 100 : 0, 100)}%` }} />
    </div>
  </div>
);

const PiePanel = ({ title, data }: { title: string; data: Array<{ name: string; value: number }> }) => (
  <Section title={title}>
    <div className="h-72">
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
              {data.map((item, index) => (
                <Cell key={item.name} fill={chartColors[index % chartColors.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => formatKrw(Number(value))} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <EmptyText text="차트로 표시할 데이터가 없습니다." />
      )}
    </div>
  </Section>
);

const PositionMiniList = ({
  positions,
  state,
  mode
}: {
  positions: ReturnType<typeof calculatePositions>;
  state: AppState;
  mode: "return" | "pnl";
}) => (
  <div className="grid gap-2">
    {positions.map((position) => (
      <div key={position.key} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
        <span className="font-semibold">{assetName(state.assets, position.assetId)}</span>
        <span className={position.unrealizedPnlKrw >= 0 ? "text-teal-700 dark:text-teal-300" : "text-red-600 dark:text-red-300"}>
          {mode === "return" ? formatPercent(position.unrealizedReturnRate) : formatKrw(position.unrealizedPnlKrw)}
        </span>
      </div>
    ))}
    {!positions.length && <EmptyText text="표시할 포지션이 없습니다." />}
  </div>
);

const formatPlanPrice = (value?: number, currency?: Currency) => {
  if (!value || value <= 0) return "—";
  return currency === "USD" ? `$${formatNumber(value, 2)}` : formatKrw(value);
};

const AccountPositionTable = ({
  state,
  positions,
  totalValue
}: {
  state: AppState;
  positions: ReturnType<typeof calculatePositions>;
  totalValue: number;
}) => {
  const active = positions.filter((position) => position.quantity > 0);
  if (!active.length) return <EmptyText text="해당 계좌 범위에 보유 종목이 없습니다." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1320px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800">
            {[
              "계좌",
              "종목",
              "수량",
              "평균단가",
              "현재가",
              "평가금액",
              "평가손익",
              "수익률",
              "비중",
              "목표가",
              "매도검토가",
              "손절가",
              "추가매수 가능가",
              "투자등급",
              "다음 점검일"
            ].map((header) => (
              <th key={header} className="px-3 py-2 font-bold">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map((position) => {
            const asset = state.assets.find((item) => item.id === position.assetId);
            const thesis = state.theses.find((item) => item.assetId === position.assetId);
            const needsReview = Boolean(thesis?.invalidationPrice && asset?.currentPrice && asset.currentPrice < thesis.invalidationPrice);
            const hasPriceData = Boolean(asset && asset.currentPrice > 0 && (asset.currency === "KRW" || asset.currentFxRate > 0));
            const hasCostData = position.averageCostKrw > 0;
            return (
              <tr key={position.key} className="border-b border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">{accountName(state.accounts, position.accountId)}</td>
                <td className="px-3 py-2">
                  <p className="font-semibold">{asset?.name ?? "미등록 종목"}</p>
                  <p className="text-xs text-slate-500">{asset?.market}</p>
                  {needsReview && <p className="mt-1 inline-flex rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">점검 필요</p>}
                </td>
                <td className="px-3 py-2">{formatNumber(position.quantity, 4)}</td>
                <td className="px-3 py-2">{hasCostData ? formatKrw(position.averageCostKrw) : "—"}</td>
                <td className="px-3 py-2">
                  <p>{hasPriceData ? (asset?.currency === "USD" ? `$${formatNumber(position.currentPrice, 2)}` : formatKrw(position.currentPrice)) : "데이터 부족"}</p>
                  <p className={`text-xs ${asset?.priceUpdateError ? "text-amber-700 dark:text-amber-300" : "text-slate-500"}`}>
                    {asset?.priceSource === "api" ? "자동" : "수동"}
                    {asset?.priceUpdatedAt ? ` · ${asset.priceUpdatedAt.slice(0, 16).replace("T", " ")}` : ""}
                  </p>
                  {asset?.priceUpdateError && <p className="text-xs text-amber-700 dark:text-amber-300">{asset.priceUpdateError}</p>}
                </td>
                <td className="px-3 py-2">{hasPriceData ? formatKrw(position.marketValueKrw) : "데이터 부족"}</td>
                <td className={`px-3 py-2 ${position.unrealizedPnlKrw >= 0 ? "text-teal-700 dark:text-teal-300" : "text-red-600 dark:text-red-300"}`}>
                  {hasPriceData && hasCostData ? formatKrw(position.unrealizedPnlKrw) : "—"}
                </td>
                <td className="px-3 py-2">{hasPriceData && hasCostData ? formatPercent(position.unrealizedReturnRate) : "—"}</td>
                <td className="px-3 py-2">{hasPriceData && totalValue > 0 ? formatPercent((position.marketValueKrw / totalValue) * 100) : "—"}</td>
                <td className="px-3 py-2">{formatPlanPrice(thesis?.targetPrice, asset?.currency)}</td>
                <td className="px-3 py-2">{formatPlanPrice(thesis?.invalidationPrice, asset?.currency)}</td>
                <td className="px-3 py-2">{formatPlanPrice(thesis?.stopLossPrice, asset?.currency)}</td>
                <td className="px-3 py-2">{formatPlanPrice(thesis?.addBuyPrice, asset?.currency)}</td>
                <td className="px-3 py-2">{thesis ? gradeLabels[thesis.grade] : "—"}</td>
                <td className="px-3 py-2">{thesis?.nextReviewAt || thesis?.lastReviewedAt || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

function PriceManualUpdater({ state, updateState }: { state: AppState; updateState: (producer: (current: AppState) => AppState, message?: string) => void }) {
  return (
    <Section title="현재가·환율 입력">
      <div className="mb-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        <p>현재가 기준: {latestPriceBasis(state.assets)}</p>
        <p>환율 기준: {latestFxBasis(state.assets)}</p>
      </div>
      <div className="grid gap-3">
        {state.assets.map((asset) => (
          <div key={asset.id} className="grid gap-2 rounded-md bg-slate-50 p-3 dark:bg-slate-950 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
            <div>
              <p className="font-semibold">{asset.name}</p>
              <p className="text-xs text-slate-500">{asset.currency} · {asset.priceSource === "api" ? "자동 가격" : "수동 가격"}</p>
              {asset.priceUpdateError && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{asset.priceUpdateError}</p>}
            </div>
            <Field label="현재가">
              <input className="field" type="number" value={asset.currentPrice} onChange={(event) => updateState((current) => ({
                ...current,
                assets: current.assets.map((item) => item.id === asset.id ? { ...item, currentPrice: inputNumber(event.target.value), priceSource: "manual", priceUpdateError: undefined, priceUpdatedAt: new Date().toISOString() } : item),
                priceQuotes: [buildManualQuote({ ...asset, currentPrice: inputNumber(event.target.value), priceSource: "manual", priceUpdatedAt: new Date().toISOString() }), ...current.priceQuotes].slice(0, 500)
              }))} />
            </Field>
            <Field label="현재 환율">
              <input className="field" type="number" value={asset.currentFxRate} onChange={(event) => updateState((current) => ({
                ...current,
                assets: current.assets.map((item) => item.id === asset.id ? { ...item, currentFxRate: inputNumber(event.target.value) || 1, priceSource: "manual", priceUpdateError: undefined, priceUpdatedAt: new Date().toISOString() } : item),
                priceQuotes: [buildManualQuote({ ...asset, currentFxRate: inputNumber(event.target.value) || 1, priceSource: "manual", priceUpdatedAt: new Date().toISOString() }), ...current.priceQuotes].slice(0, 500)
              }))} />
            </Field>
            <span className="text-xs text-slate-500">{asset.priceUpdatedAt ? `${asset.priceUpdatedAt.slice(0, 16).replace("T", " ")} / ${sourceLabel(asset.priceSource)}` : "데이터 부족"}</span>
          </div>
        ))}
        {!state.assets.length && <EmptyText text="종목을 먼저 등록하세요." />}
      </div>
    </Section>
  );
}

function Holdings({
  state,
  updateState,
  positions,
  metrics,
  onInitialHolding
}: {
  state: AppState;
  updateState: (producer: (current: AppState) => AppState, message?: string) => void;
  positions: ReturnType<typeof calculatePositions>;
  metrics: ReturnType<typeof calculateMetrics>;
  onInitialHolding: () => void;
}) {
  const [showPlan, setShowPlan] = useState(false);

  return (
    <div className="grid gap-4">
      <div className="panel flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label">보유 관리</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">현재가와 환율을 입력하면 보유 목록의 평가손익이 다시 계산됩니다.</p>
        </div>
        <button className="primary-button" type="button" onClick={onInitialHolding}>
          <Plus className="h-4 w-4" />
          초기보유 입력
        </button>
      </div>
      <PriceManualUpdater state={state} updateState={updateState} />
      <Section title="보유 종목 목록">
        <AccountPositionTable state={state} positions={positions} totalValue={metrics.totalMarketValue} />
      </Section>
      <Section title="보유·대응 기준">
        {!showPlan ? (
          <button className="secondary-button" type="button" onClick={() => setShowPlan(true)}>
            보유·대응 기준 수정
          </button>
        ) : (
          <div className="grid gap-3">
            <button className="secondary-button justify-self-start" type="button" onClick={() => setShowPlan(false)}>
              보유 목록으로 돌아가기
            </button>
            <ThesisManager state={state} updateState={updateState} embedded />
          </div>
        )}
      </Section>
    </div>
  );
}

function Manage({ state, updateState }: { state: AppState; updateState: (producer: (current: AppState) => AppState, message?: string) => void }) {
  const [accountDraft, setAccountDraft] = useState({ name: "", type: "taxable" as AccountType, currency: "KRW" as Currency, memo: "" });
  const [assetDraft, setAssetDraft] = useState({
    name: "",
    market: "KR" as Market,
    assetClass: "stock" as AssetClass,
    sector: "",
    themes: "",
    country: "KR",
    currency: "KRW" as Currency,
    benchmark: "KOSPI200",
    currentPrice: 0,
    currentFxRate: 1,
    isLeveraged: false,
    isGrowth: false
  });

  const addAccount = (event: FormEvent) => {
    event.preventDefault();
    if (!accountDraft.name.trim()) return;
    const account: Account = { ...accountDraft, id: createId("account"), createdAt: new Date().toISOString() };
    updateState((current) => ({ ...current, accounts: [...current.accounts, account] }), "계좌를 추가했습니다.");
    setAccountDraft({ name: "", type: "taxable", currency: "KRW", memo: "" });
  };

  const addAsset = (event: FormEvent) => {
    event.preventDefault();
    if (!assetDraft.name.trim()) return;
    const symbol = assetDraft.name.trim().toUpperCase();
    const asset: Asset = {
      ...assetDraft,
      ticker: symbol,
      id: createId("asset"),
      themes: assetDraft.themes.split(",").map((theme) => theme.trim()).filter(Boolean),
      priceProvider: assetDraft.market === "US" || assetDraft.market === "ETF_US" ? "twelve_data" : "manual",
      providerSymbol: symbol,
      priceSource: "manual",
      priceUpdateError: undefined,
      priceUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    updateState((current) => ({ ...current, assets: [...current.assets, asset] }), "종목을 추가했습니다.");
    setAssetDraft({ ...assetDraft, name: "", sector: "", themes: "", currentPrice: 0 });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="계좌 등록">
        <form className="grid gap-3" onSubmit={addAccount}>
          <Field label="계좌명">
            <input className="field" value={accountDraft.name} onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })} placeholder="예: 일반계좌" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="계좌 유형">
              <select className="field" value={accountDraft.type} onChange={(event) => setAccountDraft({ ...accountDraft, type: event.target.value as AccountType })}>
                {Object.entries(accountTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="기준 통화">
              <select className="field" value={accountDraft.currency} onChange={(event) => setAccountDraft({ ...accountDraft, currency: event.target.value as Currency })}>
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>
          <Field label="메모">
            <input className="field" value={accountDraft.memo} onChange={(event) => setAccountDraft({ ...accountDraft, memo: event.target.value })} placeholder="예: 장기 투자 전용" />
          </Field>
          <button className="primary-button" type="submit"><Plus className="h-4 w-4" />계좌 추가</button>
        </form>
        <div className="mt-4 grid gap-2">
          {state.accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
              <span className="font-semibold">{account.name}</span>
              <span className="text-slate-500">{accountTypeLabels[account.type]} · {account.currency}{account.memo ? ` · ${account.memo}` : ""}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="종목 관리">
        <form className="grid gap-3" onSubmit={addAsset}>
          <div className="grid gap-3">
            <Field label="종목명">
              <input className="field" value={assetDraft.name} onChange={(event) => setAssetDraft({ ...assetDraft, name: event.target.value })} placeholder="예: 삼성전자 또는 AAPL" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="시장">
              <select className="field" value={assetDraft.market} onChange={(event) => {
                const market = event.target.value as Market;
                setAssetDraft({ ...assetDraft, market });
              }}>
                {Object.entries(marketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="자산군">
              <select className="field" value={assetDraft.assetClass} onChange={(event) => setAssetDraft({ ...assetDraft, assetClass: event.target.value as AssetClass })}>
                {Object.entries(assetClassLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="섹터">
              <input className="field" value={assetDraft.sector} onChange={(event) => setAssetDraft({ ...assetDraft, sector: event.target.value })} placeholder="반도체" />
            </Field>
            <Field label="테마">
              <input className="field" value={assetDraft.themes} onChange={(event) => setAssetDraft({ ...assetDraft, themes: event.target.value })} placeholder="AI, 배당" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="국가">
              <input className="field" value={assetDraft.country} onChange={(event) => setAssetDraft({ ...assetDraft, country: event.target.value })} />
            </Field>
            <Field label="통화">
              <select className="field" value={assetDraft.currency} onChange={(event) => setAssetDraft({ ...assetDraft, currency: event.target.value as Currency, currentFxRate: event.target.value === "KRW" ? 1 : assetDraft.currentFxRate })}>
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>
          <Field label="벤치마크">
            <input className="field" value={assetDraft.benchmark} onChange={(event) => setAssetDraft({ ...assetDraft, benchmark: event.target.value })} placeholder="S&P500" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="현재가">
              <input className="field" type="number" value={assetDraft.currentPrice} onChange={(event) => setAssetDraft({ ...assetDraft, currentPrice: inputNumber(event.target.value) })} />
            </Field>
            <Field label="현재 환율">
              <input className="field" type="number" value={assetDraft.currentFxRate} onChange={(event) => setAssetDraft({ ...assetDraft, currentFxRate: inputNumber(event.target.value) || 1 })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={assetDraft.isGrowth} onChange={(event) => setAssetDraft({ ...assetDraft, isGrowth: event.target.checked })} />성장주</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={assetDraft.isLeveraged} onChange={(event) => setAssetDraft({ ...assetDraft, isLeveraged: event.target.checked })} />레버리지 ETF</label>
          </div>
          <button className="primary-button" type="submit"><Plus className="h-4 w-4" />종목 추가</button>
        </form>
      </Section>

      <Section title="등록 종목">
        <div className="grid gap-2">
          {state.assets.map((asset) => (
            <div key={asset.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{asset.name}</span>
                <span className="text-slate-500">{asset.currency}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{marketLabels[asset.market]} · {asset.sector || "섹터 미입력"} · {asset.themes.join(", ") || "테마 미입력"}</p>
              <p className="mt-1 text-xs text-slate-500">가격: {asset.market === "US" || asset.market === "ETF_US" ? "Twelve Data 자동 시도" : "수동 입력"} · 현재 {asset.priceSource === "api" ? "자동" : "수동"}</p>
            </div>
          ))}
          {!state.assets.length && <EmptyText text="등록된 종목이 없습니다." />}
        </div>
      </Section>
    </div>
  );
}

function Trades({ state, updateState }: { state: AppState; updateState: (producer: (current: AppState) => AppState, message?: string) => void }) {
  const [showOptional, setShowOptional] = useState(false);
  const [draft, setDraft] = useState({
    date: today(),
    accountId: state.accounts[0]?.id ?? "",
    assetId: state.assets[0]?.id ?? "",
    assetName: state.assets[0]?.name ?? "",
    market: state.assets[0]?.market ?? "KR" as Market,
    side: "buy" as TradeSide,
    kind: "new" as TradeKind,
    quantity: 0,
    price: 0,
    foreignFee: 0,
    fee: 0,
    tax: 0,
    fxRate: 1,
    horizon: "3m" as Horizon,
    emotion: "planned" as Emotion,
    memo: ""
  });

  useEffect(() => {
    const handler = () => {
      setDraft((current) => ({ ...current, side: "buy", kind: "initial_holding", date: today() }));
      setShowOptional(true);
    };
    window.addEventListener("investment-journal:initial-holding", handler);
    return () => window.removeEventListener("investment-journal:initial-holding", handler);
  }, []);

  useEffect(() => {
    const firstAsset = state.assets[0];
    setDraft((current) => ({
      ...current,
      accountId: current.accountId || state.accounts[0]?.id || "",
      assetId: current.assetId || firstAsset?.id || "",
      assetName: current.assetName || firstAsset?.name || "",
      market: current.market || firstAsset?.market || "KR"
    }));
  }, [state.accounts, state.assets]);

  const addTrade = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.accountId || !draft.assetName.trim() || draft.quantity <= 0 || draft.price <= 0) return;
    const matchedAsset =
      state.assets.find((item) => item.id === draft.assetId) ??
      state.assets.find((item) => item.name.trim().toLowerCase() === draft.assetName.trim().toLowerCase());
    const newAsset = matchedAsset
      ? null
      : buildAssetFromTrade({
          name: draft.assetName,
          market: draft.market,
          currentPrice: draft.price,
          fxRate: draft.fxRate
        });
    const asset = matchedAsset ?? newAsset!;
    const fxRate = draft.fxRate || (asset.currency === "KRW" ? 1 : asset.currentFxRate || 1);
    const feeBase = draft.fee + (draft.foreignFee ? draft.foreignFee * fxRate : 0);
    const totalAmountKrw = draft.quantity * draft.price * fxRate + feeBase + draft.tax;
    const trade: Trade = {
      date: draft.date,
      accountId: draft.accountId,
      assetId: asset.id,
      side: draft.side,
      kind: draft.kind,
      quantity: draft.quantity,
      price: draft.price,
      fee: feeBase,
      tax: draft.tax,
      fxRate,
      totalAmountKrw,
      assetNameSnapshot: asset.name,
      tickerSnapshot: asset.ticker,
      marketSnapshot: asset.market,
      reason: "",
      invalidation: "",
      horizon: draft.horizon,
      emotion: draft.emotion,
      thesisSnapshot: "",
      riskMemo: "",
      reviewMemo: "",
      memo: draft.memo,
      id: createId("trade"),
      createdAt: new Date().toISOString()
    };
    updateState(
      (current) => ({
        ...current,
        assets: newAsset ? [...current.assets, newAsset] : current.assets,
        trades: [...current.trades, trade]
      }),
      newAsset ? "새 종목을 등록하고 체결 기록을 저장했습니다." : "체결 기록을 저장했습니다."
    );
    setDraft({ ...draft, quantity: 0, price: 0, foreignFee: 0, fee: 0, tax: 0, memo: "" });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <Section title={draft.kind === "initial_holding" ? "초기보유 입력" : "매매 입력"}>
        <form className="grid gap-3" onSubmit={addTrade}>
          <button className="secondary-button justify-self-start" type="button" onClick={() => setDraft({ ...draft, side: "buy", kind: "initial_holding" })}>
            <Plus className="h-4 w-4" />
            초기보유 입력
          </button>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
            {draft.kind === "initial_holding"
              ? "초기보유는 앱 사용 전 이미 보유한 종목의 시작 수량과 원가를 넣는 용도입니다."
              : "매매입력은 앱 사용 후 실제 체결된 매수·매도 기록을 저장하는 용도입니다."}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="날짜"><input className="field" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field>
            <Field label="계좌">
              <select className="field" value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
                {state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="종목">
            <input
              className="field"
              list="trade-asset-list"
              value={draft.assetName}
              onChange={(event) => {
                const assetNameValue = event.target.value;
                const asset = state.assets.find((item) => item.name.trim().toLowerCase() === assetNameValue.trim().toLowerCase());
                setDraft({
                  ...draft,
                  assetName: assetNameValue,
                  assetId: asset?.id ?? "",
                  market: asset?.market ?? draft.market,
                  fxRate: asset?.currentFxRate ?? draft.fxRate
                });
              }}
              placeholder="예: 삼성전자 또는 AAPL"
            />
            <datalist id="trade-asset-list">
              {state.assets.map((asset) => <option key={asset.id} value={asset.name} />)}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="구분">
              <select className="field" value={draft.side} onChange={(event) => setDraft({ ...draft, side: event.target.value as TradeSide })}>
                {Object.entries(sideLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="목적">
              <select className="field" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as TradeKind })}>
                {Object.entries(tradeKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="수량"><input className="field" type="number" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: inputNumber(event.target.value) })} /></Field>
            <Field label="단가"><input className="field" type="number" value={draft.price} onChange={(event) => setDraft({ ...draft, price: inputNumber(event.target.value) })} /></Field>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
            총 거래금액: {formatKrw(draft.quantity * draft.price * (draft.fxRate || 1) + draft.fee + draft.foreignFee * (draft.fxRate || 1) + draft.tax)}
          </div>
          <div className="grid gap-3">
            <button className="secondary-button justify-self-start" type="button" onClick={() => setShowOptional((value) => !value)}>
              {showOptional ? "선택 입력 접기" : "선택 입력 펼치기"}
            </button>
            {showOptional && (
              <div className="grid gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-2">
                <Field label="시장">
                  <select
                    className="field"
                    value={draft.market}
                    onChange={(event) => {
                      const market = event.target.value as Market;
                      setDraft({ ...draft, market, fxRate: isUsMarket(market) ? draft.fxRate : 1 });
                    }}
                  >
                    {Object.entries(marketLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="외화 수수료"><input className="field" type="number" value={draft.foreignFee} onChange={(event) => setDraft({ ...draft, foreignFee: inputNumber(event.target.value) })} placeholder="모르면 0" /></Field>
                <Field label="원화 수수료"><input className="field" type="number" value={draft.fee} onChange={(event) => setDraft({ ...draft, fee: inputNumber(event.target.value) })} placeholder="모르면 0" /></Field>
                <Field label="원화 세금"><input className="field" type="number" value={draft.tax} onChange={(event) => setDraft({ ...draft, tax: inputNumber(event.target.value) })} placeholder="모르면 0" /></Field>
                <Field label="거래 환율"><input className="field" type="number" value={draft.fxRate} onChange={(event) => setDraft({ ...draft, fxRate: inputNumber(event.target.value) || 1 })} /></Field>
                <Field label="메모"><textarea className="field min-h-20" value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} /></Field>
              </div>
            )}
          </div>
          <button className="primary-button" type="submit">
            <Save className="h-4 w-4" />
            {draft.kind === "initial_holding" ? "초기보유 저장" : "매매 저장"}
          </button>
        </form>
      </Section>
      <Section title="매매 기록">
        <TradeTable state={state} />
      </Section>
    </div>
  );
}

function TradeTable({ state }: { state: AppState }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }]);
  const [accountFilter, setAccountFilter] = useState<AccountType | "all">("all");
  const rows = useMemo(
    () =>
      state.trades
        .filter((trade) => {
          if (accountFilter === "all") return true;
          return state.accounts.some((account) => account.id === trade.accountId && account.type === accountFilter);
        })
        .map((trade) => ({
          ...trade,
          account: accountName(state.accounts, trade.accountId),
          asset: trade.assetNameSnapshot || assetName(state.assets, trade.assetId),
          market: trade.marketSnapshot || state.assets.find((asset) => asset.id === trade.assetId)?.market || "KR",
          amount: trade.totalAmountKrw || trade.quantity * trade.price * trade.fxRate + trade.fee + trade.tax
        })),
    [state, accountFilter]
  );
  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(
    () => [
      { accessorKey: "date", header: "날짜" },
      { accessorKey: "account", header: "계좌" },
      { accessorKey: "asset", header: "종목" },
      { accessorKey: "market", header: "시장" },
      { accessorFn: (row) => sideLabels[row.side], id: "side", header: "구분" },
      { accessorFn: (row) => tradeKindLabels[row.kind], id: "kind", header: "목적" },
      { accessorKey: "quantity", header: "수량" },
      { accessorKey: "price", header: "단가" },
      { accessorFn: (row) => formatKrw(row.amount), id: "amount", header: "총 거래금액" },
      { accessorKey: "memo", header: "메모" }
    ],
    []
  );
  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  const filters: Array<{ key: AccountType | "all"; label: string }> = [
    { key: "all", label: "전체" },
    { key: "taxable", label: "일반계좌" },
    { key: "isa", label: "ISA" },
    { key: "pension", label: "연금저축" },
    { key: "dc", label: "DC" }
  ];

  return (
    <div className="grid gap-3">
      <div className="flex gap-2 overflow-x-auto">
        {filters.map((filter) => (
          <button
            key={filter.key}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold ${
              accountFilter === filter.key
                ? "bg-teal-700 text-white"
                : "bg-slate-100 text-slate-700 dark:bg-slate-950 dark:text-slate-200"
            }`}
            type="button"
            onClick={() => setAccountFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <EmptyText text="해당 계좌 범위의 매매 기록이 없습니다." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-slate-200 dark:border-slate-800">
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="px-3 py-2 font-bold">
                      <button type="button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}</button>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="max-w-64 truncate px-3 py-2">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ThesisManager({
  state,
  updateState,
  embedded = false
}: {
  state: AppState;
  updateState: (producer: (current: AppState) => AppState, message?: string) => void;
  embedded?: boolean;
}) {
  const [assetId, setAssetId] = useState(state.assets[0]?.id ?? "");
  const thesis = state.theses.find((item) => item.assetId === assetId);
  const createDraft = (selectedAssetId: string): Omit<Thesis, "id"> => ({
    assetId: selectedAssetId,
    grade: "B",
    summary: ["", "", ""],
    targetPrice: 0,
    stopLossPrice: 0,
    addBuyPrice: 0,
    holdingConditionTags: [],
    holdingMemo: "",
    keyRisk: "",
    keyRiskTags: [],
    invalidationPrice: 0,
    invalidationCondition: "",
    invalidationConditionTags: [],
    addCondition: "",
    addConditionTags: [],
    noAddCondition: "",
    noAddConditionTags: [],
    partialSellCondition: "",
    partialSellConditionTags: [],
    fullExitCondition: "",
    fullExitConditionTags: [],
    alternatives: "",
    alternativeAssetIds: [],
    alternativePresetTags: [],
    lastReviewedAt: today(),
    nextReviewAt: ""
  });
  const [draft, setDraft] = useState<Omit<Thesis, "id">>(() => createDraft(assetId));

  useEffect(() => {
    const selected = state.theses.find((item) => item.assetId === assetId);
    setDraft(selected ? { ...createDraft(assetId), ...selected } : createDraft(assetId));
  }, [assetId, state.theses]);

  const saveThesis = (event: FormEvent) => {
    event.preventDefault();
    if (!assetId) return;
    const summary = [
      draft.holdingConditionTags[0] ?? "",
      draft.holdingConditionTags[1] ?? "",
      draft.holdingConditionTags[2] ?? ""
    ] as [string, string, string];
    const next: Thesis = { ...draft, summary, assetId, id: thesis?.id ?? createId("thesis") };
    updateState((current) => ({
      ...current,
      theses: current.theses.some((item) => item.assetId === assetId)
        ? current.theses.map((item) => item.assetId === assetId ? next : item)
        : [...current.theses, next]
    }), "보유·대응 기준을 저장했습니다.");
  };

  const content = (
      <form className="grid gap-3" onSubmit={saveThesis}>
        <Field label="종목">
          <select className="field" value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            {state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="투자 등급">
            <select className="field" value={draft.grade} onChange={(event) => setDraft({ ...draft, grade: event.target.value as ThesisGrade })}>
              {Object.entries(gradeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="목표가">
            <input className="field" type="number" value={draft.targetPrice} onChange={(event) => setDraft({ ...draft, targetPrice: inputNumber(event.target.value) })} />
          </Field>
          <Field label="매도검토가">
            <input className="field" type="number" value={draft.invalidationPrice} onChange={(event) => setDraft({ ...draft, invalidationPrice: inputNumber(event.target.value) })} />
          </Field>
          <Field label="손절가">
            <input className="field" type="number" value={draft.stopLossPrice} onChange={(event) => setDraft({ ...draft, stopLossPrice: inputNumber(event.target.value) })} />
          </Field>
          <Field label="추가매수 가능가">
            <input className="field" type="number" value={draft.addBuyPrice} onChange={(event) => setDraft({ ...draft, addBuyPrice: inputNumber(event.target.value) })} />
          </Field>
          <Field label="마지막 점검일">
            <input className="field" type="date" value={draft.lastReviewedAt} onChange={(event) => setDraft({ ...draft, lastReviewedAt: event.target.value })} />
          </Field>
          <Field label="다음 점검일">
            <input className="field" type="date" value={draft.nextReviewAt} onChange={(event) => setDraft({ ...draft, nextReviewAt: event.target.value })} />
          </Field>
        </div>
        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          매도검토가는 즉시 매도 가격이 아니라, 이탈 시 보유 논리와 대응 계획을 다시 점검하는 기준가입니다.
        </div>
        <MultiSelectField label="보유 조건" options={holdingConditionOptions} value={draft.holdingConditionTags} onChange={(value) => setDraft({ ...draft, holdingConditionTags: value })} />
        <Field label="보유 조건 상세 메모">
          <textarea className="field min-h-24" value={draft.holdingMemo} onChange={(event) => setDraft({ ...draft, holdingMemo: event.target.value })} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <MultiSelectField label="핵심 리스크" options={riskOptions} value={draft.keyRiskTags} onChange={(value) => setDraft({ ...draft, keyRiskTags: value })} />
          <Field label="핵심 리스크 상세 메모"><textarea className="field min-h-24" value={draft.keyRisk} onChange={(event) => setDraft({ ...draft, keyRisk: event.target.value })} /></Field>
          <MultiSelectField label="매도검토 조건" options={sellReviewConditionOptions} value={draft.invalidationConditionTags} onChange={(value) => setDraft({ ...draft, invalidationConditionTags: value })} />
          <Field label="투자논리 훼손 조건 상세 메모"><textarea className="field min-h-24" value={draft.invalidationCondition} onChange={(event) => setDraft({ ...draft, invalidationCondition: event.target.value })} /></Field>
          <MultiSelectField label="추가매수 조건" options={addConditionOptions} value={draft.addConditionTags} onChange={(value) => setDraft({ ...draft, addConditionTags: value })} />
          <Field label="추가매수 조건 상세 메모"><textarea className="field min-h-24" value={draft.addCondition} onChange={(event) => setDraft({ ...draft, addCondition: event.target.value })} /></Field>
          <MultiSelectField label="추가매수 금지 조건" options={noAddConditionOptions} value={draft.noAddConditionTags} onChange={(value) => setDraft({ ...draft, noAddConditionTags: value })} />
          <Field label="추가매수 금지 상세 메모"><textarea className="field min-h-24" value={draft.noAddCondition} onChange={(event) => setDraft({ ...draft, noAddCondition: event.target.value })} /></Field>
          <MultiSelectField label="일부매도 조건" options={partialSellConditionOptions} value={draft.partialSellConditionTags} onChange={(value) => setDraft({ ...draft, partialSellConditionTags: value })} />
          <Field label="일부매도 조건 상세 메모"><textarea className="field min-h-24" value={draft.partialSellCondition} onChange={(event) => setDraft({ ...draft, partialSellCondition: event.target.value })} /></Field>
          <MultiSelectField label="전량정리 조건" options={fullExitConditionOptions} value={draft.fullExitConditionTags} onChange={(value) => setDraft({ ...draft, fullExitConditionTags: value })} />
          <Field label="전량정리 조건 상세 메모"><textarea className="field min-h-24" value={draft.fullExitCondition} onChange={(event) => setDraft({ ...draft, fullExitCondition: event.target.value })} /></Field>
          <MultiSelectField label="교체 후보 기본 선택" options={alternativePresetOptions} value={draft.alternativePresetTags} onChange={(value) => setDraft({ ...draft, alternativePresetTags: value })} />
          <Field label="등록 종목 중 교체 후보">
            <select
              className="field min-h-28"
              multiple
              value={draft.alternativeAssetIds}
              onChange={(event) => setDraft({ ...draft, alternativeAssetIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })}
            >
              {state.assets.filter((asset) => asset.id !== assetId).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          </Field>
          <Field label="교체 후보 상세 메모"><textarea className="field min-h-24" value={draft.alternatives} onChange={(event) => setDraft({ ...draft, alternatives: event.target.value })} /></Field>
        </div>
        <button className="primary-button" type="submit" disabled={!state.assets.length}><Save className="h-4 w-4" />보유·대응 기준 저장</button>
      </form>
  );

  return embedded ? content : <Section title="종목별 보유·대응 기준">{content}</Section>;
}

function ChecklistView({ state, updateState }: { state: AppState; updateState: (producer: (current: AppState) => AppState, message?: string) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState({
    date: today(),
    accountId: state.accounts[0]?.id ?? "",
    assetId: state.assets[0]?.id ?? "",
    buyReason: "",
    trend: "확인 안함",
    overheated: "확인 안함",
    supply: "확인 안함",
    positionWeightMemo: "",
    stopLossPlan: "",
    targetPricePlan: "",
    finalDecision: "",
    planned: true,
    fomo: false,
    averaging: false,
    thesisImproved: false,
    maChecked: false,
    earningsChecked: false,
    relativeReturnChecked: false,
    sectorWeightOk: true,
    riskSizingChecked: false,
    eventRiskChecked: false,
    marketDefenseChecked: false,
    hasInvalidation: false,
    memo: ""
  });
  const result = evaluateChecklist({ ...draft, id: "preview" });
  const resultReason = draft.fomo || draft.averaging
    ? "FOMO 또는 물타기 체크됨"
    : !draft.planned
      ? "계획된 매수가 아님"
      : !draft.maChecked
        ? "20일선/60일선 미확인"
        : !draft.hasInvalidation
          ? "매도검토 기준가 없음"
          : "금지 또는 보류 조건 없음";

  const saveChecklist = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.assetId) return;
    const checklist: Checklist = { ...draft, id: createId("check"), result };
    updateState((current) => ({ ...current, checklists: [checklist, ...current.checklists] }), "매수 점검을 저장했습니다.");
  };

  const toggle = (key: keyof typeof draft) => setDraft((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
      <Section title="사전 매수 점검">
        <form className="grid gap-3" onSubmit={saveChecklist}>
          <Field label="날짜"><input className="field" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="계좌">
              <select className="field" value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
                {state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </Field>
            <Field label="종목">
              <select className="field" value={draft.assetId} onChange={(event) => setDraft({ ...draft, assetId: event.target.value })}>
                {state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="매수 이유">
            <textarea className="field min-h-20" value={draft.buyReason} onChange={(event) => setDraft({ ...draft, buyReason: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="추세">
              <select className="field" value={draft.trend} onChange={(event) => setDraft({ ...draft, trend: event.target.value })}>
                {["확인 안함", "상승", "횡보", "하락", "추세 회복", "추세 이탈"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="과열 여부">
              <select className="field" value={draft.overheated} onChange={(event) => setDraft({ ...draft, overheated: event.target.value })}>
                {["확인 안함", "아님", "주의", "과열"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="수급">
              <select className="field" value={draft.supply} onChange={(event) => setDraft({ ...draft, supply: event.target.value })}>
                {["확인 안함", "양호", "중립", "악화"].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </Field>
            <Field label="비중">
              <input className="field" value={draft.positionWeightMemo} onChange={(event) => setDraft({ ...draft, positionWeightMemo: event.target.value })} placeholder="예: 목표 5%, 현재 3%" />
            </Field>
            <Field label="손절 기준">
              <input className="field" value={draft.stopLossPlan} onChange={(event) => setDraft({ ...draft, stopLossPlan: event.target.value })} />
            </Field>
            <Field label="목표가">
              <input className="field" value={draft.targetPricePlan} onChange={(event) => setDraft({ ...draft, targetPricePlan: event.target.value })} />
            </Field>
            <Field label="최종 판단">
              <select className="field" value={draft.finalDecision} onChange={(event) => setDraft({ ...draft, finalDecision: event.target.value })}>
                {["", "소액 분할매수 가능", "보류", "매수 금지", "기록만 저장"].map((option) => <option key={option || "empty"} value={option}>{option || "선택 안 함"}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid gap-2 text-sm">
            {[
              ["planned", "계획된 매수인가?"],
              ["fomo", "FOMO인가?"],
              ["averaging", "물타기인가?"],
              ["maChecked", "20일선/60일선을 확인했는가?"],
              ["hasInvalidation", "매도검토 기준가가 등록되어 있는가?"]
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-950">
                <input type="checkbox" checked={Boolean(draft[key as keyof typeof draft])} onChange={() => toggle(key as keyof typeof draft)} />
                {label}
              </label>
            ))}
          </div>
          <button className="secondary-button justify-self-start" type="button" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? "고급 체크 접기" : "고급 체크 펼치기"}
          </button>
          {showAdvanced && (
            <div className="grid gap-2 text-sm">
              {[
                ["earningsChecked", "최근 실적 확인"],
                ["relativeReturnChecked", "상대수익률 확인"],
                ["sectorWeightOk", "섹터 비중 확인"],
                ["riskSizingChecked", "손실 기반 수량 계산"],
                ["eventRiskChecked", "이벤트 리스크 확인"],
                ["marketDefenseChecked", "시장 방어단계 확인"]
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-950">
                  <input type="checkbox" checked={Boolean(draft[key as keyof typeof draft])} onChange={() => toggle(key as keyof typeof draft)} />
                  {label}
                </label>
              ))}
            </div>
          )}
          <div className="rounded-md bg-slate-950 px-4 py-3 text-white dark:bg-white dark:text-slate-950">
            <p className="text-xs opacity-70">점검 결과</p>
            <p className="text-lg font-black">{checklistResultLabels[result]}</p>
            <p className="mt-1 text-sm opacity-80">사유: {resultReason}</p>
          </div>
          <Field label="메모"><textarea className="field min-h-20" value={draft.memo} onChange={(event) => setDraft({ ...draft, memo: event.target.value })} /></Field>
          <button className="primary-button" type="submit" disabled={!state.assets.length}><CheckCircle2 className="h-4 w-4" />점검 저장</button>
        </form>
      </Section>
      <Section title="점검 기록">
        <div className="grid gap-2">
          {state.checklists.map((item) => (
            <div key={item.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{assetName(state.assets, item.assetId)}</span>
                <span>{checklistResultLabels[item.result]}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{item.date} · {item.memo}</p>
              {(item.finalDecision || item.buyReason) && (
                <p className="mt-1 text-xs text-slate-500">
                  {item.finalDecision || "최종 판단 없음"} · {item.buyReason || "매수 이유 없음"}
                </p>
              )}
            </div>
          ))}
          {!state.checklists.length && <EmptyText text="저장된 점검 기록이 없습니다." />}
        </div>
      </Section>
    </div>
  );
}

function SwapView({ state, updateState }: { state: AppState; updateState: (producer: (current: AppState) => AppState, message?: string) => void }) {
  const [draft, setDraft] = useState({
    date: today(),
    currentAssetId: state.assets[0]?.id ?? "",
    candidateAssetId: state.assets[1]?.id ?? state.assets[0]?.id ?? "",
    currentReturnRate: 0,
    thesisStillValid: true,
    recoveredMovingAverages: false,
    candidateThesis: "",
    candidateStrength: "",
    candidateRisk: "",
    taxFeeMemo: "",
    decision: "hold" as SwapDecision
  });
  const saveSwap = (event: FormEvent) => {
    event.preventDefault();
    updateState((current) => ({ ...current, swapReviews: [{ ...draft, id: createId("swap") }, ...current.swapReviews] }), "교체매매 비교를 저장했습니다.");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Section title="교체매매 비교">
        <form className="grid gap-3" onSubmit={saveSwap}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="기존 종목"><select className="field" value={draft.currentAssetId} onChange={(event) => setDraft({ ...draft, currentAssetId: event.target.value })}>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field>
            <Field label="교체 후보"><select className="field" value={draft.candidateAssetId} onChange={(event) => setDraft({ ...draft, candidateAssetId: event.target.value })}>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field>
          </div>
          <Field label="기존 종목 손익률"><input className="field" type="number" value={draft.currentReturnRate} onChange={(event) => setDraft({ ...draft, currentReturnRate: inputNumber(event.target.value) })} /></Field>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.thesisStillValid} onChange={(event) => setDraft({ ...draft, thesisStillValid: event.target.checked })} />투자 논리 유지</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={draft.recoveredMovingAverages} onChange={(event) => setDraft({ ...draft, recoveredMovingAverages: event.target.checked })} />20/60일선 회복</label>
          </div>
          <Field label="교체 후보 투자 논리"><textarea className="field min-h-20" value={draft.candidateThesis} onChange={(event) => setDraft({ ...draft, candidateThesis: event.target.value })} /></Field>
          <Field label="교체 후보 장점"><textarea className="field min-h-20" value={draft.candidateStrength} onChange={(event) => setDraft({ ...draft, candidateStrength: event.target.value })} /></Field>
          <Field label="교체 후보 리스크"><textarea className="field min-h-20" value={draft.candidateRisk} onChange={(event) => setDraft({ ...draft, candidateRisk: event.target.value })} /></Field>
          <Field label="세금/수수료 메모"><textarea className="field min-h-20" value={draft.taxFeeMemo} onChange={(event) => setDraft({ ...draft, taxFeeMemo: event.target.value })} /></Field>
          <Field label="결과 선택"><select className="field" value={draft.decision} onChange={(event) => setDraft({ ...draft, decision: event.target.value as SwapDecision })}>{Object.entries(swapDecisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <button className="primary-button" type="submit" disabled={state.assets.length < 1}><Save className="h-4 w-4" />비교 저장</button>
        </form>
      </Section>
      <Section title="교체매매 기록">
        <div className="grid gap-2">
          {state.swapReviews.map((item) => (
            <div key={item.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
              <p className="font-semibold">{assetName(state.assets, item.currentAssetId)} → {assetName(state.assets, item.candidateAssetId)}</p>
              <p className="mt-1 text-xs text-slate-500">{item.date} · {swapDecisionLabels[item.decision]} · 기존 손익률 {formatPercent(item.currentReturnRate)}</p>
            </div>
          ))}
          {!state.swapReviews.length && <EmptyText text="저장된 교체매매 비교가 없습니다." />}
        </div>
      </Section>
    </div>
  );
}

type MoreSectionKey = "manage" | "swap" | "review" | "backup";

function MoreView({
  section,
  setSection,
  state,
  updateState,
  metrics,
  persist,
  fileInputRef,
  firebaseUser,
  syncStatus,
  syncMessage
}: {
  section: MoreSectionKey | null;
  setSection: (section: MoreSectionKey | null) => void;
  state: AppState;
  updateState: (producer: (current: AppState) => AppState, message?: string) => void;
  metrics: ReturnType<typeof calculateMetrics>;
  persist: (next: AppState, message?: string) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  firebaseUser: User | null;
  syncStatus: CloudSyncStatus;
  syncMessage: string;
}) {
  const cards: Array<{ key: MoreSectionKey; title: string; desc: string }> = [
    { key: "manage", title: "관리", desc: "계좌·종목 등록, 초기보유 준비" },
    { key: "swap", title: "교체비교", desc: "손실 종목 교체 판단" },
    { key: "review", title: "월간복기", desc: "월별 성과와 감정 매매 기록" },
    { key: "backup", title: "설정·백업", desc: "JSON 내보내기·가져오기" }
  ];

  if (!section) {
    return (
      <Section title="더보기">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <button
              key={card.key}
              className="rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-teal-500 hover:bg-teal-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500 dark:hover:bg-slate-950"
              type="button"
              onClick={() => setSection(card.key)}
            >
              <p className="font-bold text-slate-950 dark:text-white">{card.title}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{card.desc}</p>
            </button>
          ))}
        </div>
      </Section>
    );
  }

  return (
    <div className="grid gap-4">
      <button className="secondary-button justify-self-start" type="button" onClick={() => setSection(null)}>
        더보기 메뉴로 돌아가기
      </button>
      {section === "manage" && <Manage state={state} updateState={updateState} />}
      {section === "swap" && <SwapView state={state} updateState={updateState} />}
      {section === "review" && <MonthlyReviewView state={state} updateState={updateState} metrics={metrics} />}
      {section === "backup" && (
        <BackupView
          state={state}
          persist={persist}
          fileInputRef={fileInputRef}
          firebaseUser={firebaseUser}
          syncStatus={syncStatus}
          syncMessage={syncMessage}
        />
      )}
    </div>
  );
}

function MonthlyReviewView({ state, updateState, metrics }: { state: AppState; metrics: ReturnType<typeof calculateMetrics>; updateState: (producer: (current: AppState) => AppState, message?: string) => void }) {
  const [draft, setDraft] = useState<Omit<MonthlyReview, "id">>({
    month: currentMonth(),
    totalReturnRate: metrics.totalReturnRate,
    realizedPnl: metrics.realizedPnl,
    unrealizedPnl: metrics.unrealizedPnl,
    tradeCount: state.trades.filter((trade) => trade.date.startsWith(currentMonth())).length,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
    averageWin: 0,
    averageLoss: 0,
    profitLossRatio: 0,
    expectancy: 0,
    bestTrade: "",
    worstTrade: "",
    emotionalTrades: "",
    nextMonthRules: ""
  });
  useEffect(() => {
    const total = draft.winCount + draft.lossCount;
    const winRate = total > 0 ? (draft.winCount / total) * 100 : 0;
    const profitLossRatio = draft.averageLoss ? draft.averageWin / Math.abs(draft.averageLoss) : 0;
    const expectancy = (winRate / 100) * draft.averageWin - (1 - winRate / 100) * Math.abs(draft.averageLoss);
    setDraft((current) => ({ ...current, winRate, profitLossRatio, expectancy }));
  }, [draft.winCount, draft.lossCount, draft.averageWin, draft.averageLoss]);

  const saveReview = (event: FormEvent) => {
    event.preventDefault();
    const review: MonthlyReview = { ...draft, id: createId("review") };
    updateState((current) => ({
      ...current,
      monthlyReviews: current.monthlyReviews.some((item) => item.month === review.month)
        ? current.monthlyReviews.map((item) => item.month === review.month ? review : item)
        : [review, ...current.monthlyReviews]
    }), "월간 복기를 저장했습니다.");
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <Section title="월간 복기 입력">
        <form className="grid gap-3" onSubmit={saveReview}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="월"><input className="field" type="month" value={draft.month} onChange={(event) => setDraft({ ...draft, month: event.target.value })} /></Field>
            <Field label="총수익률"><input className="field" type="number" value={draft.totalReturnRate} onChange={(event) => setDraft({ ...draft, totalReturnRate: inputNumber(event.target.value) })} /></Field>
            <Field label="실현손익"><input className="field" type="number" value={draft.realizedPnl} onChange={(event) => setDraft({ ...draft, realizedPnl: inputNumber(event.target.value) })} /></Field>
            <Field label="평가손익"><input className="field" type="number" value={draft.unrealizedPnl} onChange={(event) => setDraft({ ...draft, unrealizedPnl: inputNumber(event.target.value) })} /></Field>
            <Field label="매매 횟수"><input className="field" type="number" value={draft.tradeCount} onChange={(event) => setDraft({ ...draft, tradeCount: inputNumber(event.target.value) })} /></Field>
            <Field label="수익 거래 수"><input className="field" type="number" value={draft.winCount} onChange={(event) => setDraft({ ...draft, winCount: inputNumber(event.target.value) })} /></Field>
            <Field label="손실 거래 수"><input className="field" type="number" value={draft.lossCount} onChange={(event) => setDraft({ ...draft, lossCount: inputNumber(event.target.value) })} /></Field>
            <Field label="승률"><input className="field" readOnly value={formatPercent(draft.winRate)} /></Field>
            <Field label="평균 이익"><input className="field" type="number" value={draft.averageWin} onChange={(event) => setDraft({ ...draft, averageWin: inputNumber(event.target.value) })} /></Field>
            <Field label="평균 손실"><input className="field" type="number" value={draft.averageLoss} onChange={(event) => setDraft({ ...draft, averageLoss: inputNumber(event.target.value) })} /></Field>
            <Field label="손익비"><input className="field" readOnly value={formatNumber(draft.profitLossRatio, 2)} /></Field>
            <Field label="기대값"><input className="field" readOnly value={formatKrw(draft.expectancy)} /></Field>
          </div>
          <Field label="가장 잘한 매매"><textarea className="field min-h-20" value={draft.bestTrade} onChange={(event) => setDraft({ ...draft, bestTrade: event.target.value })} /></Field>
          <Field label="가장 아쉬운 매매"><textarea className="field min-h-20" value={draft.worstTrade} onChange={(event) => setDraft({ ...draft, worstTrade: event.target.value })} /></Field>
          <Field label="감정적 매매"><textarea className="field min-h-20" value={draft.emotionalTrades} onChange={(event) => setDraft({ ...draft, emotionalTrades: event.target.value })} /></Field>
          <Field label="다음 달 원칙"><textarea className="field min-h-20" value={draft.nextMonthRules} onChange={(event) => setDraft({ ...draft, nextMonthRules: event.target.value })} /></Field>
          <button className="primary-button" type="submit"><Save className="h-4 w-4" />복기 저장</button>
        </form>
      </Section>
      <Section title="복기 기록">
        <div className="grid gap-2">
          {state.monthlyReviews.map((item) => (
            <div key={item.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{item.month}</span>
                <span>{formatPercent(item.totalReturnRate)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">승률 {formatPercent(item.winRate)} · 기대값 {formatKrw(item.expectancy)}</p>
              <p className="mt-2">{item.nextMonthRules}</p>
            </div>
          ))}
          {!state.monthlyReviews.length && <EmptyText text="저장된 월간 복기가 없습니다." />}
        </div>
      </Section>
    </div>
  );
}

function BackupView({
  state,
  persist,
  fileInputRef,
  firebaseUser,
  syncStatus,
  syncMessage
}: {
  state: AppState;
  persist: (next: AppState, message?: string) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  firebaseUser: User | null;
  syncStatus: CloudSyncStatus;
  syncMessage: string;
}) {
  const importJson = async (file: File) => {
    const text = await file.text();
    const imported = mergeWithDefaults(JSON.parse(text));
    const shouldReplace = window.confirm("현재 로컬 데이터를 가져온 JSON으로 덮어쓸까요?");
    if (shouldReplace) await persist(imported, "JSON 데이터를 가져왔습니다.");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Google 계정 자동 저장" icon={<Cloud className="h-5 w-5 text-teal-700" />}>
        <div className="grid gap-3">
          <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-950">
            <p><strong>로그인:</strong> {firebaseUser?.email ?? "로그인하지 않음"}</p>
            <p><strong>동기화 상태:</strong> {syncStatusLabels[syncStatus]}</p>
            <p><strong>마지막 동기화:</strong> {state.settings.cloudSync.lastSyncedAt?.slice(0, 19).replace("T", " ") ?? "없음"}</p>
            {syncMessage && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{syncMessage}</p>}
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            저장은 상단 오른쪽 Google 로그인 후 자동으로 진행됩니다. 같은 Google 계정으로 다른 PC나 웹앱에서 접속하면 같은 데이터를 불러옵니다.
          </div>
        </div>
      </Section>

      <Section title="가격 업데이트 설정" icon={<RefreshCw className="h-5 w-5 text-teal-700" />}>
        <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          가격 공급자는 Twelve Data 하나로 고정했습니다. 미국 주식/ETF만 자동 업데이트를 시도하고, 국내 주식·국내 ETF·환율은 수동 입력을 기본으로 유지합니다.
        </div>
      </Section>

      <Section title="JSON·CSV·Markdown 내보내기">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <button className="secondary-button" type="button" onClick={() => downloadText("investment-journal-export.json", exportJson(state), "application/json")}><FileJson className="h-4 w-4" />JSON</button>
            <button className="secondary-button" type="button" onClick={() => downloadText("investment-journal-export.csv", exportCsv(state), "text/csv")}><Download className="h-4 w-4" />CSV</button>
            <button className="secondary-button" type="button" onClick={() => downloadText("investment-journal-export.md", exportMarkdown(state), "text/markdown")}><Download className="h-4 w-4" />Markdown</button>
          </div>
          <input ref={fileInputRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importJson(file);
            event.currentTarget.value = "";
          }} />
          <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}><Upload className="h-4 w-4" />JSON 가져오기</button>
          <button className="danger-button" type="button" onClick={async () => {
            const ok = window.confirm("이 기기의 로컬 데이터를 초기화할까요? Google 계정 자동 저장 데이터는 로그인 후 다시 불러올 수 있습니다.");
            if (ok) await persist(await resetState(), "로컬 데이터를 초기화했습니다.");
          }}>로컬 데이터 초기화</button>
          <p className="text-sm text-slate-500 dark:text-slate-400">앱은 매수·매도 결정을 자동으로 내리지 않습니다. 기록, 계산, 복기, 위험 점검만 돕습니다.</p>
        </div>
      </Section>
    </div>
  );
}

const EmptyText = ({ text }: { text: string }) => (
  <div className="grid min-h-28 place-items-center rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
    {text}
  </div>
);

export default App;
