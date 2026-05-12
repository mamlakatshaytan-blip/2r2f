import React, { useState, useEffect } from "react";
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  updateDoc, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp,
  Timestamp,
  getDoc,
  getDocFromServer,
  getDocs,
  writeBatch,
  enableNetwork,
  disableNetwork,
  where,
  runTransaction
} from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { motion, AnimatePresence } from "motion/react";
import { 
  Trophy, 
  User as UserIcon, 
  Plus, 
  ArrowRight, 
  LogOut, 
  RefreshCcw,
  Gamepad2,
  Users,
  Copy,
  Check,
  Zap,
  AlertCircle,
  WifiOff
} from "lucide-react";
import confetti from "canvas-confetti";

const timeoutPromise = (ms: number) => new Promise((_, reject) => 
  setTimeout(() => reject(new Error("Timeout")), ms)
);

import { db, auth, signWithGoogle, signInAsGuest, handleFirestoreError, OperationType, firebaseConfig, forceNetworkReset } from "./firebase";
import { GameData, GameStatus, Guess } from "./types";

// --- Utils ---
const calculateResult = (guess: string, secret: string) => {
  if (guess === secret) return "4R";
  let r = 0;
  let f = 0;
  const guessArr = guess.split("");
  const secretArr = secret.split("");
  
  const remainingSecret: string[] = [];
  const remainingGuess: string[] = [];
  
  for(let i=0; i<4; i++) {
    if (guessArr[i] === secretArr[i]) {
      r++;
    } else {
      remainingSecret.push(secretArr[i]);
      remainingGuess.push(guessArr[i]);
    }
  }
  
  for(let i=0; i<remainingGuess.length; i++) {
    const foundIndex = remainingSecret.indexOf(remainingGuess[i]);
    if (foundIndex !== -1) {
      f++;
      remainingSecret.splice(foundIndex, 1);
    }
  }
  
  if (r === 0 && f === 0) return "4N";
  let res = "";
  if (r > 0) res += `${r}R`;
  if (f > 0) res += `${f}F`;
  return res;
};

