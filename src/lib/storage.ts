const DB_NAME = "my-investment-journal";
const LOCAL_STORAGE_KEY = "my-investment-journal:fallback";

export const clearLegacyLocalState = async () => {
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  if (!("indexedDB" in window)) return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
};
