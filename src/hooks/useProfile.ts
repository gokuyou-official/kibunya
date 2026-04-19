// ユーザーの興味リスト(アクティビティ) + プロフィール管理
import { useEffect, useState, useCallback } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActivityId } from '../config/activities';

export type Profile = {
  name: string;
  email: string;
  area: string;
  bio: string;
  interests: ActivityId[];
};

const DEFAULTS: Profile = {
  name: '',
  email: '',
  area: '',
  bio: '',
  interests: [],
};

export function useProfile(currentUserId: string | undefined) {
  const [profile, setProfile] = useState<Profile>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUserId) {
      setProfile(DEFAULTS);
      setLoading(false);
      return;
    }
    const ref = doc(db, 'users', currentUserId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const d = snap.data() ?? {};
        setProfile({
          name: d.name ?? '',
          email: d.email ?? '',
          area: d.area ?? '',
          bio: d.bio ?? '',
          interests: Array.isArray(d.interests) ? d.interests : [],
        });
        setLoading(false);
      },
      (err) => {
        console.error('useProfile onSnapshot error', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [currentUserId]);

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!currentUserId) return;
      try {
        await setDoc(
          doc(db, 'users', currentUserId),
          { ...patch, updatedAt: serverTimestamp() },
          { merge: true },
        );
      } catch (e) {
        console.error('updateProfile error', e);
        throw e;
      }
    },
    [currentUserId],
  );

  const setInterests = useCallback(
    (interests: ActivityId[]) => updateProfile({ interests }),
    [updateProfile],
  );

  return { profile, loading, updateProfile, setInterests };
}
