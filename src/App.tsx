/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, createContext, useContext, Component, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Heart, Star, Trophy, Play, RotateCcw, LogIn, LogOut, User as UserIcon, Loader2, Volume2, VolumeX, Maximize, Minimize, Home } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Firebase Imports
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  type User, 
  doc, 
  setDoc, 
  updateDoc,
  getDoc,
  serverTimestamp,
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  Timestamp,
  handleFirestoreError,
  OperationType
} from './firebase';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const GRID_WIDTH = 20;
const TILE_SIZE = 32; // px
const INITIAL_LIVES = 3;
const SPEED_INCREMENT_THRESHOLD = 3; // Level up every 3 points for faster progression

// --- Types ---
type Position = { x: number; y: number };
type LaneType = 'goal' | 'river' | 'safe' | 'road' | 'start';
type Obstacle = { id: string; x: number; y: number; speed: number; type: 'car' | 'log'; emoji: string };
type PowerUp = { x: number; y: number; type: 'heart'; active: boolean };
type LeaderboardEntry = { uid: string; displayName: string; score: number; photoURL?: string };

/**
 * Generates the lane configuration based on the current level.
 * Difficulty increases by adding more lanes and changing their distribution.
 */
const getLaneConfig = (level: number): LaneType[] => {
  // Stable lane growth:
  // Level 1-4: 2 river, 3 road (Total 8)
  // Level 5-9: 3 river, 4 road (Total 10)
  // Level 10+: 4 river, 5 road (Total 12)
  const riverLanes = level >= 10 ? 4 : (level >= 5 ? 3 : 2);
  const roadLanes = level >= 10 ? 5 : (level >= 5 ? 4 : 3);
  
  const lanes: LaneType[] = [];
  lanes.push('goal');
  for (let i = 0; i < riverLanes; i++) lanes.push('river');
  lanes.push('safe');
  for (let i = 0; i < roadLanes; i++) lanes.push('road');
  lanes.push('start');
  
  return lanes;
};

// --- Sound System ---
const SOUNDS = {
  jump: 'jump',
  collision: 'collision',
  win: 'win',
  powerup: 'powerup',
  levelup: 'levelup'
};

/**
 * SoundManager handles audio synthesis using the Web Audio API.
 * This provides zero-dependency, low-latency sounds that work reliably in sandboxed environments.
 */
class SoundManager {
  private static instance: SoundManager;
  private audioContext: AudioContext | null = null;
  private isMuted: boolean = false;
  private isUnlocked: boolean = false;

  private constructor() {}

  /**
   * Singleton pattern to ensure only one SoundManager exists.
   */
  static getInstance() {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  /**
   * Toggles the mute state.
   */
  setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  /**
   * Initializes and resumes the AudioContext.
   * Must be called in response to a user gesture (click/keypress).
   */
  async unlock() {
    if (this.isUnlocked) return;
    
    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Play a silent buffer to fully "prime" the audio engine
      const buffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(0);
      
      this.isUnlocked = true;
    } catch (err) {
      console.error('Audio unlock failed:', err);
    }
  }

  /**
   * Synthesizes a sound effect based on the provided key.
   * @param key The sound effect to play.
   * @param volume The volume level (0.0 to 1.0).
   */
  play(key: keyof typeof SOUNDS, volume: number = 0.5) {
    if (this.isMuted) return;
    
    // Lazy initialization of context
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = this.audioContext;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const time = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    
    // Quick attack envelope to prevent clicking
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.01);

    const osc = ctx.createOscillator();
    osc.connect(gain);

