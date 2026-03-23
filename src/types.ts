import { User } from 'firebase/auth';

export type Position = { x: number; y: number };
export type LaneType = 'goal' | 'river' | 'safe' | 'road' | 'start';
export type Obstacle = { id: string; x: number; y: number; speed: number; type: 'car' | 'log'; emoji: string };
export type PowerUp = { x: number; y: number; type: 'heart'; active: boolean };
export type LeaderboardEntry = { uid: string; displayName: string; score: number; photoURL?: string };

export interface AuthContextType {
  user: User | null;
  loading: boolean;
}
