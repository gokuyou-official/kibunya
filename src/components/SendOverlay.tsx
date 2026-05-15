// 「いきますかー」送信成功時のオーバーレイ → 「待ちますかー」表示
import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
} from 'react-native';
import { colors } from '../config/colors';
import { ActivityId, getActivity } from '../config/activities';

type Props = {
  visible: boolean;
  onClose: () => void;
  activityId?: ActivityId;
};

export default function SendOverlay({ visible, onClose, activityId }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.6)).current;

  const activity = getActivity(activityId);

  useEffect(() => {
    if (visible) {
      opacity.setValue(0);
      scale.setValue(0.6);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          friction: 5,
          tension: 120,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, opacity, scale]);

  const handleClose = () => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Animated.View style={[styles.content, { transform: [{ scale }] }]}>
          <Text style={styles.emoji}>{activity.waitEmoji}</Text>
          <Text style={styles.title}>待ちますかー</Text>
          <Text style={styles.sub}>友達に届きました</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>とじる</Text>
          </Pressable>
        </Animated.View>
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
  content: {
    alignItems: 'center',
    gap: 10,
  },
  emoji: {
    fontSize: 84,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.cream,
  },
  sub: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
    marginBottom: 24,
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