// --- Main Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [currentGame, setCurrentGame] = useState<GameData | null>(null);
  const [availableGames, setAvailableGames] = useState<GameData[]>([]);
  const [mySecret, setMySecret] = useState<string>("");
  const [opponentSecret, setOpponentSecret] = useState<string | null>(null);
  const [opponentData, setOpponentData] = useState<any>(null);
  const [inputGuess, setInputGuess] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Auth Listener
  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) {
        setLoadingTimeout(true);
      }
    }, 15000); // Increased timeout to 15s for slower connections

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      clearTimeout(timer);
      console.log("APP_LOG: Auth State Changed. UserID:", u?.uid || "NONE");
      setUser(u);
      setLoading(false);
      
      if (u) {
        console.log("APP_LOG: User authenticated, enabling network...");
        enableNetwork(db).catch(e => console.warn("APP_LOG: enableNetwork failed:", e));
        
        const userRef = doc(db, "users", u.uid);
        console.log("APP_LOG: Updating user profile:", u.uid);
        setDoc(userRef, {
          displayName: u.displayName || `میوان ${u.uid.slice(0, 4)}`,
          photoURL: u.photoURL,
          isOnline: true,
          lastSeen: serverTimestamp()
        }, { merge: true }).then(() => {
          console.log("APP_LOG: Profile update success");
        }).catch(err => {
          console.error("APP_LOG: User profile update failed:", err);
        });

        const interval = setInterval(() => {
          updateDoc(doc(db, "users", u.uid), {
            lastSeen: serverTimestamp(),
            isOnline: true
          }).catch(() => {});
        }, 30000);

        return () => clearInterval(interval);
      } else {
        console.log("No user, attempting guest sign-in...");
        // ئۆتۆماتیکی وەک میوان دەچێتە ژوورەوە ئەگەر یوزەر نەبوو
        signInAsGuest().catch((e: any) => {
          console.error("Guest login failed:", e);
          if (e.code === 'auth/operation-not-allowed' || e.code === 'auth/admin-restricted-operation') {
            setError('anonymous_disabled');
          } else {
            setError("کێشەیەک لە چوونە ژوورەوە وەک میوان ڕوویدا: " + e.message);
          }
        });
        setCurrentGameId(null);
        setCurrentGame(null);
      }
    }, (err) => {
      console.error("Auth listener failed:", err);
      setError("کێشەیەک لە سیستەمی چوونە ژوورەوەدا هەیە.");
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const [localGame, setLocalGame] = useState<GameData | null>(null);
  const [localBotSecret, setLocalBotSecret] = useState<string | null>(null);
  const [localMySecret, setLocalMySecret] = useState<string>("");

  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | null>(null);
  const [creatingGame, setCreatingGame] = useState(false);
  const [isJoiningByCode, setIsJoiningByCode] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Connection Monitor
  useEffect(() => {
    let healthInterval: any;
    if (user) {
      console.log("APP_LOG: Starting connection monitor for user:", user.uid);
      healthInterval = setInterval(async () => {
        // Use browser navigator status as additional signal
        if (!navigator.onLine) {
          setIsOnline(false);
          return;
        }

        try {
          // A lighter ping to just check reachability
          const timeout = new Promise((_, r) => setTimeout(() => r(new Error("Timeout")), 15000));
          await Promise.race([getDocFromServer(doc(db, "health", "status")), timeout]);
          setIsOnline(true);
        } catch (e: any) {
          // If it's a timeout but other things work, don't flip the UI immediately
          // but if it's 'unavailable', it's a strong signal.
          if (e.code === "unavailable" || e.message?.includes("offline")) {
            setIsOnline(false);
          }
        }
      }, 40000); 
    }
    return () => clearInterval(healthInterval);
  }, [user]);

  const testFirebaseConnection = async () => {
    setCheckingConnection(true);
    try {
      console.log("APP_LOG: Manual connection test started...");
      // Try to re-enable network first
      await disableNetwork(db).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      await enableNetwork(db);
      
      // Attempt to fetch health doc with a shorter timeout
      await (Promise.race([getDoc(doc(db, "health", "check")), timeoutPromise(10000)]) as Promise<any>);
      setError(null);
      setIsOnline(true);
      alert("پەیوەندی بە فایەربەیس سەرکەوتوو بوو!");
    } catch (e: any) {
      console.error("Connection test failed:", e);
      if (e.code === 'permission-denied') {
        alert("پەیوەندی سەرکەوتوو بوو (ڕێگەپێدانی داتابەیس چالاکە).");
        setIsOnline(true);
        setError(null);
      } else if (e.message?.includes("offline") || e.code === "unavailable" || e.message === "Timeout") {
        setIsOnline(false);
        // Automatically try to reset once
        console.log("APP_LOG: Test failed, attempting auto-reset...");
        await forceNetworkReset().catch(() => {});
        alert("فایەربەیس 'Offline'ـە یان پەیوەندی خاوە. پەیوەندییەکەمان دووبارە ڕێکخستەوە، تکایە دووبارە هەوڵ بدەرەوە.");
      } else {
        alert("کێشەیەک لە پەیوەندی هەیە: " + (e.code || e.message));
      }
    } finally {
      setCheckingConnection(false);
    }
  };

  // Deep Link & Auth settled handler
  useEffect(() => {
    if (!user || currentGameId) return;
    console.log("APP_LOG: Checking deep links...");
    const params = new URLSearchParams(window.location.search);
    const joinId = params.get("join")?.toUpperCase();
    if (joinId) {
      console.log("APP_LOG: Found join ID in URL:", joinId);
      setJoiningId(joinId);
      joinGame(joinId).finally(() => {
        setJoiningId(null);
        window.history.replaceState({}, document.title, window.location.pathname);
      });
    }
  }, [user]);

  // Lobby Listener
  useEffect(() => {
    if (!user || currentGameId) {
      setAvailableGames([]);
      return;
    }
    console.log("APP_LOG: Starting lobby listener...");

    const q = query(collection(db, "games"), orderBy("createdAt", "desc"), limit(20));
    
    const fetchLobby = async (retry = 0) => {
      try {
        const snapshot = await getDocs(q);
        console.log("APP_LOG: Lobby fetch success:", snapshot.size);
        const games = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GameData));
        setAvailableGames(games.filter(g => g.status === "waiting" || g.playerX === user.uid || g.playerO === user.uid));
      } catch (err: any) {
        console.warn(`APP_LOG: Lobby fetch error (Attempt ${retry}):`, err);
        if (retry < 2) {
          // If offline/unavailable, try resetting network
          if (err.message?.includes("offline") || err.code === "unavailable") {
            forceNetworkReset().catch(() => {});
          }
          // Wait and retry
          setTimeout(() => fetchLobby(retry + 1), 3000 * (retry + 1));
        }
      }
    };

    fetchLobby();

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const games = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as GameData));
      setAvailableGames(games.filter(g => g.status === "waiting" || g.playerX === user.uid || g.playerO === user.uid));
    }, (err) => {
      console.error("Lobby onSnapshot failed:", err);
      if (err.message.includes('unavailable') || err.code === 'unavailable') {
        setError("ناتوانین لیستی یارییەکان نوێ بکەینەوە. دڵنیابە لە Firestore Database داتابەیسەکەت دروست کردووە.");
      }
    });
    return unsubscribe;
  }, [user, currentGameId]);

  // Game/Secrets Listener
  useEffect(() => {
    if (!currentGameId || !user) {
      setCurrentGame(null);
      return;
    }
    
    if (currentGameId === "LOCAL-BOT") {
      setCurrentGame(localGame);
      setMySecret(localMySecret);
      return;
    }
    
    const unsubGame = onSnapshot(doc(db, "games", currentGameId), (d) => {
      if (d.exists()) {
        const data = { id: d.id, ...d.data() } as GameData;
        setCurrentGame(data);
      } else {
        setCurrentGameId(null);
      }
    }, (err) => {
      if (auth.currentUser) handleFirestoreError(err, OperationType.GET, `games/${currentGameId}`);
    });

    const unsubMySecret = onSnapshot(doc(db, "games", currentGameId, "secrets", user.uid), (d) => {
      if (d.exists()) setMySecret(d.data().value);
      else setMySecret("");
    }, (err) => {
      console.error("Error listening to MY secret:", err);
    });

    return () => {
      unsubGame();
      unsubMySecret();
    };
  }, [currentGameId, user]);

  // Listen to Opponent Data
  useEffect(() => {
    if (!currentGame || !user) {
      setOpponentSecret(null);
      return;
    }
    const opponentId = user.uid === currentGame.playerX ? currentGame.playerO : currentGame.playerX;
    if (!opponentId) {
      setOpponentSecret(null);
      return;
    }

    if (currentGameId === "LOCAL-BOT") {
      setOpponentSecret(localBotSecret);
      return;
    }

    const unsubOppSecret = onSnapshot(doc(db, "games", currentGame.id, "secrets", opponentId), (d) => {
      if (d.exists()) setOpponentSecret(d.data().value);
      else setOpponentSecret(null);
    });

    let unsubOppData = () => {};
    if (opponentId && opponentId !== "BOT") {
      unsubOppData = onSnapshot(doc(db, "users", opponentId), (d) => {
        if (d.exists()) setOpponentData(d.data());
      });
    } else if (opponentId === "BOT") {
      setOpponentData({ displayName: "BOT AI", isOnline: true });
    }

    return () => {
      unsubOppSecret();
      unsubOppData();
    };
  }, [currentGame, user]);

  // Auto-transition to playing
  useEffect(() => {
    if (!currentGame || currentGame.status !== "setting_secrets" || !user) return;
    const isBothReady = mySecret.length === 4 && opponentSecret && opponentSecret.length === 4;
    
    if (isBothReady && user.uid === currentGame.playerX) { 
      const firstTurn = Math.random() > 0.5 ? currentGame.playerX : (currentGame.playerO || "BOT");
      updateDoc(doc(db, "games", currentGame.id), {
        status: "playing",
        turn: firstTurn,
        updatedAt: serverTimestamp()
      }).catch(err => console.error(err));
    }
  }, [mySecret, opponentSecret, currentGame?.status, currentGame?.id, user?.uid]);

  // Actions
  const handleAutoMatch = async (retryArg: any = 0) => {
    const retryCount = typeof retryArg === 'number' ? retryArg : 0;
    if (!user || creatingGame) return;
    setCreatingGame(true);
    setError(null);
    
    try {
      if (retryCount > 0) {
        console.log(`Auto-match: Retry attempt ${retryCount}, forcing network reset...`);
        await forceNetworkReset();
      }

      // 1. Try local state first (fastest)
      const otherAvailableGames = availableGames.filter(g => g.status === "waiting" && g.playerX !== user.uid);
      
      if (otherAvailableGames.length > 0) {
        const randomGame = otherAvailableGames[Math.floor(Math.random() * otherAvailableGames.length)];
        console.log("Auto-match (Local): Found a game to join:", randomGame.id);
        await joinGame(randomGame.id);
        return;
      }

      // 2. Fallback to a simple Firestore query
      console.log("Auto-match: Searching Firestore for available games...");
      const q = query(
        collection(db, "games"), 
        where("status", "==", "waiting"), 
        limit(20)
      );
      const snapshot = await (Promise.race([getDocs(q), timeoutPromise(30000)]) as Promise<any>);
      
      const otherGames = snapshot.docs.filter((d: any) => d.data().playerX !== user.uid);
      
      if (otherGames.length > 0) {
        const randomGame = otherGames[Math.floor(Math.random() * otherGames.length)];
        console.log("Auto-match (Firestore): Found a game:", randomGame.id);
        await joinGame(randomGame.id);
        return;
      }

      console.log("Auto-match: No game found, creating a new waiting room...");
      await createGame(true);
    } catch (err: any) {
      console.error(`Auto-match error (Attempt ${retryCount}):`, err);
      if (err.message === "Timeout" && retryCount < 1) {
        setCreatingGame(false); // reset so the recursive call can proceed
        return handleAutoMatch(retryCount + 1);
      }
      await createGame(true);
    } finally {
      setCreatingGame(false);
    }
  };

  const createGame = async (isAuto = false, retryArg: any = 0) => {
    const retryCount = typeof retryArg === 'number' ? retryArg : 0;
    if (!user || (creatingGame && !isAuto)) return;
    if (!isAuto) setCreatingGame(true);
    setError(null);
    
    try {
      console.log(`APP_LOG: Starting createGame process (Attempt ${retryCount}). User: ${user?.uid}`);
      
      // Before attempting to create, do a fast reachability check if we suspect we're offline or in retry
      if (retryCount > 0 || !isOnline) {
        console.log("APP_LOG: Pre-creation reachability test...");
        try {
          await Promise.race([getDocFromServer(doc(db, "health", "status")), timeoutPromise(5000)]);
          console.log("APP_LOG: Reachability test PASS.");
        } catch (e) {
          console.warn("APP_LOG: Reachability test FAIL, forcing network reset...");
          await forceNetworkReset().catch(() => {});
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      const gameId = Math.random().toString(36).substring(2, 8).toUpperCase();
      console.log(`APP_LOG: Creating game payload: ${gameId}`);
      
      const gameData = {
        playerX: user.uid,
        status: "waiting",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        guessesX: [],
        guessesO: []
      };

      const duration = retryCount === 0 ? 30000 : 60000;
      console.log(`APP_LOG: Invoking setDoc with ${duration}ms timeout... (GameId: ${gameId})`);
      
      await (Promise.race([
        setDoc(doc(db, "games", gameId), gameData), 
        timeoutPromise(duration)
      ]));
      
      console.log("APP_LOG: Game created successfully:", gameId);
      setCurrentGameId(gameId);
      setIsOnline(true);
    } catch (err: any) { 
      console.error(`APP_LOG: Create Game ERROR (Attempt ${retryCount}):`, err);
      
      const isTimeout = err.message === "Timeout";
      const isUnavailable = err.code === "unavailable" || err.message?.includes("offline") || err.message?.includes("network") || err.message?.includes("failed");

      if ((isTimeout || isUnavailable) && retryCount < 5) {
        const backoff = (retryCount + 1) * 3000;
        console.log(`APP_LOG: Retrying createGame in ${backoff}ms (Attempt ${retryCount + 1})...`);
        setIsOnline(false);
        // Stepwise escalation of resets
        if (retryCount === 1) {
          console.log("APP_LOG: Attempt 1 failed, resetting network...");
          forceNetworkReset().catch(() => {});
        } else if (retryCount === 2) {
          console.log("APP_LOG: Attempt 2 failed, forcing long polling check...");
          // In some browsers, long polling might be the issue, or lack of it
        }

        await new Promise(r => setTimeout(r, backoff));
        return createGame(isAuto, retryCount + 1);
      }

      let displayError = err.message;
      if (err.code) displayError = `${err.code}: ${err.message}`;

      if (err.message === "Timeout") {
        setError("پەیوەندی فایەربەیس خاوە. پەیجەکە نوێ بکەرەوە و دووبارە هەوڵ بدەرەوە.");
      } else if (err.code === 'permission-denied') {
        setError("دەسەڵاتی دروستکردنی یاریت نییە. پشکنە کە Firestore Rules جێبەجێ کراوە.");
      } else {
        setError("کێشەیەک لە دروستکردنی کایەدا ڕوویدا: " + (err.code || displayError));
      }
    } finally {
      if (!isAuto) setCreatingGame(false);
    }
  };

  const createBotGame = async (retryArg: any = 0) => {
    const retryCount = typeof retryArg === 'number' ? retryArg : 0;
    if (!user || (creatingGame && retryCount === 0)) return;
    setCreatingGame(true);
    setError(null);

    const attemptCreateBot = async (innerRetry = 0): Promise<void> => {
      try {
        console.log(`APP_LOG: Starting BOT game creation (Attempt ${innerRetry})...`);
        if (innerRetry > 0) {
          console.log(`BOT Game: Retry attempt ${innerRetry}, forcing network reset...`);
          await forceNetworkReset();
        }

        // Fast ping before complex batch write
        await Promise.race([getDocFromServer(doc(db, "health", "status")), timeoutPromise(8000)]).catch(() => {});

        const gameId = "BOT-" + Math.random().toString(36).substring(2, 8).toUpperCase();
        console.log(`Attempting to create BOT game: ${gameId}`);
        const botSecret = Array.from({ length: 10 }, (_, i) => i)
          .sort(() => Math.random() - 0.5)
          .slice(0, 4)
          .join("");
          
        const gameData: any = {
          playerX: user.uid,
          playerO: "BOT",
          status: "setting_secrets",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          guessesX: [],
          guessesO: []
        };

        const batch = writeBatch(db);
        const gameRef = doc(db, "games", gameId);
        batch.set(gameRef, gameData);
        const secretRef = doc(db, "games", gameId, "secrets", "BOT");
        batch.set(secretRef, { value: botSecret });
        
        const botTimeout = innerRetry === 0 ? 30000 : 60000;
        await (Promise.race([batch.commit(), timeoutPromise(botTimeout)]));
        console.log("BOT Game created successfully:", gameId);
        setCurrentGameId(gameId);
        setIsOnline(true);
      } catch (firestoreError: any) {
        if (firestoreError.message === "Timeout" && innerRetry < 1) {
          return attemptCreateBot(innerRetry + 1);
        }
        
        console.warn("Firestore failed for bot game, falling back to local mode:", firestoreError);
        // Fallback to local state for total offline play
        const botSecretOffline = Array.from({ length: 10 }, (_, i) => i)
          .sort(() => Math.random() - 0.5)
          .slice(0, 4)
          .join("");
          
        const localData = {
          playerX: user.uid,
          playerO: "BOT",
          status: "setting_secrets",
          guessesX: [],
          guessesO: [],
          createdAt: { toMillis: () => Date.now() },
          updatedAt: { toMillis: () => Date.now() },
          id: "LOCAL-BOT"
        } as any;
        setLocalGame(localData);
        setLocalBotSecret(botSecretOffline);
        setCurrentGameId("LOCAL-BOT");
      }
    };

    try {
      await attemptCreateBot();
    } catch (err: any) { 
      console.error("Create Bot Game Error:", err);
      let displayError = err.message;
      try {
        const parsed = JSON.parse(err.message);
        displayError = parsed.error || err.message;
      } catch (e) {}

      if (err.message === "Timeout") {
        setError("دروستکردنی یاری لەگەڵ بۆت کاتی زۆری خایاند. دووبارە هەوڵ بدەرەوە.");
      } else if (err.code === 'permission-denied') {
        setError("دەسەڵاتی دروستکردنی یاریت نییە. پشکنە کە Firestore Rules جێبەجێ کراوە.");
      } else {
        setError("کێشەیەک لە دروستکردنی کایە لەگەڵ بۆت ڕوویدا: " + (err.code || displayError));
      }
    } finally {
      setCreatingGame(false);
    }
  };

  const joinGame = async (id: string, retryCount = 0) => {
    if (!user) return;
    setError(null);
    const isManualJoin = !joiningId;
    if (isManualJoin) setIsJoiningByCode(true);

    try {
      console.log(`Attempting to join game: ${id} (Attempt ${retryCount + 1})`);
      
      if (retryCount > 0) {
        await enableNetwork(db).catch(() => {});
      }

      const gameRef = doc(db, "games", id);
      console.log(`Fetching game doc: ${id}`);
      
      // Attempt to get the document with a shorter initial timeout for faster failover
      const d = await (Promise.race([
        getDoc(gameRef), 
        timeoutPromise(10000)
      ]) as Promise<any>).catch(async (e) => {
        console.warn("Initial fetch failed, retrying once with network enabled:", e.message);
        await enableNetwork(db).catch(() => {});
        return await (Promise.race([getDoc(gameRef), timeoutPromise(15000)]) as Promise<any>);
      });
      
      if (d && d.exists()) {
        const data = d.data() as GameData;
        console.log("Game document found:", data);
        if (data.playerX === user.uid || data.playerO === user.uid) {
          setCurrentGameId(id);
          if (isManualJoin) setIsJoiningByCode(false);
          return;
        }
        if (data.status === "waiting") {
          await (Promise.race([
            updateDoc(gameRef, {
              playerO: user.uid,
              status: "setting_secrets",
              updatedAt: serverTimestamp()
            }),
            timeoutPromise(20000)
          ]));
          setCurrentGameId(id);
        } else {
          setError("ئەو یارییە پڕ بووە یان دەستی پێکردووە.");
          setTimeout(() => setError(null), 3000);
        }
      } else {
        setError("یارییەکە نەدۆزرایەوە. دڵنیابە کۆدەکە ڕاستە.");
      }
    } catch (err: any) { 
      if (err.message === "Timeout" && retryCount < 1) {
        return joinGame(id, retryCount + 1);
      }
      if ((err.message?.includes("offline") || err.code === "unavailable") && retryCount < 2) {
        console.warn("Join Game: detected offline/unavailable, forcing reset and retry...");
        await forceNetworkReset().catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        return joinGame(id, retryCount + 1);
      }
      
      console.error("Join Game Error:", err);
      let displayError = err.message;
      try {
        const parsed = JSON.parse(err.message);
        displayError = parsed.error || err.message;
      } catch (e) {
        // Not a JSON error, use raw message
      }
      
      if (err.code === 'permission-denied') {
        setError("دەسەڵاتی بەشداری کردنت نییە. دڵنیابە چوونەژوورەوەت تەواوە.");
      } else {
        setError("کێشەیەک لە چوونەژوورەوە ڕوویدا: " + (err.code || displayError));
      }
    } finally {
      if (isManualJoin) setIsJoiningByCode(false);
    }
  };

  const setSecretNumber = async (num: string) => {
    if (!currentGameId || !user || num.length !== 4) return;
    try {
      if (currentGameId === "LOCAL-BOT") {
        setLocalMySecret(num);
        setMySecret(num);
        const newGame = { 
          ...localGame, 
          status: "playing",
          updatedAt: { toMillis: () => Date.now() }
        } as GameData;
        setLocalGame(newGame);
        setCurrentGame(newGame);
        return;
      }
      await setDoc(doc(db, "games", currentGameId, "secrets", user.uid), { value: num });
    } catch (err) { handleFirestoreError(err, OperationType.CREATE, `games/${currentGameId}/secrets/${user.uid}`); }
  };

  const submitGuess = async () => {
    if (!user || !currentGame || !opponentSecret || inputGuess.length !== 4 || currentGame.turn !== user.uid) return;
    const result = calculateResult(inputGuess, opponentSecret);
    const newGuess: Guess = { value: inputGuess, result, timestamp: Date.now() };
    const isWin = result === "4R";
    const update: any = {
      updatedAt: currentGame.id === "LOCAL-BOT" ? { toMillis: () => Date.now() } : serverTimestamp(),
      turn: user.uid === currentGame.playerX ? currentGame.playerO : currentGame.playerX
    };

    if (user.uid === currentGame.playerX) {
      update.guessesX = [...currentGame.guessesX, newGuess];
      if (isWin) {
        update.status = "X_won";
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }
    } else {
      update.guessesO = [...currentGame.guessesO, newGuess];
      if (isWin) {
        update.status = "O_won";
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
      }
    }

    if (currentGame.id === "LOCAL-BOT") {
      const newGame = { ...currentGame, ...update };
      setLocalGame(newGame);
      setCurrentGame(newGame);
      setInputGuess("");
      return;
    }

    try {
      await updateDoc(doc(db, "games", currentGame.id), update);
      setInputGuess("");
    } catch (err) { handleFirestoreError(err, OperationType.UPDATE, `games/${currentGame.id}`); }
  };

  useEffect(() => {
    if (!currentGame || currentGame.playerO !== "BOT" || currentGame.status !== "playing" || currentGame.turn !== "BOT" || !mySecret) return;
    const botThink = setTimeout(async () => {
      let guessValue = "";
      const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      while (guessValue.length < 4) guessValue += digits.splice(Math.floor(Math.random() * digits.length), 1)[0];
      const result = calculateResult(guessValue, mySecret);
      const newGuess: Guess = { value: guessValue, result, timestamp: Date.now() };
      const isWin = result === "4R";
      const update: any = { 
        updatedAt: currentGame.id === "LOCAL-BOT" ? { toMillis: () => Date.now() } : serverTimestamp(), 
        turn: currentGame.playerX, 
        guessesO: [...currentGame.guessesO, newGuess] 
      };
      if (isWin) update.status = "O_won";
      
      if (currentGame.id === "LOCAL-BOT") {
        const newGame = { ...currentGame, ...update };
        setLocalGame(newGame);
        setCurrentGame(newGame);
        return;
      }
      
      try { await updateDoc(doc(db, "games", currentGame.id), update); } catch (err) { console.error(err); }
    }, 2000);
    return () => clearTimeout(botThink);
  }, [currentGame, mySecret]);

  const leaveGame = () => setCurrentGameId(null);
  const copyGameId = async () => {
    if (!currentGameId) return;
    
    let origin = window.location.origin;
    // ئۆتۆماتیکی لینکی گەشەپێدان دەگۆڕین بۆ لینکی گشتی بۆ ئەوەی لای هاوڕێکەت کار بکات
    if (origin.includes("-dev-")) {
      origin = origin.replace("-dev-", "-pre-");
    }
    
    const shareUrl = `${origin}${window.location.pathname}?join=${currentGameId}`;
    
    // Try Web Share API first
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'بەشداری کایەی ٢ڕ٢ف بکە',
          text: `وەرە با کایەی ٢ڕ٢ف بکەین، ئەمە کۆدی یارییەکەیە: ${currentGameId}\nبزانین کێمان زیرەکترینین!`,
          url: shareUrl,
        });
        return;
      } catch (err) {
        console.log("Share failed or cancelled", err);
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for clipboard if it fails (e.g. non-secure origin)
      alert(`کۆدی یارییەکە: ${currentGameId}\n` + (origin.includes("-dev-") ? "تێبینی: پێویستە لە بەشی سەرەوەی ئەپەکە کلیک لە دوگمەی Share بکەیت بۆ ئەوەی هاوڕێکەت بتوانێت یارییەکە ببێنێت." : ""));
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center font-sans tracking-tight gap-8 p-6 text-white">
      <div className="w-12 h-12 border-2 border-[#F27D26] border-t-transparent rounded-full animate-spin" />
      <div className="text-center space-y-2">
        <p className="text-white/60 text-sm">تکایە چاوەڕێ بکە...</p>
        <p className="text-white/20 text-[10px]">خەریکی پەیوەندی کردنین بە فایەربەیس</p>
      </div>
      
      {loadingTimeout && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center max-w-sm">
          <p className="text-white/40 text-sm mb-6 italic leading-relaxed">
            وەک بڵێی پەیوەندییەکە کاتێکی زۆری خایاند... ئەگەر ئینتەرنێتت هەیە و هێشتا وایە، ڕەنگە فایەربەیس کێشەی هەبێت.
          </p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => window.location.reload()} 
              className="bg-white/10 text-white px-8 py-3 rounded-full font-bold text-sm border border-white/10 hover:bg-white/20 transition-all cursor-pointer"
            >
              دووبارە بارکردنەوە (Reload)
            </button>
            <button 
              onClick={() => forceNetworkReset()} 
              className="text-white/40 text-xs hover:text-white/60 transition-colors"
            >
              نوێکردنەوەی پەیوەندی (Network Reset)
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );

  if (!user) return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 font-sans">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <div className="w-20 h-20 bg-[#F27D26] rounded-3xl mx-auto flex items-center justify-center font-black text-4xl text-black mb-8 shadow-[0_20px_50px_rgba(242,125,38,0.3)]">2R</div>
        <h1 className="text-6xl font-black mb-4 tracking-tighter uppercase italic">2R 2F <span className="text-[#F27D26]">ONLINE</span></h1>
        <p className="opacity-40 mb-12 max-w-sm mx-auto text-lg leading-relaxed italic">یارییەکی ئۆنڵاینی زیرەکانه کۆدی بەرامبەر بشکێنە و براوە بە</p>
        <div className="flex flex-col gap-4 mx-auto max-w-xs">
          <button onClick={async () => {
            setError(null);
            try {
              await signWithGoogle();
            } catch (e: any) {
              if (e.code === 'auth/popup-closed-by-user') {
                setError("پەنجەرەی گووگڵت داخست، تکایە دووبارە هەوڵ بدەرەوە.");
              } else if (e.code === 'auth/popup-blocked') {
                setError("بڕاوسەرەکەت ڕێگری لە پۆپ-ئەپ کردووە. تکایە چالاکی بکە یان وەک میوان وەرە.");
              } else {
                setError("کێشەیەک لە چوونە ژوورەوە بە گووگڵ ڕوویدا: " + e.message);
              }
            }
          }} className="w-full bg-white text-black px-12 py-5 rounded-full font-bold text-xl hover:bg-[#F27D26] hover:text-white transition-all transform active:scale-95 flex items-center justify-center gap-4 border-4 border-transparent hover:border-white shadow-2xl cursor-pointer">
            <Gamepad2 className="w-6 h-6" /> چوونە ناو بە گووگڵ
          </button>
          
          <button onClick={async () => {
            setError(null);
            try {
              await signInAsGuest();
            } catch (e: any) {
              if (e.code === 'auth/admin-restricted-operation' || e.code === 'auth/operation-not-allowed') {
                 setError("anonymous_disabled");
              } else if (e.code === 'auth/network-request-failed') {
                 setError("network_error");
              } else {
                 setError("کێشەیەک ڕوویدا: " + e.message);
              }
            }
          }} className="w-full bg-white/5 text-white/60 px-12 py-4 rounded-full font-bold text-lg hover:bg-white/10 hover:text-white transition-all border border-white/10 cursor-pointer">
            وەک میوان وەرەژوورێ
          </button>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-500 text-xs text-right animate-in slide-in-from-top-2">
            <div className="font-bold mb-2 flex items-center justify-end gap-2 text-sm">
              کێشەیەک هەیە <AlertCircle className="w-4 h-4" />
            </div>
            <div className="opacity-80 leading-relaxed font-medium">
              {error === 'anonymous_disabled' ? (
                <div className="space-y-4">
                  <div className="bg-[#F27D26] text-black px-4 py-2 rounded-lg font-black text-xs inline-block uppercase italic">Firebase Setup Required</div>
                  <h3 className="text-xl font-bold text-white">کێشەی چالاککردنی فایەربەیس</h3>
                  <p className="text-white/60 text-xs leading-relaxed">
                    ئەم ئەپە پێویستی بەوەیە دەستکاری ڕێکخستنەکانی پڕۆژەی <span className="text-[#F27D26] font-bold">{firebaseConfig.projectId}</span> بکەیت لە کونسۆڵی فایەربەیس:
                  </p>
                  
                  <div className="space-y-3 text-right text-xs">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                      <span className="font-bold text-[#F27D26] block mb-1">١. چالاککردنی میوان (Anonymous)</span>
                      بڕۆ بۆ Authentication &gt; Sign-in method و Anonymous چالاک بکە و **Save** بکە.
                    </div>

                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                      <span className="font-bold text-[#F27D26] block mb-1">٢. ڕێگەپێدانی دۆمەین (Authorized Domains)</span>
                      بڕۆ بۆ Authentication &gt; Settings &gt; Authorized domains و ئەم دووانە زیاد بکە:
                      <div className="mt-2 flex flex-col gap-1 font-mono text-[9px] text-[#F27D26] select-all">
                        <code className="bg-black/40 p-1 rounded">{window.location.hostname}</code>
                        <code className="bg-black/40 p-1 rounded">{window.location.hostname.replace("-dev-", "-pre-")}</code>
                      </div>
                    </div>

                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                      <span className="font-bold text-[#F27D26] block mb-1">٣. کلیلی API (Google Cloud)</span>
                      بڕۆ بۆ Google Cloud Console، بەشی Credentials، دڵنیابە API Key ڕێگری لێنەکراوە (Don't restrict).
                    </div>
                  </div>

                  <button 
                    onClick={testFirebaseConnection}
                    disabled={checkingConnection}
                    className="w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                  >
                    {checkingConnection ? "چاوەڕوان بە..." : "تاقیکردنەوەی پەیوەندی"}
                    <RefreshCcw className={`w-3 h-3 ${checkingConnection ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              ) : error === 'network_error' ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="text-white font-bold">هەڵەی پەیوەندی هەیە <WifiOff className="w-3 h-3 inline ml-1" /></span>
                  دڵنیابە ئینتەرنێتەکەت کار دەکات و هیچ بەرنامەیەکی ڕێگر (AdBlocker) نییە.
                </div>
              ) : error}
            </div>
          </div>
        )}

        <div className="mt-8 space-y-3 opacity-40 italic max-w-xs mx-auto text-center">
          <p className="text-[10px] bg-white/5 p-2 rounded-lg border border-white/5">تێبینی ۱: ئەگەر لە ناو ئەپەکەیت و گووگڵ کار نەکرد، وەک میوان وەرەژوورێ.</p>
          <p className="text-[10px] bg-white/5 p-2 rounded-lg border border-white/5">تێبینی ۲: دڵنیابە کە 'pop-ups' لە بڕاوسەرەکەت چالاکە، بەتایبەت لە مۆبایل.</p>
          <p className="text-[10px] bg-white/5 p-2 rounded-lg border border-white/5 font-bold text-[#F27D26]">تێبینی ۳: پێویستە 'Anonymous Sign-in' کارا بکەیت لە Firebase Console بۆ ئەوەی میوان کار بکات.</p>
        </div>

        {new URLSearchParams(window.location.search).has("join") && (
          <div className="mt-8 p-8 bg-[#F27D26]/10 border-2 border-[#F27D26]/20 rounded-[2.5rem] shadow-2xl animate-in zoom-in duration-500 max-w-sm mx-auto">
             <div className="w-16 h-16 bg-[#F27D26] rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg rotate-3">
                <Users className="w-8 h-8 text-black" />
             </div>
             <h3 className="text-xl font-black text-[#F27D26] mb-2 uppercase italic tracking-tighter">بانگهێشت کراویت!</h3>
             <p className="text-sm opacity-60 mb-6 italic leading-relaxed">هاوڕێکەت چاوەڕێتە بۆ ئەوەی کایەی ٢ڕ٢ف بکەن. تکایە بچۆ ژوورەوە بۆ ئەوەی دەستپێبکەن.</p>
             <div className="flex items-center justify-center gap-2 text-[10px] font-bold opacity-30 uppercase tracking-[0.2em]">
                <div className="w-2 h-2 rounded-full bg-[#F27D26] animate-pulse" />
                لینکەکە چالاکە
             </div>
          </div>
        )}
      </motion.div>
    </div>
  );

  const opponentId = currentGame ? (user.uid === currentGame.playerX ? currentGame.playerO : currentGame.playerX) : null;

  return (
    <div className="min-h-screen bg-[#050505] text-[#FAFAFA] font-sans selection:bg-[#F27D26] selection:text-white overflow-x-hidden">
      <nav className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center px-6 py-6 md:px-12 backdrop-blur-xl bg-black/40 border-b border-white/5">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentGameId(null)}>
          <div className="w-8 h-8 bg-[#F27D26] rounded-lg flex items-center justify-center font-black text-black shadow-lg">2R</div>
          <span className="text-xl font-bold tracking-tight uppercase">شاکار ٢ڕ٢ف</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-4 px-2 py-1 bg-white/5 rounded-full border border-white/5">
            <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
            <span className={`text-[9px] font-black uppercase tracking-widest ${isOnline ? 'opacity-30 text-white' : 'text-red-500'}`}>
              {isOnline ? 'سەرهێڵ' : 'ئۆفلاین'}
            </span>
          </div>

          <div className="relative">
            <button 
              onClick={() => setShowAccountMenu(!showAccountMenu)}
              className="flex items-center gap-3 bg-white/5 hover:bg-white/10 px-4 py-2 rounded-full border border-white/10 transition-all cursor-pointer active:scale-95"
            >
               <span className="text-xs font-bold opacity-60 uppercase tracking-widest hidden sm:inline">{user.displayName?.split(" ")[0]}</span>
               {user.photoURL ? (
                 <img src={user.photoURL} className="w-6 h-6 rounded-full ring-2 ring-[#F27D26]/20 shadow-lg" alt="" />
               ) : (
                 <div className="w-6 h-6 rounded-full bg-[#F27D26]/20 flex items-center justify-center">
                   <UserIcon className="w-4 h-4 text-[#F27D26]" />
                 </div>
               )}
            </button>

            <AnimatePresence>
              {showAccountMenu && (
                <>
                  <div className="fixed inset-0 z-[-1]" onClick={() => setShowAccountMenu(false)} />
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute left-0 mt-3 w-72 bg-[#111] border border-white/10 rounded-3xl shadow-2xl overflow-hidden p-1 backdrop-blur-2xl"
                  >
                    <div className="p-5 border-b border-white/5 mb-2 bg-gradient-to-br from-white/5 to-transparent">
                       <p className="text-[9px] font-black text-[#F27D26] uppercase tracking-[0.2em] mb-2 italic">ئەکاونتی چالاک</p>
                       <div className="flex items-center gap-3">
                         <div className="w-10 h-10 rounded-xl bg-white/5 p-0.5 border border-white/10">
                            {user.photoURL ? (
                              <img src={user.photoURL} alt="" className="w-full h-full rounded-lg object-cover" />
                            ) : (
                              <div className="w-full h-full rounded-lg bg-[#F27D26]/20 flex items-center justify-center font-black italic text-[#F27D26]">
                                {user.displayName?.[0]?.toUpperCase()}
                              </div>
                            )}
                         </div>
                         <div className="flex-1 min-w-0">
                           <p className="font-black text-sm truncate text-white italic">{user.displayName}</p>
                           <p className="text-[10px] opacity-40 truncate font-mono">{user.email || (user.isAnonymous ? "میوان (Guest)" : "")}</p>
                         </div>
                       </div>
                    </div>

                    <div className="px-2 pb-2 space-y-1">
                      <button 
                        onClick={async () => {
                          setShowAccountMenu(false);
                          try {
                            await signWithGoogle();
                          } catch (e: any) {
                            setError("کێشەیەک ڕوویدا: " + e.message);
                          }
                        }}
                        className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-white/10 transition-all text-right group cursor-pointer border border-transparent hover:border-white/5"
                      >
                        <RefreshCcw className="w-4 h-4 opacity-20 group-hover:opacity-100 group-hover:text-[#F27D26] group-hover:rotate-180 transition-all duration-500" />
                        <div className="text-right">
                          <p className="text-xs font-black italic">گۆڕینی ئەکاونت</p>
                          <p className="text-[9px] opacity-30 italic">Switch Google Account</p>
                        </div>
                      </button>

                      <button 
                        onClick={() => {
                          setShowAccountMenu(false);
                          forceNetworkReset();
                        }}
                        className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-white/10 transition-all text-right group cursor-pointer border border-transparent hover:border-white/5"
                      >
                        <Zap className="w-4 h-4 opacity-20 group-hover:opacity-100 group-hover:text-amber-400 transition-all" />
                        <div className="text-right">
                          <p className="text-xs font-black italic">نوێکردنەوەی جێگیر</p>
                          <p className="text-[9px] opacity-30 italic">Force Sync Reset</p>
                        </div>
                      </button>

                      <button 
                        onClick={() => {
                          setShowAccountMenu(false);
                          auth.signOut();
                        }}
                        className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-red-500/10 transition-all text-right group cursor-pointer border border-transparent hover:border-red-500/10"
                      >
                        <LogOut className="w-4 h-4 opacity-20 group-hover:opacity-100 group-hover:text-red-500 transition-all" />
                        <div className="text-right">
                          <p className="text-xs font-black text-red-500 italic">چوونەدەرەوە</p>
                          <p className="text-[9px] opacity-30 italic">Sign Out</p>
                        </div>
                      </button>
                    </div>

                    <div className="mt-2 p-4 bg-black/40 border-t border-white/5 text-center space-y-3">
                       <div className="flex items-center justify-between">
                         <span className="text-[9px] font-black opacity-20 uppercase tracking-widest italic">وەشانی یاری: 2.5</span>
                         <div className="flex items-center gap-1">
                           <span className="text-[9px] font-black opacity-20 uppercase">STATUS:</span>
                           <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                         </div>
                       </div>
                       {!isOnline && (
                         <button 
                          onClick={forceNetworkReset}
                          className="w-full py-2 bg-[#F27D26]/10 text-[#F27D26] text-[10px] font-black rounded-lg border border-[#F27D26]/20 hover:bg-[#F27D26]/20 transition-all"
                         >
                           پەیوەندی نییە؟ لێرە کلیک بکە
                         </button>
                       )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </nav>

      <main className="pt-32 pb-20 px-6 md:px-12 max-w-7xl mx-auto min-h-screen">
        <AnimatePresence mode="wait">
          {!currentGameId ? (
            <motion.div key="lobby" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.02 }} className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              <div className="lg:col-span-4 space-y-8">
                {error && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-red-500/10 border border-red-500/20 p-5 rounded-3xl text-red-500 text-sm font-bold flex flex-col gap-3 shadow-2xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0">!</div>
                      <div className="flex flex-col">
                        <span className="font-black">کێشەیەک ڕوویدا</span>
                        <span className="text-[10px] opacity-70 leading-tight">{error}</span>
                      </div>
                    </div>
                    {error === 'anonymous_disabled' && (
                      <div className="bg-black/20 p-3 rounded-xl text-[10px] leading-relaxed italic border border-red-500/10">
                        تێبینی: وا دیارە Anonymous Login کارا نییە. دەبێ بچیتە Firebase Console (Auth) پاشان (Sign-in method) و (Anonymous) چالاک بکەیت.
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row items-center gap-2">
                      <button 
                        id="error-retry-button"
                        onClick={() => { enableNetwork(db).then(() => { setError(null); testFirebaseConnection(); }); }} 
                        className="flex-1 w-full bg-[#F27D26] hover:bg-[#D66A1A] text-white py-3 rounded-xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2 shadow-lg"
                      >
                        <Zap className="w-3 h-3" /> هەوڵدانەوە (Retry)
                      </button>
                      <button 
                        id="error-reload-button"
                        onClick={() => window.location.reload()} 
                        className="flex-1 w-full bg-white/10 hover:bg-white/20 text-white py-3 rounded-xl text-[10px] font-black uppercase transition-all flex items-center justify-center gap-2"
                      >
                        <RefreshCcw className="w-3 h-3" /> پەیجەکە نوێ بکەرەوە
                      </button>
                    </div>
                    <div id="diagnostics-link" className="text-[9px] opacity-30 text-center uppercase tracking-tighter cursor-pointer hover:opacity-100 flex flex-col gap-1 items-center" onClick={() => alert("UID: " + (user?.uid || "none") + "\nOnline: " + isOnline + "\nDB: " + (firebaseConfig as any).projectId)}>
                      <span>بۆ شارەزایان: پیشاندانی زانیاری تەکنیکی</span>
                      <button onClick={(e) => { e.stopPropagation(); forceNetworkReset(); }} className="mt-1 px-2 py-0.5 border border-white/20 rounded hover:bg-white/10 active:bg-white/20">Sync Reset</button>
                    </div>
                  </motion.div>
                )}
                {joiningId && (
                   <div className="bg-white/5 border border-white/5 p-6 rounded-3xl flex items-center gap-4 animate-pulse">
                      <RefreshCcw className="w-5 h-5 text-[#F27D26] animate-spin" />
                      <p className="text-xs font-bold text-[#F27D26]">پەیوەندی بە یارییەکە دەکەین...</p>
                   </div>
                )}
                <div className="bg-white/5 border border-white/10 p-6 rounded-[2rem] flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-[0.02] pointer-events-none">
                    <UserIcon className="w-20 h-20" />
                  </div>
                  <div className="flex items-center gap-4 w-full">
                    <div className="relative">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#F27D26] to-orange-500 p-0.5 shadow-lg group">
                        {user?.photoURL ? (
                          <img src={user.photoURL} alt="" className="w-full h-full rounded-[14px] object-cover" />
                        ) : (
                          <div className="w-full h-full rounded-[14px] bg-black flex items-center justify-center font-black italic text-lg">
                            {user?.displayName?.[0]?.toUpperCase()}
                          </div>
                        )}
                        <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-black ${isOnline ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-black text-lg text-white truncate italic">{user?.displayName}</h4>
                      <p className="text-[10px] opacity-40 uppercase tracking-widest truncate">{user?.isAnonymous ? "میوان (Guest Mode)" : user?.email}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <button 
                      onClick={signWithGoogle}
                      className="flex-1 sm:flex-none px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Users className="w-4 h-4 text-[#F27D26]" />
                      گۆڕینی ئەکاونت
                    </button>
                    {!user?.isAnonymous && (
                      <button 
                        onClick={() => auth.signOut()}
                        className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-xl transition-all active:scale-95"
                        title="دەرچوون"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-white/10 to-transparent border border-white/10 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden group">
                  <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-[#F27D26] opacity-10 blur-3xl group-hover:opacity-20 transition-opacity" />
                  <h2 className="text-4xl font-black mb-4 uppercase tracking-tighter italic">کایەی نوێ</h2>
                  <div className="space-y-4">
                    <button 
                      onClick={handleAutoMatch} 
                      disabled={creatingGame}
                      className={`w-full bg-[#F27D26] text-white py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 shadow-[0_15px_40px_rgba(242,125,38,0.3)] hover:translate-y-[-2px] active:translate-y-[1px] transition-all cursor-pointer disabled:opacity-50`}
                    >
                      {creatingGame ? <RefreshCcw className="w-6 h-6 animate-spin" /> : <Zap className="w-6 h-6" />}
                      خۆکارانە (Quick Match)
                    </button>
                    <button 
                      onClick={createBotGame} 
                      disabled={creatingGame}
                      className="w-full bg-white/5 text-white py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 border border-white/10 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {creatingGame ? <RefreshCcw className="w-5 h-5 animate-spin text-[#F27D26]" /> : <Trophy className="w-5 h-5 text-[#F27D26]" />}
                      کایە لەگەڵ بۆت
                    </button>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 p-8 rounded-[2.5rem] space-y-6 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-5">
                    <Users className="w-12 h-12" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-3xl font-black text-[#F27D26] uppercase tracking-tighter italic">تیمەکەم (My Team)</h3>
                    <p className="text-[10px] uppercase font-bold opacity-30 tracking-widest">تیم دروست بکە یان بەشداری بکە</p>
                  </div>

                  <div className="space-y-4">
                    <button 
                      onClick={() => createGame(false)} 
                      disabled={creatingGame}
                      className="w-full bg-white/10 text-white py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 border border-white/10 hover:bg-[#F27D26] hover:text-black hover:border-[#F27D26] transition-all cursor-pointer disabled:opacity-50 group"
                    >
                      <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform" />
                       دروستکردنی تیم (کۆد)
                    </button>

                    <div className="relative pt-4 border-t border-white/5">
                      <p className="text-[10px] font-bold opacity-20 uppercase tracking-[0.3em] text-center mb-4 italic">بەشداری تیم بکە بە کۆد</p>
                      <div className="flex gap-2" dir="ltr">
                        <button 
                          onClick={() => { if (joinCodeInput) joinGame(joinCodeInput.toUpperCase()); }} 
                          disabled={isJoiningByCode || !joinCodeInput}
                          className="bg-[#F27D26] px-8 rounded-2xl font-black uppercase text-xs hover:scale-[1.05] active:scale-95 transition-all shadow-lg cursor-pointer order-2 disabled:opacity-50"
                        >
                          {isJoiningByCode ? <RefreshCcw className="w-4 h-4 animate-spin" /> : "بڕۆ"}
                        </button>
                        <input 
                          type="text" 
                          placeholder="کۆدی تیم بنووسە" 
                          className="flex-1 bg-black/40 border border-white/10 rounded-2xl px-4 py-4 font-mono uppercase tracking-[0.2em] focus:outline-none focus:border-[#F27D26] transition-all text-center placeholder:tracking-normal placeholder:text-xs order-1" 
                          value={joinCodeInput}
                          onChange={(e) => setJoinCodeInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && joinCodeInput) joinGame(joinCodeInput.toUpperCase()); }}
                        />
                      </div>
                    </div>
                  </div>

                  {creatingGame && (
                    <button 
                      onClick={() => { setCreatingGame(false); setError("ڕێست کرا. دووبارە هەوڵ بدەرەوە."); }} 
                      className="w-full py-2 text-[10px] uppercase font-bold opacity-20 hover:opacity-100 transition-all text-center"
                    >
                      کێشەیەک هەیە؟ لێرە کلیک بکە بۆ ڕێست
                    </button>
                  )}
                </div>
              </div>

              <div className="lg:col-span-8">
                 <div className="flex justify-between items-end mb-8 px-2">
                   <h3 className="text-2xl font-bold uppercase tracking-tighter flex items-center gap-3 italic"><Users className="w-6 h-6 text-[#F27D26]" /> کایە بەردەستەکان</h3>
                   <span className="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]">{availableGames.length} ACTIVE</span>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {availableGames.map(game => (
                     <motion.div key={game.id} whileHover={{ x: 5 }} className="bg-white/5 border border-white/5 p-6 rounded-3xl hover:bg-white/10 transition-all flex items-center justify-between group cursor-pointer" onClick={() => { if (game.playerX === user.uid || game.playerO === user.uid) setCurrentGameId(game.id); else if (game.status === "waiting") joinGame(game.id); }}>
                       <div className="space-y-1">
                         <span className="text-[10px] font-bold opacity-30 text-[#F27D26] tracking-widest uppercase">MATCH ID: {game.id}</span>
                         <h4 className="font-bold text-lg italic">{game.status === 'waiting' ? "چاوەڕوانی ڕکابەر" : "کایە دەستی پێکردووە"}</h4>
                       </div>
                       <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center group-hover:bg-[#F27D26] group-hover:text-white transition-all shadow-xl"><ArrowRight className="w-6 h-6 rtl:rotate-180" /></div>
                     </motion.div>
                   ))}
                   {availableGames.length === 0 && <div className="col-span-2 py-32 text-center text-sm opacity-20 font-medium tracking-widest uppercase border-2 border-dashed border-white/5 rounded-3xl">هیچ یارییەک لێرە نییە... یەکێک دروست بکە!</div>}
                 </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="game" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
              <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                 <button onClick={leaveGame} className="flex items-center gap-2 text-[10px] font-bold opacity-30 hover:opacity-100 transition-all uppercase tracking-[0.3em] bg-white/5 px-4 py-2 rounded-full cursor-pointer"><RefreshCcw className="w-3 h-3" /> گەڕانەوە</button>
                 <div className="flex items-center gap-4 bg-white/5 px-8 py-4 rounded-3xl border border-white/5 shadow-inner" dir="ltr">
                    <div className="flex gap-2 order-2">
                       {mySecret.length === 4 ? mySecret.split("").map((d, i) => <div key={i} className="w-10 h-12 bg-[#F27D26] text-black rounded-xl flex items-center justify-center font-black text-xl shadow-lg border-b-4 border-orange-700">{d}</div>) : [1,2,3,4].map(i => <div key={i} className="w-10 h-12 bg-white/10 rounded-xl border border-white/10 animate-pulse" />)}
                    </div>
                    <span className="text-xs font-black opacity-20 uppercase tracking-[0.5em] order-1">{currentGame?.playerO === "BOT" ? "Secret" : "My Secret"}</span>
                 </div>
                  <div className="flex items-center gap-3">
                   <div className="text-right">
                      <p className="text-[10px] font-bold opacity-30 uppercase tracking-widest">کۆدی یاری: <span className="text-[#F27D26] font-mono select-all cursor-pointer" onClick={() => { navigator.clipboard.writeText(currentGameId!); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{currentGameId}</span></p>
                      <button onClick={copyGameId} className="bg-[#F27D26]/10 px-4 py-2 rounded-xl font-mono text-sm font-bold text-[#F27D26] flex items-center gap-2 hover:bg-[#F27D26] hover:text-white transition-all cursor-pointer">
                        {copied ? "کۆپی کرا!" : "ناردنی لینک بۆ هاوڕێ"} 
                        {copied ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      </button>
                      {window.location.origin.includes("-dev-") && (
                        <p className="text-[9px] text-yellow-500 font-bold mt-1 max-w-[160px] leading-tight">⚠️ بۆ ئەوەی لینکەکە لای هاوڕێکەت کار بکات، پێویستە لە بەشی سەرەوەی ئەپەکە کلیک لە دوگمەی Share بکەیت</p>
                      )}
                   </div>
                 </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Side: My Info & History */}
                <div className="lg:col-span-3 space-y-6 text-right">
                   <div className="bg-[#111] p-5 rounded-[2rem] border border-white/5 flex items-center gap-4 justify-end">
                      <div className="text-right">
                         <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest">{user.uid === currentGame?.playerX ? "(١) وەستا" : "(٢) یاریزان"}</p>
                         <p className="font-bold flex items-center gap-2 flex-row-reverse">{user.displayName?.split(" ")[0]} <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" /></p>
                      </div>
                      <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center overflow-hidden flex-shrink-0">
                        {user.photoURL ? <img src={user.photoURL} alt="" className="w-full h-full object-cover" /> : <UserIcon className="w-6 h-6 opacity-20" />}
                      </div>
                   </div>

                   <div className="flex items-center gap-2 px-2 text-xs font-bold opacity-40 uppercase tracking-[0.2em] pt-4 flex-row-reverse"><Trophy className="w-4 h-4 text-[#F27D26]" /> پرسیارەکانم</div>
                   <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                      {(user.uid === currentGame?.playerX ? currentGame?.guessesX : currentGame?.guessesO)?.map((g, i) => (
                        <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 group hover:bg-white/10 transition-colors" dir="ltr">
                           <span className="font-mono text-xl font-black tracking-widest text-[#F27D26]">{g.value}</span>
                           <div className="bg-[#F27D26] text-black px-3 py-1 rounded-lg font-black text-xs shadow-md group-hover:scale-110 transition-transform">{g.result}</div>
                        </motion.div>
                      ))}
                      {((user.uid === currentGame?.playerX ? currentGame?.guessesX : currentGame?.guessesO)?.length || 0) === 0 && <p className="text-center py-10 opacity-20 text-xs italic">جارێ هیچت نەپرسیوە...</p>}
                   </div>
                </div>

                {/* Center: Main Interaction */}
                <div className="lg:col-span-6">
                  {currentGame?.status === 'setting_secrets' ? (
                    <div className="bg-white/5 border border-white/10 p-12 rounded-[4rem] text-center space-y-10 shadow-2xl relative overflow-hidden">
                       <div className="absolute inset-0 bg-gradient-to-b from-[#F27D26]/5 to-transparent pointer-events-none" />
                       
                       {mySecret.length < 4 ? (
                         <>
                           <div className="space-y-2 relative">
                             <h2 className="text-4xl font-black italic tracking-tighter italic">ژمارەکە بنووسە</h2>
                             <p className="opacity-40 text-sm">٤ ژمارەی جیاواز هەڵبژێرە و کەس نەیبینێت</p>
                           </div>
                           <div className="flex justify-center gap-4" dir="ltr">
                             {Array(4).fill(0).map((_, i) => (
                               <div key={i} className={`w-16 h-20 rounded-3xl border-2 flex items-center justify-center text-4xl font-black shadow-2xl transition-all ${mySecret[i] ? 'bg-[#F27D26] text-black border-[#F27D26] scale-105' : 'bg-black/40 border-white/10'}`}>
                                 {mySecret[i] || ""}
                               </div>
                             ))}
                           </div>
                           <div className="grid grid-cols-3 gap-3 max-w-[300px] mx-auto">
                             {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((btn, i) => (
                               <button key={i} onClick={() => { if (btn === "⌫") setMySecret(s => s.slice(0, -1)); else if (typeof btn === 'number' && mySecret.length < 4 && !mySecret.includes(btn.toString())) setMySecret(s => s + btn); }} disabled={btn === "" || (typeof btn === 'number' && mySecret.includes(btn.toString()))} className={`h-16 rounded-2xl font-black text-xl transition-all active:scale-90 ${btn === "" ? 'opacity-0 cursor-default' : 'bg-white/5 hover:bg-[#F27D26] hover:text-black border border-white/5 shadow-lg disabled:opacity-20 cursor-pointer'}`}>{btn}</button>
                             ))}
                           </div>
                           <button onClick={() => setSecretNumber(mySecret)} disabled={mySecret.length !== 4} className="w-full bg-white text-black py-6 rounded-3xl font-black text-xl border-b-8 border-gray-300 active:border-b-2 active:translate-y-1 transition-all disabled:opacity-20 cursor-pointer uppercase italic">ئامادەم</button>
                         </>
                       ) : (
                         <div className="py-12 flex flex-col items-center gap-8 animate-in fade-in zoom-in duration-500">
                            <div className="relative">
                               <div className="w-24 h-24 bg-[#F27D26] rounded-3xl flex items-center justify-center text-6xl font-black text-black shadow-[0_20px_50px_rgba(242,125,38,0.4)] relative z-10 rotate-3">
                                 {user.uid === currentGame?.playerX ? "١" : "٢"}
                               </div>
                               <div className="absolute -inset-4 bg-[#F27D26]/20 rounded-3xl animate-pulse" />
                            </div>
                            <div className="space-y-4">
                               <h2 className="text-3xl font-black italic tracking-tighter text-[#F27D26] uppercase">تۆ {user.uid === currentGame?.playerX ? "وەستای (١)" : "ڕکابەری (٢)"}</h2>
                               <p className="font-bold opacity-30 italic text-lg uppercase tracking-widest animate-pulse text-center max-w-sm mx-auto leading-relaxed">
                                 {user.uid === currentGame?.playerX 
                                   ? `چاوەڕوانین ${opponentData?.displayName || 'ڕکابەر'} کۆدەکەی بنووسێت بۆ دەستپێکردن...` 
                                   : `تۆ کۆدەکەت ناردووە، با چاوەڕێی ${opponentData?.displayName || 'وەستا'} بین...`}
                               </p>
                            </div>
                            {opponentData && !opponentData.isOnline && <div className="bg-red-500/10 text-red-500 px-6 py-3 rounded-full text-xs font-bold animate-bounce flex items-center gap-2"><span>⚠️</span> ڕکابەرەکەت لە کایەکە دەرچووە!</div>}
                            <RefreshCcw className="w-8 h-8 text-[#F27D26] animate-spin opacity-20" />
                         </div>
                       )}
                    </div>
                  ) : currentGame?.status === 'playing' ? (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-700">
                       <div className="text-center space-y-2">
                          <motion.div animate={{ scale: currentGame.turn === user.uid ? [1, 1.02, 1] : 1 }} transition={{ duration: 2, repeat: Infinity }}>
                             <h2 className={`text-5xl font-black uppercase italic tracking-tighter ${currentGame.turn === user.uid ? 'text-[#F27D26]' : 'opacity-20'}`}>
                               {currentGame.turn === user.uid ? "نۆرەی تۆیە بپرسی!" : (currentGame.playerO === "BOT" ? "بۆت سەرقاڵە..." : "ڕکابەر دەستی نووسیوە...")}
                             </h2>
                          </motion.div>
                       </div>
                       <div className="bg-white/5 border border-white/10 p-10 rounded-[4rem] shadow-2xl relative group">
                          <div className="flex justify-center gap-3 mb-10" dir="ltr">
                            {Array(4).fill(0).map((_, i) => (
                              <div key={i} className={`w-14 h-16 rounded-2xl border-2 flex items-center justify-center text-3xl font-black transition-all ${inputGuess[i] ? 'bg-white text-black border-white scale-105 shadow-[0_0_30px_rgba(255,255,255,0.2)]' : 'bg-black/40 border-white/5 text-white/20'}`}>{inputGuess[i] || ""}</div>
                            ))}
                          </div>
                          <div className="grid grid-cols-5 gap-2 max-w-[400px] mx-auto mb-8">
                             {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => (
                               <button key={n} onClick={() => inputGuess.length < 4 && !inputGuess.includes(n.toString()) && setInputGuess(s => s + n)} disabled={currentGame.turn !== user.uid || inputGuess.includes(n.toString())} className="h-14 rounded-xl bg-white/5 hover:bg-white hover:text-black border border-white/5 font-black transition-all disabled:opacity-20 cursor-pointer">{n}</button>
                             ))}
                             <button onClick={() => setInputGuess(s => s.slice(0, -1))} className="col-span-5 h-12 rounded-xl bg-red-500/10 text-red-500 font-bold hover:bg-red-500 hover:text-white transition-all cursor-pointer">پاککردنەوە</button>
                          </div>
                          <button onClick={submitGuess} disabled={currentGame.turn !== user.uid || inputGuess.length !== 4} className="w-full bg-[#F27D26] text-white py-6 rounded-3xl font-black text-2xl shadow-[0_20px_50px_rgba(242,125,38,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-20 uppercase tracking-tighter cursor-pointer">بپرسە!</button>
                       </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-8 bg-white/5 p-16 rounded-[4rem] border border-white/10 shadow-2xl relative overflow-hidden italic animate-in zoom-in duration-500">
                       <div className="absolute inset-x-0 top-0 h-2 bg-[#F27D26]" />
                       <h2 className="text-7xl font-black italic tracking-tighter uppercase">{currentGame?.status === (user.uid === currentGame?.playerX ? 'X_won' : 'O_won') ? "تۆ بردتەوە!" : "ڕکابەر بردییەوە!"}</h2>
                       <p className="opacity-50 text-lg">کایەیەکی زۆر نایاب بوو، دەتەوێت دووبارە کایە بکەیتەوە؟</p>
                       <div className="bg-white/10 p-6 rounded-3xl border border-white/10 max-w-xs mx-auto" dir="ltr">
                          <p className="text-[10px] font-black uppercase tracking-widest opacity-30 mb-2">Secret Number Was</p>
                          <p className="text-4xl font-black text-[#F27D26] tracking-[0.5em]">{opponentSecret}</p>
                       </div>
                       <button onClick={() => setCurrentGameId(null)} className="bg-white text-black px-12 py-5 rounded-full font-black text-xl hover:bg-[#F27D26] hover:text-white transition-all shadow-2xl cursor-pointer">گەڕانەوە بۆ سەرەتا</button>
                    </div>
                  )}
                </div>

                {/* Right Side: Opponent Info & History */}
                <div className="lg:col-span-3 space-y-6">
                   <div className="bg-[#111] p-5 rounded-[2rem] border border-white/5 flex items-center gap-4">
                      <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center overflow-hidden">
                        {opponentData?.photoURL ? <img src={opponentData.photoURL} alt="" className="w-full h-full object-cover" /> : <UserIcon className="w-6 h-6 opacity-20" />}
                      </div>
                      <div>
                         <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest">{currentGame?.playerX === opponentId ? "(١) وەستا" : "(٢) ڕکابەر"}</p>
                         <p className="font-bold flex items-center gap-2">
                           {opponentData?.displayName || "چاوەڕوان..."} 
                           <span className={`w-1.5 h-1.5 rounded-full ${opponentData?.isOnline ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-red-500 opacity-50'}`} />
                         </p>
                      </div>
                   </div>

                   <div className="flex items-center gap-2 px-2 text-xs font-bold opacity-40 uppercase tracking-[0.2em] pt-4"><Users className="w-4 h-4 text-[#F27D26]" /> پرسیارەکانی ئەو</div>
                   <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                      {(user.uid === currentGame?.playerX ? currentGame?.guessesO : currentGame?.guessesX)?.map((g, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 border-dashed opacity-40" dir="ltr">
                           <span className="font-mono text-lg font-bold tracking-widest">{Array(4).fill("•").join("")}</span>
                           <div className="bg-white/10 px-3 py-1 rounded-lg font-black text-[10px] uppercase">{g.result}</div>
                        </div>
                      ))}
                      {((user.uid === currentGame?.playerX ? currentGame?.guessesO : currentGame?.guessesX)?.length || 0) === 0 && <p className="text-center py-10 opacity-20 text-xs italic">بەرامبەر هیچی نەپرسیوە...</p>}
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <div className="fixed bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#F27D26] to-transparent opacity-10 pointer-events-none" />
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #F27D26; }
      `}</style>
    </div>
  );
}
