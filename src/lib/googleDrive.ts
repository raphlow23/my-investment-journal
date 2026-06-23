import { AppState } from "../types";
import { decryptJson, EncryptedPayload, encryptJson } from "./crypto";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }) => { requestAccessToken: (options?: { prompt?: string }) => void };
        };
      };
    };
  }
}

const FILE_NAME = "encrypted-investment-journal.json";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string;
}

const loadGisScript = () =>
  new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src*="accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Google 로그인 스크립트를 불러오지 못했습니다.")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google 로그인 스크립트를 불러오지 못했습니다."));
    document.head.appendChild(script);
  });

export const requestDriveAccessToken = async () => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) {
    throw new Error(".env에 VITE_GOOGLE_CLIENT_ID를 설정해야 Google Drive 연결을 사용할 수 있습니다.");
  }
  await loadGisScript();
  return new Promise<string>((resolve, reject) => {
    const tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Google Drive 권한을 받지 못했습니다."));
          return;
        }
        resolve(response.access_token);
      }
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
};

const driveFetch = async <T>(token: string, url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Google Drive 요청 실패: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const findBackupFile = async (token: string): Promise<DriveFileMeta | null> => {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    fields: "files(id,name,modifiedTime)",
    q: `name='${FILE_NAME.replace(/'/g, "\\'")}' and trashed=false`
  });
  const result = await driveFetch<{ files: DriveFileMeta[] }>(token, `${DRIVE_API}/files?${params.toString()}`);
  return result.files[0] ?? null;
};

export const downloadEncryptedBackup = async (token: string, fileId: string): Promise<EncryptedPayload> =>
  driveFetch<EncryptedPayload>(token, `${DRIVE_API}/files/${fileId}?alt=media`);

export const uploadEncryptedBackup = async (
  token: string,
  payload: EncryptedPayload,
  fileId?: string
): Promise<DriveFileMeta> => {
  const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
  if (fileId) {
    return driveFetch<DriveFileMeta>(
      token,
      `${DRIVE_UPLOAD}/files/${fileId}?uploadType=media&fields=id,name,modifiedTime`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body
      }
    );
  }

  const metadata = {
    name: FILE_NAME,
    parents: ["appDataFolder"],
    mimeType: "application/json"
  };
  const boundary = "investment-journal-boundary";
  const multipartBody = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
      JSON.stringify(payload),
      `\r\n--${boundary}--`
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  return driveFetch<DriveFileMeta>(token, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody
  });
};

export const backupStateToDrive = async (token: string, state: AppState, password: string, fileId?: string) => {
  const existing = fileId ? { id: fileId } : await findBackupFile(token);
  const payload = await encryptJson(state, password);
  return uploadEncryptedBackup(token, payload, existing?.id);
};

export const restoreStateFromDrive = async (token: string, password: string) => {
  const file = await findBackupFile(token);
  if (!file) return { file: null, state: null };
  const encrypted = await downloadEncryptedBackup(token, file.id);
  const state = await decryptJson<AppState>(encrypted, password);
  return { file, state };
};
