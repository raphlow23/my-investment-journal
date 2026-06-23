import {
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
  type Firestore
} from "firebase/firestore";
import { mergeWithDefaults } from "../data/defaults";
import { AppState } from "../types";

type SyncCollectionKey =
  | "accounts"
  | "assets"
  | "trades"
  | "theses"
  | "priceQuotes"
  | "checklists"
  | "swapReviews"
  | "monthlyReviews";

type SyncRecord = Record<string, unknown>;

const collectionMap: Array<{ stateKey: SyncCollectionKey; firestoreKey: string }> = [
  { stateKey: "accounts", firestoreKey: "accounts" },
  { stateKey: "assets", firestoreKey: "instruments" },
  { stateKey: "trades", firestoreKey: "tradeLogs" },
  { stateKey: "theses", firestoreKey: "positionPlans" },
  { stateKey: "priceQuotes", firestoreKey: "priceSnapshots" },
  { stateKey: "checklists", firestoreKey: "preTradeChecklists" },
  { stateKey: "swapReviews", firestoreKey: "switchReviews" },
  { stateKey: "monthlyReviews", firestoreKey: "monthlyReviews" }
];

const recordStamp = (record: Record<string, unknown>) =>
  String(record.updatedAt || record.createdAt || record.date || record.updated_at || "");

const newerRecord = <T extends SyncRecord>(local?: T, remote?: T): T | undefined => {
  if (!local) return remote;
  if (!remote) return local;
  const localTime = new Date(recordStamp(local as Record<string, unknown>)).getTime() || 0;
  const remoteTime = new Date(recordStamp(remote as Record<string, unknown>)).getTime() || 0;
  return remoteTime > localTime ? remote : local;
};

const recordId = (record: SyncRecord) =>
  String(record.id || record.instrumentId && `${record.instrumentId}-${record.updatedAt || record.updatedAt || record.capturedAt || record.updatedAt || record.price || ""}` || crypto.randomUUID());

const mergeRecords = <T extends SyncRecord>(local: T[], remote: T[]) => {
  const merged = new Map<string, T>();
  local.forEach((item) => merged.set(recordId(item), item));
  remote.forEach((item) => {
    const key = recordId(item);
    merged.set(key, newerRecord(merged.get(key), item) as T);
  });
  return Array.from(merged.values()).filter((item) => !(item as Record<string, unknown>).deletedAt);
};

const stampRecord = <T extends SyncRecord>(record: T): T & { updatedAt: string } => ({
  ...record,
  updatedAt: String((record as Record<string, unknown>).updatedAt || (record as Record<string, unknown>).createdAt || new Date().toISOString())
});

export const hasUserData = (state: AppState) =>
  state.assets.length > 0 ||
  state.trades.length > 0 ||
  state.theses.length > 0 ||
  state.priceQuotes.length > 0 ||
  state.checklists.length > 0 ||
  state.swapReviews.length > 0 ||
  state.monthlyReviews.length > 0;

export const downloadCloudState = async (db: Firestore, uid: string, localBase: AppState): Promise<AppState> => {
  const next: AppState = mergeWithDefaults({ ...localBase, accounts: [], assets: [], trades: [], theses: [], priceQuotes: [], checklists: [], swapReviews: [], monthlyReviews: [] });
  for (const item of collectionMap) {
    const snap = await getDocs(collection(db, "users", uid, item.firestoreKey));
    const values = snap.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((entry) => !(entry as SyncRecord).deletedAt);
    (next[item.stateKey] as unknown[]) = values;
  }
  return mergeWithDefaults({
    ...next,
    settings: {
      ...localBase.settings,
      cloudSync: {
        enabled: true,
        lastSyncedAt: new Date().toISOString()
      }
    }
  });
};

export const mergeLocalAndCloud = async (db: Firestore, uid: string, local: AppState): Promise<AppState> => {
  const remote = await downloadCloudState(db, uid, local);
  const merged = mergeWithDefaults({
    ...local,
    accounts: mergeRecords(local.accounts as unknown as SyncRecord[], remote.accounts as unknown as SyncRecord[]) as unknown as AppState["accounts"],
    assets: mergeRecords(local.assets as unknown as SyncRecord[], remote.assets as unknown as SyncRecord[]) as unknown as AppState["assets"],
    trades: mergeRecords(local.trades as unknown as SyncRecord[], remote.trades as unknown as SyncRecord[]) as unknown as AppState["trades"],
    theses: mergeRecords(local.theses as unknown as SyncRecord[], remote.theses as unknown as SyncRecord[]) as unknown as AppState["theses"],
    priceQuotes: mergeRecords(local.priceQuotes as unknown as SyncRecord[], remote.priceQuotes as unknown as SyncRecord[]) as unknown as AppState["priceQuotes"],
    checklists: mergeRecords(local.checklists as unknown as SyncRecord[], remote.checklists as unknown as SyncRecord[]) as unknown as AppState["checklists"],
    swapReviews: mergeRecords(local.swapReviews as unknown as SyncRecord[], remote.swapReviews as unknown as SyncRecord[]) as unknown as AppState["swapReviews"],
    monthlyReviews: mergeRecords(local.monthlyReviews as unknown as SyncRecord[], remote.monthlyReviews as unknown as SyncRecord[]) as unknown as AppState["monthlyReviews"],
    settings: {
      ...local.settings,
      cloudSync: {
        enabled: true,
        lastSyncedAt: new Date().toISOString()
      }
    }
  });
  await uploadStateToCloud(db, uid, merged);
  return merged;
};

export const uploadStateToCloud = async (db: Firestore, uid: string, state: AppState) => {
  await setDoc(doc(db, "users", uid), {
    uid,
    updatedAt: new Date().toISOString(),
    appVersion: state.version
  }, { merge: true });

  for (const item of collectionMap) {
    const records = state[item.stateKey] as unknown as SyncRecord[];
    let batch = writeBatch(db);
    let count = 0;
    for (const record of records) {
      const id = recordId(record);
      batch.set(doc(db, "users", uid, item.firestoreKey, id), stampRecord({ ...record, id }), { merge: true });
      count += 1;
      if (count >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  }
};
