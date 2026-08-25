import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyATfjd26BSazWYz6WXogw4LAa_NSBhiHUI",
  authDomain: "cardiac-analysis.firebaseapp.com",
  projectId: "cardiac-analysis",
  storageBucket: "cardiac-analysis.firebasestorage.app",
  messagingSenderId: "1606382374",
  appId: "1:1606382374:web:41e29e6053fccd6b1a47e7",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getFirestore(app);

export default app;