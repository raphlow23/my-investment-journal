import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
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

const snapshotRef = (db: Firestore, uid: string) => doc(db, "users", uid, "appState", "current");

const downloadCloudDeletes = async (db: Firestore, uid: string) => {
  const snap = await getDocs(collection(db, "users", uid, "deletionMarkers"));
  return snap.docs.map((entry) => entry.data() as NonNullable<AppState["settings"]["cloudSync"]["pendingDeletes"]>[number]);
};

const recordStamp = (record: Record<string, unknown>) =>
  String(record.updatedAt || record.createdAt || record.date || record.updated_at || "");

const newerRecord = <T extends SyncRecord>(local?: T, remote?: T): T | undefined => {
  if (!local) return remote;
  if (!remote) return local;
  const localTime = new Date(recordStamp(local as Record<string, unknown>)).getTime() || 0;
  const remoteTime = new Date(recordStamp(remote as Record<string, unknown>)).getTime() || 0;
  return remoteTime >= localTime ? remote : local;
};

const recordId = (record: SyncRecord) =>
  String(record.id || record.instrumentId && `${record.instrumentId}-${record.updatedAt || record.updatedAt || record.capturedAt || record.updatedAt || record.price || ""}` || crypto.randomUUID());

export const cloudRecordId = (record: SyncRecord) => recordId(record);

const mergeRecords = <T extends SyncRecord>(local: T[], remote: T[]) => {
  const merged = new Map<string, T>();
  local.forEach((item) => merged.set(recordId(item), item));
  remote.forEach((item) => {
    const key = recordId(item);
    merged.set(key, newerRecord(merged.get(key), item) as T);
  });
  return Array.from(merged.values()).filter((item) => !(item as Record<string, unknown>).deletedAt);
};

const removeUndefinedFields = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedFields(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, fieldValue]) => fieldValue !== undefined)
        .map(([key, fieldValue]) => [key, removeUndefinedFields(fieldValue)])
    );
  }
  return value;
};

export const hasUserData = (state: AppState) =>
  state.assets.length > 0 ||
  state.trades.length > 0 ||
  state.theses.length > 0 ||
  state.priceQuotes.length > 0 ||
  state.checklists.length > 0 ||
  state.swapReviews.length > 0 ||
  state.monthlyReviews.length > 0;

export const downloadCloudState = async (db: Firestore, uid: string, localBase: AppState): Promise<AppState> => {
  const cloudDeletes = await downloadCloudDeletes(db, uid);
  const snapshot = await getDoc(snapshotRef(db, uid));
  if (snapshot.exists()) {
    const remote = mergeWithDefaults(snapshot.data() as Partial<AppState>);
    const pendingDeletes = new Set(
      [
        ...(localBase.settings.cloudSync.pendingDeletes ?? []),
        ...(remote.settings.cloudSync.pendingDeletes ?? []),
        ...cloudDeletes
      ].map((item) => `${item.collection}:${item.id}`)
    );
    return mergeWithDefaults({
      ...remote,
      accounts: remote.accounts.filter((item) => !pendingDeletes.has(`accounts:${item.id}`)),
      assets: remote.assets.filter((item) => !pendingDeletes.has(`instruments:${item.id}`)),
      trades: remote.trades.filter((item) => !pendingDeletes.has(`tradeLogs:${item.id}`)),
      theses: remote.theses.filter((item) => !pendingDeletes.has(`positionPlans:${item.id}`)),
      checklists: remote.checklists.filter((item) => !pendingDeletes.has(`preTradeChecklists:${item.id}`)),
      swapReviews: remote.swapReviews.filter((item) => !pendingDeletes.has(`switchReviews:${item.id}`)),
      monthlyReviews: remote.monthlyReviews.filter((item) => !pendingDeletes.has(`monthlyReviews:${item.id}`)),
      settings: {
        ...remote.settings,
        cloudSync: {
          ...remote.settings.cloudSync,
          pendingDeletes: Array.from(
            new Map(
              [
                ...(localBase.settings.cloudSync.pendingDeletes ?? []),
                ...(remote.settings.cloudSync.pendingDeletes ?? []),
                ...cloudDeletes
              ].map((item) => [`${item.collection}:${item.id}`, item])
            ).values()
          ),
          userId: uid,
          enabled: true,
          lastSyncedAt: new Date().toISOString()
        }
      }
    });
  }

  const next: AppState = mergeWithDefaults({ ...localBase, accounts: [], assets: [], trades: [], theses: [], priceQuotes: [], checklists: [], swapReviews: [], monthlyReviews: [] });
  const pendingDeletes = new Set(
    [
      ...(localBase.settings.cloudSync.pendingDeletes ?? []),
      ...cloudDeletes
    ].map((item) => `${item.collection}:${item.id}`)
  );
  for (const item of collectionMap) {
    const snap = await getDocs(collection(db, "users", uid, item.firestoreKey));
    const values = snap.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((entry) => !(entry as SyncRecord).deletedAt)
      .filter((entry) => !pendingDeletes.has(`${item.firestoreKey}:${entry.id}`));
    (next[item.stateKey] as unknown[]) = values;
  }
  return mergeWithDefaults({
    ...next,
    settings: {
      ...localBase.settings,
      cloudSync: {
        ...localBase.settings.cloudSync,
        pendingDeletes: Array.from(
          new Map(
            [
              ...(localBase.settings.cloudSync.pendingDeletes ?? []),
              ...cloudDeletes
            ].map((item) => [`${item.collection}:${item.id}`, item])
          ).values()
        ),
        userId: uid,
        enabled: true,
        lastSyncedAt: new Date().toISOString()
      }
    }
  });
};

