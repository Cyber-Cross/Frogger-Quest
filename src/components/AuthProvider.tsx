import React, { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged, User, doc, getDoc, setDoc, updateDoc, serverTimestamp, handleFirestoreError, OperationType, auth, db } from '../firebase';
import { AuthContextType } from '../types';

export const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
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
};

export const useAuth = () => useContext(AuthContext);
