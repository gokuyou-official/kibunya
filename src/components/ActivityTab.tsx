// アクティビティタブ切替UI(ホーム上部)
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { colors } from '../config/colors';
import { ACTIVITIES, ActivityId, getActivity } from '../config/activities';

type Props = {
  // 表示するアクティビティID(ユーザーが選択中の興味)
  availableIds: ActivityId[];
  activeId: ActivityId | null;
  onChange: (id: ActivityId) => void;
};

export default function ActivityTab({ availableIds, activeId, onChange }: Props) {
  if (availableIds.length === 0) return null;

  const items = ACTIVITIES.filter((a) => availableIds.includes(a.id));

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {items.map((a) => {
        const on = a.id === activeId;
        return (
          <Pressable
            key={a.id}
            onPress={() => onChange(a.id)}
            style={({ pressed }) => [
              styles.tab,
              on && styles.tabOn,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.emoji}>{a.waitEmoji}</Text>
            <Text style={[styles.label, on && styles.labelOn]}>
              {a.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginRight: 8,
  },
  tabOn: {
    backgroundColor: 'rgba(245,197,24,0.18)',
    borderColor: colors.yamabuki,
  },
  emoji: { fontSize: 18 },
  label: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
  },
  labelOn: { color: colors.cream, fontWeight: '600' },
});