    switch (key) {
      case 'jump':
        // A short rising sine wave for a "boing" effect
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(600, time + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
        osc.start(time);
        osc.stop(time + 0.15);
        break;
      case 'collision':
        // A low-frequency square wave for a "thud"
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, time);
        osc.frequency.exponentialRampToValueAtTime(40, time + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
        osc.start(time);
        osc.stop(time + 0.3);
        break;
      case 'win':
        // A happy arpeggio
        osc.type = 'triangle';
        [440, 554, 659, 880].forEach((freq, i) => {
          const noteTime = time + i * 0.1;
          osc.frequency.setValueAtTime(freq, noteTime);
        });
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
        osc.start(time);
        osc.stop(time + 0.5);
        break;
      case 'powerup':
        // A fast rising sawtooth for a "zing"
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, time);
        osc.frequency.exponentialRampToValueAtTime(1200, time + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
        osc.start(time);
        osc.stop(time + 0.3);
        break;
      case 'levelup':
        // A triumphant fanfare
        osc.type = 'square';
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
          const noteTime = time + i * 0.1;
          osc.frequency.setValueAtTime(freq, noteTime);
        });
        gain.gain.exponentialRampToValueAtTime(0.01, time + 0.6);
        osc.start(time);
        osc.stop(time + 0.6);
        break;
    }
  }
}

const soundManager = SoundManager.getInstance();

const playJumpSound = () => soundManager.play('jump', 0.3);
const playCollisionSound = () => soundManager.play('collision', 0.5);
const playWinSound = () => soundManager.play('win', 0.4);
const playPowerUpSound = () => soundManager.play('powerup', 0.4);
const playLevelUpSound = () => soundManager.play('levelup', 0.5);

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        message = `Firebase Error: ${parsed.error} (${parsed.operationType} at ${parsed.path})`;
      } catch {
        message = this.state.error.message || message;
      }

      return (
        <div className="min-h-screen bg-stone-950 flex items-center justify-center p-8 text-center">
          <div className="bg-stone-900 border border-rose-500/30 p-8 rounded-3xl max-w-md">
            <h2 className="text-rose-500 font-bold text-xl mb-4">Oops!</h2>
            <p className="text-stone-400 text-sm mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-stone-100 text-stone-950 px-6 py-2 rounded-full font-bold"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Auth Context ---
const AuthContext = createContext<{ user: User | null; loading: boolean }>({ user: null, loading: true });

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Sync user profile to Firestore
        const userRef = doc(db, 'users', u.uid);
        getDoc(userRef).then((docSnap) => {
          if (!docSnap.exists()) {
            setDoc(userRef, {
              uid: u.uid,
              displayName: u.displayName || 'Anonymous',
              photoURL: u.photoURL || '',
              email: u.email || '',
              createdAt: serverTimestamp()
            }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
          } else {
            updateDoc(userRef, {
              displayName: u.displayName || 'Anonymous',
              photoURL: u.photoURL || '',
              email: u.email || ''
            }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
          }
        });
      }
    });
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

// --- Components ---

/**
 * AuthBar component handles user login/logout and profile display.
 */
const AuthBar = React.memo(({ user, onLogin, onLogout }: { user: User | null; onLogin: () => void; onLogout: () => void }) => (
  <div className="w-full max-w-2xl flex justify-between items-center mb-4 px-4 py-2 bg-stone-900/50 rounded-2xl border border-white/5">
    {user ? (
      <div className="flex items-center gap-3">
        <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-emerald-500/30" />
        <div className="flex flex-col">
          <span className="text-[10px] text-stone-500 uppercase font-bold">Player</span>
          <span className="text-xs font-semibold">{user.displayName}</span>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-stone-500">
        <UserIcon size={16} />
        <span className="text-xs font-semibold">Guest Mode</span>
      </div>
    )}
    
    {user ? (
      <button onClick={onLogout} className="p-2 hover:bg-white/5 rounded-full transition-colors text-stone-400">
        <LogOut size={18} />
      </button>
    ) : (
      <button onClick={onLogin} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-stone-950 px-4 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95">
        <LogIn size={14} /> LOGIN
      </button>
    )}
  </div>
));

/**
 * Leaderboard component displays the top scores.
 */
