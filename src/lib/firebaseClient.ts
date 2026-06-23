import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getRedirectResult,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User
} from "firebase/auth";
import {
  enableIndexedDbPersistence,
  getFirestore,
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
  const db = getFirestore(app);
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
  provider.addScope("https://www.googleapis.com/auth/drive.appdata");
  provider.setCustomParameters({
    prompt: "select_account"
  });
  return provider;
};

export const signInWithGoogle = async () => {
  const firebase = getFirebaseServices();
  if (!firebase) throw new Error("Firebase 설정이 없습니다. .env에 Firebase 웹 앱 설정을 입력하세요.");
  const provider = createGoogleProvider();
  try {
    const result = await signInWithPopup(firebase.auth, provider);
    return result.user;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (
      code === "auth/popup-blocked" ||
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    ) {
      window.alert("팝업이 차단되어 전체 화면 로그인으로 전환합니다.");
      await signInWithRedirect(firebase.auth, provider);
      return null;
    }
    throw error;
  }
};

export const handleRedirectLoginResult = async () => {
  const firebase = getFirebaseServices();
  if (!firebase) return null;
  try {
    const result = await getRedirectResult(firebase.auth);
    return result?.user ?? null;
  } catch (error) {
    console.error("Redirect login error:", error);
    throw error;
  }
};

export const signOutFirebase = async () => {
  const firebase = getFirebaseServices();
  if (!firebase) return;
  await signOut(firebase.auth);
};
