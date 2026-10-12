
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

// ErenApi Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDHVz6WjtPHEAjp9aq9bN_bfioqtA8LOlY",
  authDomain: "erenapi.firebaseapp.com",
  databaseURL: "https://erenapi-default-rtdb.firebaseio.com",
  projectId: "erenapi",
  storageBucket: "erenapi.firebasestorage.app",
  messagingSenderId: "272509902180",
  appId: "1:272509902180:web:6750735f816700aa5bae71"
};

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getDatabase(app);

provider.setCustomParameters({
  prompt: "select_account"
});

export {
  app,
  auth,
  provider,
  db,
  ref,
  get,
  set,
  update,
  signInWithPopup,
  signOut,
  onAuthStateChanged
};