export const mergeLocalAndCloud = async (db: Firestore, uid: string, local: AppState): Promise<AppState> => {
  const remote = await downloadCloudState(db, uid, local);
  const localOwner = local.settings.cloudSync.userId;
  if (localOwner !== uid) {
    const accountState = mergeWithDefaults({
      ...remote,
      settings: {
        ...remote.settings,
        cloudSync: {
          ...remote.settings.cloudSync,
          userId: uid,
          enabled: true,
          lastSyncedAt: new Date().toISOString()
        }
      }
    });
    await uploadStateToCloud(db, uid, accountState);
    return accountState;
  }

  const pendingDeletes = Array.from(
    new Map(
      [
        ...(local.settings.cloudSync.pendingDeletes ?? []),
        ...(remote.settings.cloudSync.pendingDeletes ?? [])
      ].map((item) => [`${item.collection}:${item.id}`, item])
    ).values()
  );
  const deleted = new Set(pendingDeletes.map((item) => `${item.collection}:${item.id}`));
  const merged = mergeWithDefaults({
    ...local,
    accounts: (mergeRecords(local.accounts as unknown as SyncRecord[], remote.accounts as unknown as SyncRecord[]) as unknown as AppState["accounts"]).filter((item) => !deleted.has(`accounts:${item.id}`)),
    assets: (mergeRecords(local.assets as unknown as SyncRecord[], remote.assets as unknown as SyncRecord[]) as unknown as AppState["assets"]).filter((item) => !deleted.has(`instruments:${item.id}`)),
    trades: (mergeRecords(local.trades as unknown as SyncRecord[], remote.trades as unknown as SyncRecord[]) as unknown as AppState["trades"]).filter((item) => !deleted.has(`tradeLogs:${item.id}`)),
    theses: (mergeRecords(local.theses as unknown as SyncRecord[], remote.theses as unknown as SyncRecord[]) as unknown as AppState["theses"]).filter((item) => !deleted.has(`positionPlans:${item.id}`)),
    priceQuotes: mergeRecords(local.priceQuotes as unknown as SyncRecord[], remote.priceQuotes as unknown as SyncRecord[]) as unknown as AppState["priceQuotes"],
    checklists: (mergeRecords(local.checklists as unknown as SyncRecord[], remote.checklists as unknown as SyncRecord[]) as unknown as AppState["checklists"]).filter((item) => !deleted.has(`preTradeChecklists:${item.id}`)),
    swapReviews: (mergeRecords(local.swapReviews as unknown as SyncRecord[], remote.swapReviews as unknown as SyncRecord[]) as unknown as AppState["swapReviews"]).filter((item) => !deleted.has(`switchReviews:${item.id}`)),
    monthlyReviews: (mergeRecords(local.monthlyReviews as unknown as SyncRecord[], remote.monthlyReviews as unknown as SyncRecord[]) as unknown as AppState["monthlyReviews"]).filter((item) => !deleted.has(`monthlyReviews:${item.id}`)),
    settings: {
      ...local.settings,
      cloudSync: {
        ...local.settings.cloudSync,
        pendingDeletes,
        userId: uid,
        enabled: true,
        lastSyncedAt: new Date().toISOString()
      }
    }
  });
  await uploadStateToCloud(db, uid, merged);
  return merged;
};

export const uploadStateToCloud = async (db: Firestore, uid: string, state: AppState) => {
  const existingSnapshot = await getDoc(snapshotRef(db, uid));
  if (existingSnapshot.exists() && state.settings.cloudSync.userId !== uid) return;

  const snapshot = removeUndefinedFields({
    ...state,
    settings: {
      ...state.settings,
      cloudSync: {
        ...state.settings.cloudSync,
        userId: uid,
        enabled: true
      }
    },
    updatedAt: new Date().toISOString()
  });
  await setDoc(snapshotRef(db, uid), snapshot);

  await setDoc(doc(db, "users", uid), {
    uid,
    updatedAt: new Date().toISOString(),
    appVersion: state.version
  }, { merge: true });
};
