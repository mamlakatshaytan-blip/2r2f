import { initializeApp } from 'firebase/app';

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously
} from 'firebase/auth';

import {
  initializeFirestore
} from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyBlf3gTlfQks1r_AzupYnNjjTLjpvkNivY",
  authDomain: "shakar-3068d.firebaseapp.com",
  projectId: "shakar-3068d",
  storageBucket: "shakar-3068d.firebasestorage.app",
  messagingSenderId: "130328502805",
  appId: "1:130328502805:web:c24960a37827158d63a41c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true
});

// Initialize Auth
export const auth = getAuth(app);

// Google Provider
export const googleProvider = new GoogleAuthProvider();

// Google Sign In
export const signWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    console.error("Google Auth Error:", error);

    if (error.code === 'auth/popup-blocked') {
      alert("Popup block کراوە.");
    }

    throw error;
  }
};

// Guest Sign In
export const signInAsGuest = async () => {
  try {
    return await signInAnonymously(auth);
  } catch (error: any) {
    console.error("Guest Auth Error:", error);
    throw error;
  }
};