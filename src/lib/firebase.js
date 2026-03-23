// src/lib/firebase.js — Firebase initialization
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db   = getDatabase(app)
export default app
