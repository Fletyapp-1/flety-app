import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAoNOFXdJ4z5cV0OHZ-yuZ2ehjL7NFZ_OY",
  authDomain: "flety-app-74d0d.firebaseapp.com",
  projectId: "flety-app-74d0d",
  storageBucket: "flety-app-74d0d.firebasestorage.app",
  messagingSenderId: "504227324693",
  appId: "1:504227324693:web:d813c05d80b21354aa7f1c"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const storage = getStorage(app);
