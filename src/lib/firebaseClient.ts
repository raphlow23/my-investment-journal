import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User
} from "firebase/auth";
import {
  enableIndexedDbPersistence,
  initializeFirestore,
  type Firestore
} from "firebase/firestore";

type FirebaseServices = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
};

let services: FirebaseServices | null = null;
let persistenceStarted = false;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const isFirebaseConfigured = () =>
  Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);

export const getFirebaseServices = () => {
  if (!isFirebaseConfigured()) return null;
  if (services) return services;
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    ignoreUndefinedProperties: true
  });
  services = { app, auth, db };
  if (!persistenceStarted) {
    persistenceStarted = true;
    void enableIndexedDbPersistence(db).catch(() => undefined);
  }
  return services;
};

export const listenToFirebaseUser = (callback: (user: User | null) => void) => {
  const firebase = getFirebaseServices();
  if (!firebase) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(firebase.auth, callback);
};

const createGoogleProvider = () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: "select_account"
  });
  return provider;
};

export const getFirebaseAuthErrorMessage = (error: unknown) => {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "auth/popup-blocked") return "브라우저에서 팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 Google 로그인을 다시 눌러 주세요.";
  if (code === "auth/popup-closed-by-user") return "로그인 창이 닫혔습니다. Google 로그인을 다시 눌러 주세요.";
  if (code === "auth/cancelled-popup-request") return "이전 로그인 요청이 취소되었습니다. 다시 시도해 주세요.";
  return error instanceof Error ? error.message : "Google 로그인에 실패했습니다.";
};

export const signInWithGoogle = async () => {
  const firebase = getFirebaseServices();
  if (!firebase) throw new Error("Firebase 설정이 없습니다. .env에 Firebase 웹 앱 설정을 입력하세요.");
  const provider = createGoogleProvider();
  try {
    const result = await signInWithPopup(firebase.auth, provider);
    return result.user;
  } catch (error) {
    throw error;
  }
};

export const signOutFirebase = async () => {
  const firebase = getFirebaseServices();
  if (!firebase) return;
  await signOut(firebase.auth);
};
