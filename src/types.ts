import { Timestamp } from "firebase/firestore";

export type GameStatus = "waiting" | "setting_secrets" | "playing" | "X_won" | "O_won" | "draw";

export interface Guess {
  value: string;
  result: string;
  timestamp: number;
}

export interface GameData {
  id: string;
  playerX: string;
  playerO: string | null;
  guessesX: Guess[];
  guessesO: Guess[];
  turn: string;
  status: GameStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserProfile {
  displayName: string;
  photoURL?: string | null;
  isOnline: boolean;
  lastSeen: any;
}
