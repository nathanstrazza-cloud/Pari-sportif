const firebaseConfig = {
  apiKey: "AIzaSyA0VuVlNZUURoe9P3Qmx7Lpb23qHt6LFjM",
  authDomain: "lacoteadede.firebaseapp.com",
  projectId: "lacoteadede",
  storageBucket: "lacoteadede.firebasestorage.app",
  messagingSenderId: "80895381924",
  appId: "1:80895381924:web:71ca5e51980c10ed13b131",
  measurementId: "G-BZJCLWJEHV",
};

const FIREBASE_VERSION = "10.12.5";
const FIREBASE_APP_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`;
const FIREBASE_AUTH_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`;

const authEls = {};

document.addEventListener("DOMContentLoaded", initAuth);

async function initAuth() {
  cacheAuthElements();
  lockApp();
  bindAccountMenu();
  setAuthLoading(true);

  try {
    const [{ initializeApp }, authModule] = await Promise.all([
      import(FIREBASE_APP_URL),
      import(FIREBASE_AUTH_URL),
    ]);
    const {
      GoogleAuthProvider,
      browserLocalPersistence,
      getAuth,
      onAuthStateChanged,
      setPersistence,
      signInWithPopup,
      signOut,
    } = authModule;

    const firebaseApp = initializeApp(firebaseConfig);
    const auth = getAuth(firebaseApp);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    await setPersistence(auth, browserLocalPersistence);

    authEls.signInButton?.addEventListener("click", async () => {
      setAuthLoading(true, "Ouverture de Google...");
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        showAuthError(readableAuthError(error));
      }
    });

    authEls.signOutButton?.addEventListener("click", async () => {
      closeAccountMenu();
      try {
        await signOut(auth);
      } catch (error) {
        showAuthError(readableAuthError(error));
      }
    });

    onAuthStateChanged(
      auth,
      (user) => updateAuthState(user),
      (error) => showAuthError(readableAuthError(error)),
    );
  } catch (error) {
    showAuthError("Connexion Google momentanément indisponible. Vérifiez votre connexion internet puis réessayez.");
    console.error("Firebase Authentication initialization failed", error);
  }
}

function cacheAuthElements() {
  authEls.overlay = document.querySelector("#authOverlay");
  authEls.status = document.querySelector("#authStatus");
  authEls.signInButton = document.querySelector("#googleSignInButton");
  authEls.accountWidget = document.querySelector("#accountWidget");
  authEls.accountButton = document.querySelector("#accountMenuButton");
  authEls.accountMenu = document.querySelector("#accountMenu");
  authEls.accountAvatar = document.querySelector("#accountAvatar");
  authEls.accountMenuAvatar = document.querySelector("#accountMenuAvatar");
  authEls.accountName = document.querySelector("#accountName");
  authEls.accountEmail = document.querySelector("#accountEmail");
  authEls.signOutButton = document.querySelector("#signOutButton");
  authEls.app = document.querySelector("#app");
  authEls.navigation = document.querySelector(".bottom-tabs");
}

function updateAuthState(user) {
  if (user) {
    unlockApp();
    fillAccount(user);
    setAuthLoading(false);
    return;
  }

  lockApp();
  clearAccount();
  setAuthLoading(false, "Connectez-vous pour continuer.");
}

function lockApp() {
  document.body.classList.remove("is-authenticated");
  document.body.classList.add("auth-pending");
  setSurfaceAccess(false);
  if (authEls.accountWidget) authEls.accountWidget.hidden = true;
}

function unlockApp() {
  document.body.classList.add("is-authenticated");
  document.body.classList.remove("auth-pending");
  setSurfaceAccess(true);
  if (authEls.accountWidget) authEls.accountWidget.hidden = false;
}

function setSurfaceAccess(isAccessible) {
  [authEls.app, authEls.navigation].forEach((surface) => {
    if (!surface) return;
    surface.inert = !isAccessible;
    surface.setAttribute("aria-hidden", String(!isAccessible));
  });
}

function fillAccount(user) {
  const fallbackName = user.email || "Compte Google";
  const photo = user.photoURL || "logo.jpg";
  authEls.accountAvatar?.setAttribute("src", photo);
  authEls.accountMenuAvatar?.setAttribute("src", photo);
  if (authEls.accountName) authEls.accountName.textContent = user.displayName || fallbackName;
  if (authEls.accountEmail) authEls.accountEmail.textContent = user.email || "";
}

function clearAccount() {
  closeAccountMenu();
  authEls.accountAvatar?.setAttribute("src", "logo.jpg");
  authEls.accountMenuAvatar?.setAttribute("src", "logo.jpg");
  if (authEls.accountName) authEls.accountName.textContent = "Compte Google";
  if (authEls.accountEmail) authEls.accountEmail.textContent = "";
}

function setAuthLoading(isLoading, message = "Vérification de la connexion...") {
  if (authEls.signInButton) {
    authEls.signInButton.disabled = isLoading;
    authEls.signInButton.classList.toggle("is-loading", isLoading);
  }
  if (authEls.status) {
    authEls.status.textContent = message;
    authEls.status.classList.remove("is-error");
  }
}

function showAuthError(message) {
  if (authEls.signInButton) {
    authEls.signInButton.disabled = false;
    authEls.signInButton.classList.remove("is-loading");
  }
  if (authEls.status) {
    authEls.status.textContent = message;
    authEls.status.classList.add("is-error");
  }
}

function bindAccountMenu() {
  authEls.accountButton?.addEventListener("click", () => {
    const shouldOpen = authEls.accountMenu?.hidden ?? true;
    setAccountMenuOpen(shouldOpen);
  });

  document.addEventListener("click", (event) => {
    if (!authEls.accountWidget?.contains(event.target)) {
      closeAccountMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAccountMenu();
  });
}

function setAccountMenuOpen(isOpen) {
  if (authEls.accountMenu) authEls.accountMenu.hidden = !isOpen;
  authEls.accountButton?.setAttribute("aria-expanded", String(isOpen));
}

function closeAccountMenu() {
  setAccountMenuOpen(false);
}

function readableAuthError(error) {
  const code = error?.code || "";
  if (code.includes("popup-closed-by-user")) return "Connexion annulée.";
  if (code.includes("popup-blocked")) return "Le navigateur a bloqué la fenêtre Google. Autorisez les pop-ups puis réessayez.";
  if (code.includes("unauthorized-domain")) return "Ce domaine n'est pas encore autorisé dans Firebase Authentication.";
  return "Connexion Google impossible pour le moment. Réessayez dans quelques instants.";
}
