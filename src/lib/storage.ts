import { AppState } from "../types";
import { createEmptyState, mergeWithDefaults } from "../data/defaults";

const DB_NAME = "my-investment-journal";
const STORE_NAME = "state";
const STATE_KEY = "app-state";
const LOCAL_STORAGE_KEY = "my-investment-journal:fallback";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const loadState = async (): Promise<AppState> => {
  if (!("indexedDB" in window)) {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return mergeWithDefaults(raw ? JSON.parse(raw) : null);
  }

  try {
    const db = await openDb();
    const state = await new Promise<AppState | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return mergeWithDefaults(state ?? null);
  } catch {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return mergeWithDefaults(raw ? JSON.parse(raw) : null);
  }
};

export const saveState = async (state: AppState): Promise<AppState> => {
  const stamped = { ...state, updatedAt: new Date().toISOString() };
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stamped));

  if (!("indexedDB" in window)) return stamped;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(stamped, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return stamped;
};

export const resetState = async () => saveState(createEmptyState());
