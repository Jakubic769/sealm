// src/lib/firebaseAuth.js — Firebase Auth wrapper
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
} from 'firebase/auth'
import { ref, set, get, serverTimestamp } from 'firebase/database'
import { auth, db } from './firebase'

// Create user profile in Realtime DB
async function createProfile(uid, username, email) {
  await set(ref(db, `users/${uid}`), {
    uid,
    username,
    email,
    avatarUrl: null,
    bio: '',
    createdAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
    online: true,
    playtimeMinutes: 0,
    gamesCount: 0,
  })
}

export async function firebaseRegister({ username, email, password }) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName: username })
    await createProfile(cred.user.uid, username, email)
    return { success: true, user: { id: cred.user.uid, uid: cred.user.uid, username, email } }
  } catch(e) {
    return { success: false, error: firebaseError(e.code) }
  }
}

export async function firebaseLogin({ email, password }) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    // Update online status
    await set(ref(db, `users/${cred.user.uid}/online`), true)
    await set(ref(db, `users/${cred.user.uid}/lastSeen`), serverTimestamp())
    // Get profile
    const snap = await get(ref(db, `users/${cred.user.uid}`))
    const profile = snap.val() || {}
    const user = {
      id:        cred.user.uid,
      uid:       cred.user.uid,
      username:  profile.username || cred.user.displayName || email.split('@')[0],
      email:     cred.user.email,
      avatarUrl: profile.avatarUrl || null,
      bio:       profile.bio || '',
    }
    return { success: true, user }
  } catch(e) {
    return { success: false, error: firebaseError(e.code) }
  }
}

export async function firebaseLogout(uid) {
  try {
    if (uid) {
      await set(ref(db, `users/${uid}/online`), false)
      await set(ref(db, `users/${uid}/lastSeen`), serverTimestamp())
    }
    await signOut(auth)
    return { success: true }
  } catch(e) {
    return { success: false, error: e.message }
  }
}

export async function firebaseUpdateProfile({ uid, username, avatarUrl, bio, password }) {
  try {
    const updates = {}
    if (username)  updates.username  = username
    if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl
    if (bio !== undefined) updates.bio = bio

    if (Object.keys(updates).length > 0) {
      await set(ref(db, `users/${uid}`), {
        ...(await get(ref(db, `users/${uid}`))).val(),
        ...updates,
      })
    }
    if (username && auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: username })
    }
    return { success: true }
  } catch(e) {
    return { success: false, error: e.message }
  }
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb)
}

function firebaseError(code) {
  const errors = {
    'auth/email-already-in-use':  'Email already in use',
    'auth/weak-password':         'Password too weak (min 6 chars)',
    'auth/user-not-found':        'No account with this email',
    'auth/wrong-password':        'Wrong password',
    'auth/invalid-email':         'Invalid email address',
    'auth/too-many-requests':     'Too many attempts — try again later',
    'auth/invalid-credential':    'Wrong email or password',
  }
  return errors[code] || `Auth error: ${code}`
}
