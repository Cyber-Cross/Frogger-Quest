import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Loader2, User as UserIcon } from 'lucide-react';
import { collection, query, orderBy, limit, onSnapshot, db, handleFirestoreError, OperationType } from '../firebase';
import { LeaderboardEntry } from '../types';

import { useAuth } from './AuthProvider';

export const Leaderboard: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user) {
      if (!authLoading) setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, 'highscores'), orderBy('score', 'desc'), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as LeaderboardEntry);
      setEntries(data);
      setLoading(false);
    }, (err) => {
      // If it's a permission error, we might still be in a transition state
      if (err.code === 'permission-denied') {
        console.warn('Firestore permission denied for highscores. User might not be fully authenticated yet.');
        return;
      }
      handleFirestoreError(err, OperationType.LIST, 'highscores');
    });

    return () => unsubscribe();
  }, [user, authLoading]);

  if (authLoading || (loading && user)) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-5 h-5 text-yellow-500" />
        <h3 className="text-lg font-bold text-stone-200">Top Frogs</h3>
      </div>
      
      {!user ? (
        <div className="bg-stone-800/50 border border-stone-700/50 rounded-xl p-6 text-center">
          <p className="text-stone-400 text-sm mb-2">Login to see the global leaderboard!</p>
        </div>
      ) : entries.length === 0 ? (
        <p className="text-stone-500 text-center py-4">No scores yet. Be the first!</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              key={entry.uid}
              className="flex items-center justify-between p-3 rounded-xl bg-stone-800/50 border border-stone-700/50"
            >
              <div className="flex items-center gap-3">
                <span className={i < 3 ? "text-yellow-500 font-bold w-4" : "text-stone-500 w-4"}>
                  {i + 1}
                </span>
                <div className="w-8 h-8 rounded-full bg-stone-700 overflow-hidden flex items-center justify-center">
                  {entry.photoURL ? (
                    <img src={entry.photoURL} alt={entry.displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <UserIcon className="w-4 h-4 text-stone-500" />
                  )}
                </div>
                <span className="text-stone-300 font-medium truncate max-w-[120px]">
                  {entry.displayName}
                </span>
              </div>
              <span className="text-emerald-400 font-bold font-mono">
                {entry.score.toLocaleString()}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};
