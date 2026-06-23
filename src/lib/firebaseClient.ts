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

export const signInWithGoogle = async () => {
  const firebase = getFirebaseServices();
  if (!firebase) throw new Error("Firebase 설정이 없습니다. .env에 Firebase 웹 앱 설정을 입력하세요.");
  const provider = new GoogleAuthProvider();
  return signInWithPopup(firebase.auth, provider);
};

export const signOutFirebase = async () => {
  const firebase = getFirebaseServices();
  if (!firebase) return;
  await signOut(firebase.auth);
};
