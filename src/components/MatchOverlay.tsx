// マッチ後オーバーレイ: 友達の「かー」リアクション着信時に表示する祝祭演出
// レイアウト: matchEmoji (大型) → 「かー」 (大型テキスト) → 「{senderName}から」 (サブ)
// SendOverlay と並列に管理し、関心事を分離する
import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  Easing,
} from 'react-native';
import { colors } from '../config/colors';
import { ActivityId, getActivity } from '../config/activities';

type Props = {
  visible: boolean;
  senderName: string;
  activityId: ActivityId;
  onClose: () => void;
};

export default function MatchOverlay({ visible, senderName, activityId, onClose }: Props) {
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const emojiScale = useRef(new Animated.Value(0.4)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(-20)).current;
  const subOpacity = useRef(new Animated.Value(0)).current;

  const activity = getActivity(activityId);

  useEffect(() => {
    if (!visible) return;
    backdropOpacity.setValue(0);
    emojiScale.setValue(0.4);
    titleOpacity.setValue(0);
    titleTranslateY.setValue(-20);
    subOpacity.setValue(0);

    // タイムライン (合計 ~700ms)
    Animated.parallel([
      // t=0: backdrop fade-in
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      // t=0: matchEmoji bounce scale (spring)
      Animated.spring(emojiScale, {
        toValue: 1,
        friction: 4,
        tension: 140,
        useNativeDriver: true,
      }),
      // t=100ms: 「かー」 slide-down + fade-in
      Animated.sequence([
        Animated.delay(100),
        Animated.parallel([
          Animated.timing(titleOpacity, {
            toValue: 1,
            duration: 250,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(titleTranslateY, {
            toValue: 0,
            duration: 250,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
      // t=350ms: サブ fade-in
      Animated.sequence([
        Animated.delay(350),
        Animated.timing(subOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [visible, backdropOpacity, emojiScale, titleOpacity, titleTranslateY, subOpacity]);

  const handleClose = () => {
    Animated.timing(backdropOpacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Animated.View style={[styles.emojiBox, { transform: [{ scale: emojiScale }] }]}>
          <Text style={styles.emoji}>{activity.matchEmoji}</Text>
        </Animated.View>

        <Animated.Text
          style={[
            styles.title,
            { opacity: titleOpacity, transform: [{ translateY: titleTranslateY }] },
          ]}
        >
          かー
        </Animated.Text>

        <Animated.Text style={[styles.sub, { opacity: subOpacity }]}>
          {senderName}から
        </Animated.Text>

        <Pressable onPress={handleClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>とじる</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,46,85,0.96)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emojiBox: {
    marginBottom: 16,
  },
  emoji: {
    fontSize: 120,
  },
  title: {
    fontSize: 60,
    fontWeight: '800',
    color: colors.cream,
    letterSpacing: 2,
    marginBottom: 12,
  },
  sub: {
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: 36,
  },
  closeBtn: {
    paddingHorizontal: 36,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,249,236,0.12)',
  },
  closeText: {
    fontSize: 14,
    color: colors.cream,
    fontWeight: '500',
  },
});
