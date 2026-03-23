// src/lib/firebase.js — Firebase initialization
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: "AIzaSyD5_mSu6EuAbdQLsAB-coSgfYfknJqUKjA",
  authDomain: "sealm-launcher.firebaseapp.com",
  databaseURL: "https://sealm-launcher-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "sealm-launcher",
  storageBucket: "sealm-launcher.firebasestorage.app",
  messagingSenderId: "324612216576",
  appId: "1:324612216576:web:cbd041583abc14fd1485e5"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db   = getDatabase(app)
export default app