const Leaderboard = React.memo(({ entries }: { entries: LeaderboardEntry[] }) => (
  <div className="w-full max-w-[240px] space-y-2">
    <h3 className="text-[10px] text-stone-500 uppercase font-bold tracking-widest mb-3">Global Top 5</h3>
    {entries.map((entry, i) => (
      <div key={entry.uid} className="flex items-center justify-between bg-white/5 p-2 rounded-xl border border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-stone-600 w-3">{i + 1}</span>
          <img src={entry.photoURL || ''} alt="" className="w-5 h-5 rounded-full opacity-80" />
          <span className="text-[10px] font-bold truncate max-w-[80px]">{entry.displayName}</span>
        </div>
        <span className="text-[10px] font-mono text-emerald-400 font-bold">{entry.score}</span>
      </div>
    ))}
  </div>
));

function Game() {
  const { user, loading: authLoading } = useContext(AuthContext);
  
  // --- Game State ---
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>('start');
  const [level, setLevel] = useState(1);
  const laneConfig = React.useMemo(() => getLaneConfig(level), [level]);
  const gridHeight = laneConfig.length;
  const initialFrogPos = { x: Math.floor(GRID_WIDTH / 2), y: gridHeight - 1 };

  const [frogPos, setFrogPos] = useState<Position>(initialFrogPos);
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [score, setScore] = useState(0);
  const [personalBest, setPersonalBest] = useState(0);
  const [powerUp, setPowerUp] = useState<PowerUp | null>(null);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // Refs for high-frequency updates to avoid re-creating the game loop
  const frogPosRef = useRef<Position>(initialFrogPos);
  const obstaclesRef = useRef<Obstacle[]>([]);
  const powerUpRef = useRef<PowerUp | null>(null);
  const laneConfigRef = useRef<LaneType[]>(laneConfig);
  
  // Sync state to refs for high-frequency access in game loop
  useEffect(() => {
    frogPosRef.current = frogPos;
    obstaclesRef.current = obstacles;
    powerUpRef.current = powerUp;
    laneConfigRef.current = laneConfig;
  }, [frogPos, obstacles, powerUp, laneConfig]);

  const gameContainerRef = useRef<HTMLDivElement>(null);

  // Sync muted state to global helper
  useEffect(() => {
    soundManager.setMuted(muted);
  }, [muted]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!gameContainerRef.current) return;
    
    if (!document.fullscreenElement) {
      gameContainerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // Unlock audio on first interaction
  useEffect(() => {
    const handleInteraction = () => {
      soundManager.unlock();
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  // Refs for animation loop
  const requestRef = useRef<number>(null);
  const lastTimeRef = useRef<number>(0);

  // --- Firebase Sync ---
  useEffect(() => {
    if (!user) return;
    
    // Fetch personal best
    const scoreRef = doc(db, 'highscores', user.uid);
    getDoc(scoreRef).then(snap => {
      if (snap.exists()) {
        setPersonalBest(snap.data().score);
      }
    }).catch(err => handleFirestoreError(err, OperationType.GET, `highscores/${user.uid}`));

    // Listen to global leaderboard
    const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(5));
    const unsubscribe = onSnapshot(q, (snap) => {
      const entries: LeaderboardEntry[] = [];
      snap.forEach(doc => entries.push(doc.data() as LeaderboardEntry));
      setLeaderboard(entries);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'highscores'));

    return () => unsubscribe();
  }, [user]);

  const saveHighScore = useCallback(async (finalScore: number) => {
    if (!user || finalScore <= personalBest) return;

    const scoreRef = doc(db, 'highscores', user.uid);
    try {
      await setDoc(scoreRef, {
        uid: user.uid,
        displayName: user.displayName || 'Anonymous',
        photoURL: user.photoURL || '',
        score: finalScore,
        level: level,
        updatedAt: Timestamp.now()
      }, { merge: true });
      setPersonalBest(finalScore);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `highscores/${user.uid}`);
    }
  }, [user, personalBest, level]);

  // --- Initialization ---
  /**
   * Initializes obstacles for the current level.
   * Clears existing obstacles first to prevent "ghost" collisions during transitions.
   */
  const initObstacles = useCallback((targetLevel?: number) => {
    const l = targetLevel ?? level;
    const newObstacles: Obstacle[] = [];
    // Increase speed more aggressively as level increases
    const baseSpeed = 0.04 + (l - 1) * 0.02;
    const currentLanes = getLaneConfig(l);

    currentLanes.forEach((type, row) => {
      const direction = row % 2 === 0 ? 1 : -1;
      
      if (type === 'road') {
        const speed = (baseSpeed + Math.random() * 0.03) * direction;
        // Base car count
        let carCount = 3 + Math.floor(l / 1.5);
        
        // "Rush Hour" mechanic: 30% chance for a lane to have 50% more cars
        const isRushHour = Math.random() < 0.3;
        if (isRushHour) {
          carCount = Math.floor(carCount * 1.5);
        }

        const carEmojis = ['🚗', '🚕', '🚙', '🏎️', '🚓', '🚚', '🚛', '🚌', '🚐'];
        
        for (let i = 0; i < carCount; i++) {
          newObstacles.push({
            id: `car-${row}-${i}-${Date.now()}`, // Unique ID to force re-render
            // Spread cars more evenly but with some randomness
            x: (i * (GRID_WIDTH / carCount)) + (Math.random() * (GRID_WIDTH / carCount)),
            y: row,
            speed,
            type: 'car',
            emoji: carEmojis[Math.floor(Math.random() * carEmojis.length)],
          });
        }
      } else if (type === 'river') {
        const speed = (baseSpeed * 0.8 + Math.random() * 0.02) * direction;
        // Increase log count more aggressively
        const logCount = 3 + Math.floor(l / 3);
        
        for (let i = 0; i < logCount; i++) {
          newObstacles.push({
            id: `log-${row}-${i}-${Date.now()}`, // Unique ID to force re-render
            // Ensure logs are well-distributed across the lane
            x: (i * (GRID_WIDTH / logCount)) + (Math.random() * (GRID_WIDTH / logCount)),
            y: row,
            speed,
            type: 'log',
            emoji: '🪵🪵🪵',
          });
        }
      }
    });

    setObstacles(newObstacles);
    obstaclesRef.current = newObstacles; // Update ref immediately
  }, [level, getLaneConfig]);

  useEffect(() => {
    if (gameState === 'playing') {
      initObstacles();
    }
  }, [level, initObstacles, gameState]);

  const startGame = () => {
    setGameState('playing');
    setLives(INITIAL_LIVES);
    setScore(0);
    setLevel(1);
    const startPos = { x: Math.floor(GRID_WIDTH / 2), y: getLaneConfig(1).length - 1 };
    setFrogPos(startPos);
    frogPosRef.current = startPos;
    setPowerUp(null);
    initObstacles();
  };

  /**
   * Resets the frog to the starting position.
   * @param targetLevel Optional level to use for lane calculation (defaults to current level)
   */
  const resetFrog = useCallback((targetLevel?: number) => {
    const l = targetLevel ?? level;
    const currentLanes = getLaneConfig(l);
    const startPos = { x: Math.floor(GRID_WIDTH / 2), y: currentLanes.length - 1 };
    setFrogPos(startPos);
    frogPosRef.current = startPos;
  }, [level]);

  /**
   * Handles player death: plays sound, decrements lives, and checks for game over.
   */
  const handleDeath = useCallback(() => {
    playCollisionSound();
    const newLives = lives - 1;
    setLives(newLives);
    if (newLives <= 0) {
      setGameState('gameover');
      saveHighScore(score);
    } else {
      resetFrog();
    }
  }, [lives, score, resetFrog, saveHighScore]);

  /**
   * Handles a successful crossing: plays sound, increments score, and potentially increases level.
   */
  const handleWin = useCallback(() => {
    playWinSound();
    const newScore = score + 1;
    setScore(newScore);
    
    let nextLevel = level;
    // Increase level every 3 points
    if (newScore % SPEED_INCREMENT_THRESHOLD === 0) {
      nextLevel = level + 1;
      setLevel(nextLevel);
      playLevelUpSound();
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 2000);
    }
    
    // Reset frog and obstacles for the next round
    resetFrog(nextLevel);
    initObstacles(nextLevel);
  }, [score, level, resetFrog, initObstacles]);

  // --- Movement ---
  /**
   * Moves the frog in the specified direction.
   * @param dx Horizontal movement (-1, 0, 1)
   * @param dy Vertical movement (-1, 0, 1)
   */
  const moveFrog = useCallback((dx: number, dy: number) => {
    if (gameState !== 'playing') return;
    playJumpSound();
    
    const current = frogPosRef.current;
    const currentHeight = laneConfig.length;
    
    const newX = Math.max(0, Math.min(GRID_WIDTH - 1, current.x + dx));
    const newY = Math.max(0, Math.min(currentHeight - 1, current.y + dy));
    
    const nextPos = { x: newX, y: newY };
    
    // Update both state and ref immediately for sync
    setFrogPos(nextPos);
    frogPosRef.current = nextPos;

    // Check if goal reached (top row)
    if (newY === 0) {
      handleWin();
    }
  }, [gameState, handleWin, laneConfig]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      switch (key) {
        case 'arrowup':
        case 'w': moveFrog(0, -1); break;
        case 'arrowdown':
        case 's': moveFrog(0, 1); break;
        case 'arrowleft':
        case 'a': moveFrog(-1, 0); break;
        case 'arrowright':
        case 'd': moveFrog(1, 0); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moveFrog]);

  // --- Game Loop ---
  /**
   * The main game loop update function.
   * Handles obstacle movement, log-riding logic, and power-up spawning.
   * Uses refs for frog position and obstacles to maintain a stable 60fps loop.
   */
  const update = useCallback((time: number) => {
    if (gameState !== 'playing') return;

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;
    const dtFactor = deltaTime / 16;

    // 1. Update obstacles
    const nextObstacles = obstaclesRef.current.map(obs => {
      let newX = obs.x + obs.speed * dtFactor;
      const width = obs.type === 'log' ? 3 : 1;
      if (newX > GRID_WIDTH) newX = -width;
      if (newX < -width) newX = GRID_WIDTH;
      return { ...obs, x: newX };
    });
    setObstacles(nextObstacles);
    obstaclesRef.current = nextObstacles;

    // 2. Log-riding & River Collision
    const currentFrog = frogPosRef.current;
    const currentLanes = laneConfigRef.current;
    const frogLaneType = currentLanes[currentFrog.y];
    
    let onLog = false;
    let logSpeed = 0;

    if (frogLaneType === 'river') {
      const log = nextObstacles.find(obs => 
        obs.type === 'log' && 
        Math.round(obs.y) === currentFrog.y && 
        currentFrog.x >= obs.x - 0.5 && currentFrog.x <= obs.x + 2.5
      );
      
      if (log) {
        onLog = true;
        logSpeed = log.speed;
      } else {
        // Drowned in the river
        handleDeath();
        return;
      }
    }

    // 3. Car Collision
    if (frogLaneType === 'road') {
      const car = nextObstacles.find(obs => 
        obs.type === 'car' && 
        Math.round(obs.y) === currentFrog.y && 
        Math.abs(obs.x - currentFrog.x) < 0.7
      );
      if (car) {
        handleDeath();
        return;
      }
    }

    // 4. Heart Collection
    if (powerUpRef.current && 
        Math.round(powerUpRef.current.x) === Math.round(currentFrog.x) && 
        Math.round(powerUpRef.current.y) === Math.round(currentFrog.y)) {
      playPowerUpSound();
      setLives(prev => Math.min(INITIAL_LIVES, prev + 1));
      setPowerUp(null);
    }

    // 5. Move frog with log
    if (onLog) {
      const currentHeight = laneConfigRef.current.length;
      const nextX = Math.max(0, Math.min(GRID_WIDTH - 1, currentFrog.x + logSpeed * dtFactor));
      const nextPos = { ...currentFrog, x: nextX };
      setFrogPos(nextPos);
      frogPosRef.current = nextPos; // Update ref immediately to prevent stale checks
    }

    // 6. Random Heart spawn
    if (!powerUpRef.current && Math.random() < 0.001) {
      const currentHeight = laneConfigRef.current.length;
      setPowerUp({
        x: Math.floor(Math.random() * GRID_WIDTH),
        y: Math.floor(Math.random() * (currentHeight - 2)) + 1,
        type: 'heart',
        active: true,
      });
    }

    requestRef.current = requestAnimationFrame(update);
  }, [gameState, handleDeath]); // Stable loop

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(update);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, update]);

  // --- Collision Detection & Logic ---
  // Collision logic moved into game loop for better synchronization

  // --- Render Helpers ---
  /**
   * Determines the background color for a specific row based on its type (River, Road, Goal, etc.)
   */
  const getRowColor = (y: number) => {
    const type = laneConfig[y];
    switch (type) {
      case 'goal': return 'bg-emerald-500/20';
      case 'river': return 'bg-sky-500/30';
      case 'safe': return 'bg-stone-500/20';
      case 'road': return 'bg-slate-800/40';
      case 'start': return 'bg-green-600/20';
      default: return 'bg-transparent';
    }
  };

  /**
   * Memoized background grid to prevent unnecessary re-renders of the static board structure.
   */
  const backgroundGrid = React.useMemo(() => {
    return [...Array(GRID_WIDTH * gridHeight)].map((_, i) => {
      const y = Math.floor(i / GRID_WIDTH);
      return (
        <div 
          key={i} 
          className={cn("border-[0.5px] border-white/5", getRowColor(y))}
        />
      );
    });
  }, [gridHeight, laneConfig]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setGameState('start');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-emerald-400" size={48} />
      </div>
    );
  }

  return (
    <div ref={gameContainerRef} className="min-h-screen bg-stone-950 text-stone-100 flex flex-col items-center justify-center p-4 font-sans">
      <AuthBar user={user} onLogin={handleLogin} onLogout={handleLogout} />

      {/* Header */}
      <div className="w-full max-w-2xl flex justify-between items-end mb-6 px-4">
        <div className="flex flex-col">
          <h1 className="text-2xl font-black tracking-tighter text-emerald-400 italic">FROGGER QUEST</h1>
          <div className="flex gap-4 items-center mt-1">
            <div className="flex gap-3 text-[10px] font-mono font-bold uppercase tracking-widest text-stone-500">
              <span className="flex items-center gap-1"><Trophy size={10} className="text-yellow-500" /> PB {personalBest}</span>
              <span className="flex items-center gap-1"><Star size={10} className="text-emerald-500" /> LVL {level}</span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-4 items-center">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-stone-600 uppercase tracking-widest leading-none mb-1">Current Score</span>
              <div className="text-4xl font-black font-mono text-white leading-none">{score}</div>
            </div>
            <div className="h-8 w-[1px] bg-stone-800 mx-1" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-stone-600 uppercase tracking-widest leading-none mb-1">Lives</span>
              <div className="flex gap-1">
                {[...Array(INITIAL_LIVES)].map((_, i) => (
                  <Heart 
                    key={i} 
                    size={16} 
                    className={cn("transition-all duration-300", i < lives ? "fill-rose-500 text-rose-500 scale-110" : "text-stone-800 scale-90 opacity-30")} 
                  />
                ))}
              </div>
            </div>
          </div>
          
          <div className="flex gap-2">
            {gameState === 'playing' && (
              <>
                <button 
                  onClick={startGame}
                  className="p-1.5 bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors text-stone-500 hover:text-white border border-stone-800"
                  title="Restart"
                >
                  <RotateCcw size={14} />
                </button>
                <button 
                  onClick={() => setGameState('start')}
                  className="p-1.5 bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors text-stone-500 hover:text-white border border-stone-800"
                  title="Home"
                >
                  <Home size={14} />
                </button>
              </>
            )}
            <button 
              onClick={toggleFullscreen}
              className="p-1.5 bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors text-stone-500 hover:text-white border border-stone-800"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
            <button 
              onClick={() => setMuted(!muted)}
              className="p-1.5 bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors text-stone-500 hover:text-white border border-stone-800"
              title="Toggle Mute"
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Game Board */}
      <div className={cn(
        "relative bg-stone-900 rounded-2xl shadow-2xl border border-stone-800 min-h-[520px] flex items-center justify-center w-full max-w-[95vw] md:max-w-none",
        gameState === 'playing' ? "overflow-x-auto" : "overflow-x-hidden"
      )}>
        <div 
          className="relative transition-all duration-500 shrink-0 overflow-hidden"
          style={{ 
            width: GRID_WIDTH * TILE_SIZE, 
            height: gridHeight * TILE_SIZE,
          }}
        >
          <div 
            className="grid absolute inset-0"
            style={{ 
              gridTemplateColumns: `repeat(${GRID_WIDTH}, 1fr)`,
              gridTemplateRows: `repeat(${gridHeight}, 1fr)`
            }}
          >
            {backgroundGrid}
          </div>

          {/* Obstacles */}
          {obstacles.map(obs => (
            <motion.div
              key={obs.id}
              className="absolute text-2xl flex items-center justify-center pointer-events-none"
              style={{ 
                width: obs.type === 'log' ? TILE_SIZE * 3 : TILE_SIZE, 
                height: TILE_SIZE,
                left: obs.x * TILE_SIZE,
                top: obs.y * TILE_SIZE,
                zIndex: 10,
                // Center the emoji for logs
                textAlign: 'center',
                whiteSpace: 'nowrap'
              }}
            >
              {obs.emoji}
            </motion.div>
          ))}

          {/* Power-up (Heart) */}
          {powerUp && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="absolute text-2xl flex items-center justify-center z-20"
              style={{ 
                width: TILE_SIZE, 
                height: TILE_SIZE,
                left: powerUp.x * TILE_SIZE,
                top: powerUp.y * TILE_SIZE
              }}
            >
              ❤️
            </motion.div>
          )}

          {/* Frog */}
          <motion.div
            animate={{ 
              left: frogPos.x * TILE_SIZE, 
              top: frogPos.y * TILE_SIZE
            }}
            transition={{ 
              // Use a very fast tween for movement to stay in sync with logs
              // while still providing a tiny bit of smoothness for jumps.
              left: { type: 'tween', ease: 'linear', duration: 0.02 },
              top: { type: 'tween', ease: 'linear', duration: 0.02 }
            }}
            className="absolute text-3xl flex items-center justify-center z-30 pointer-events-none"
            style={{ width: TILE_SIZE, height: TILE_SIZE }}
          >
            🐸
          </motion.div>
        </div>

        {/* Overlays */}
        <AnimatePresence>
          {showLevelUp && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1.5 }}
              exit={{ opacity: 0, scale: 2 }}
              className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
            >
              <div className="bg-emerald-500/20 backdrop-blur-sm px-8 py-4 rounded-3xl border border-emerald-500/50 shadow-2xl">
                <h2 className="text-4xl font-black text-emerald-400 tracking-tighter italic">LEVEL UP!</h2>
                <div className="text-center text-stone-300 font-mono text-xs mt-1 uppercase tracking-widest">Difficulty Increased</div>
              </div>
            </motion.div>
          )}

          {gameState === 'start' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-stone-950/90 backdrop-blur-md overflow-y-auto"
            >
              <div className="min-h-full flex flex-col items-center justify-center p-8 text-center">
                <div className="mb-6 p-4 bg-emerald-500/20 rounded-full shrink-0">
                  <Play size={48} className="text-emerald-400 ml-1" />
                </div>
                <h2 className="text-3xl font-black mb-2 tracking-tighter italic text-emerald-400 shrink-0">FROGGER QUEST</h2>
                
                {showInfo ? (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full max-w-[320px] mb-8"
                >
                  <div className="grid grid-cols-2 gap-4 text-left bg-white/5 p-4 rounded-2xl border border-white/5 mb-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">Controls</span>
                      <span className="text-xs text-stone-300">Arrow keys or WASD to move.</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">Goal</span>
                      <span className="text-xs text-stone-300">Reach the top to score!</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">Hazards</span>
                      <span className="text-xs text-stone-300">Avoid cars and water!</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">Pickups</span>
                      <span className="text-xs text-stone-300">Collect ❤️ for lives.</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => setShowInfo(false)}
                    className="text-stone-500 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    Close Info
                  </button>
                </motion.div>
              ) : showLeaderboard ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center w-full"
                >
                  <div className="mb-6">
                    <Leaderboard entries={leaderboard} />
                  </div>
                  <button 
                    onClick={() => setShowLeaderboard(false)}
                    className="text-stone-500 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    Back to Menu
                  </button>
                </motion.div>
              ) : (
                <div className="flex flex-col gap-4 w-full max-w-[240px]">
                  <button 
                    onClick={startGame}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-bold py-3 px-8 rounded-full transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                  >
                    START GAME
                  </button>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setShowInfo(true)}
                      className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-100 font-bold py-3 px-4 rounded-full transition-all active:scale-95 border border-white/10 flex items-center justify-center gap-2 text-xs"
                    >
                      INFO
                    </button>
                    <button 
                      onClick={() => setShowLeaderboard(true)}
                      className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-100 font-bold py-3 px-4 rounded-full transition-all active:scale-95 border border-white/10 flex items-center justify-center gap-2 text-xs"
                    >
                      SCORES
                    </button>
                  </div>
                  <button 
                    onClick={() => {
                      soundManager.unlock();
                      playJumpSound();
                    }}
                    className="w-full bg-stone-900/50 hover:bg-stone-800 text-stone-400 hover:text-white font-bold py-2 px-4 rounded-full transition-all active:scale-95 border border-white/5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-widest"
                  >
                    <Volume2 size={12} />
                    Test Sound
                  </button>
                </div>
              )}
            </div>
          </motion.div>
          )}

          {gameState === 'gameover' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 z-50 bg-stone-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center overflow-y-auto"
            >
              <div className="mb-4 text-6xl">💀</div>
              <h2 className="text-4xl font-black mb-1 tracking-tighter text-rose-500">GAME OVER</h2>
              <p className="text-stone-500 text-xs uppercase tracking-widest mb-6">Final Score: {score}</p>
              
              <div className="w-full max-w-[240px] bg-stone-900/50 rounded-2xl p-4 mb-6 border border-white/5">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] text-stone-500 uppercase font-bold">Personal Best</span>
                  <span className="font-mono text-yellow-500">{personalBest}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-stone-500 uppercase font-bold">Lives Left</span>
                  <span className="font-mono text-rose-500">0</span>
                </div>
              </div>

              {/* Leaderboard */}
              <div className="w-full flex justify-center mb-8">
                <Leaderboard entries={leaderboard} />
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={startGame}
                  className="flex items-center gap-2 bg-stone-100 hover:bg-white text-stone-950 font-bold py-3 px-6 rounded-full transition-all active:scale-95"
                >
                  <RotateCcw size={18} />
                  RESTART
                </button>
                <button 
                  onClick={() => setGameState('start')}
                  className="flex items-center gap-2 bg-stone-800 hover:bg-stone-700 text-stone-100 font-bold py-3 px-6 rounded-full transition-all active:scale-95 border border-white/10"
                >
                  <Home size={18} />
                  HOME
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile Controls */}
      <div className="mt-8 grid grid-cols-3 gap-2 md:hidden">
        <div />
        <ControlButton icon={<ArrowUp />} onClick={() => moveFrog(0, -1)} />
        <div />
        <ControlButton icon={<ArrowLeft />} onClick={() => moveFrog(-1, 0)} />
        <ControlButton icon={<ArrowDown />} onClick={() => moveFrog(0, 1)} />
        <ControlButton icon={<ArrowRight />} onClick={() => moveFrog(1, 0)} />
      </div>

      {/* Instructions */}
      <div className="mt-8 text-center hidden md:block">
        <p className="text-stone-500 text-xs uppercase tracking-widest">Use Arrow Keys to Move</p>
      </div>
    </div>
  );
}

function ControlButton({ icon, onClick }: { icon: React.ReactNode; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-14 h-14 bg-stone-800 active:bg-stone-700 rounded-2xl flex items-center justify-center text-stone-300 shadow-lg active:scale-90 transition-all border border-white/5"
    >
      {icon}
    </button>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Game />
      </AuthProvider>
    </ErrorBoundary>
  );
}
