// フレンド一覧画面(v2: ダーク基調)
import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../config/colors';
import { useAuth } from '../hooks/useAuth';
import { useFriends, Friend } from '../hooks/useFriends';
import { generateInviteLink } from '../utils/inviteLink';

export default function FriendsScreen() {
  const { currentUser, signOut } = useAuth();
  const { friends, loading } = useFriends(currentUser?.uid);

  const handleInvite = useCallback(async () => {
    if (!currentUser) return;
    try {
      const link = generateInviteLink(currentUser.uid);
      await Share.share({
        message: `KIBUNYAで一緒に気分を置いておこう🍺\n${link}`,
      });
    } catch (e: any) {
      Alert.alert('共有できませんでした', e?.message ?? '');
    }
  }, [currentUser]);

  const renderItem = ({ item }: { item: Friend }) => (
    <View style={styles.row}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{item.name.slice(0, 1)}</Text>
      </View>
      <Text style={styles.name}>{item.name}</Text>
      <View
        style={[
          styles.dot,
          { backgroundColor: item.isOnline ? colors.online : colors.offline },
        ]}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>フレンド</Text>
        <Pressable
          onPress={handleInvite}
          style={({ pressed }) => [
            styles.inviteBtn,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.inviteText}>招待する</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.shu} />
      ) : friends.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🫂</Text>
          <Text style={styles.emptyText}>まだフレンドがいません</Text>
          <Text style={styles.emptySub}>「招待する」から友達を呼ぼう</Text>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}

      <Pressable
        onPress={() => signOut()}
        style={({ pressed }) => [
          styles.logoutBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.logoutText}>ログアウト</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ai,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.cream,
  },
  inviteBtn: {
    backgroundColor: colors.shu,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  inviteText: {
    color: colors.cream,
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    marginBottom: 8,
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.yamabuki,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.ai,
    fontWeight: '700',
  },
  name: {
    flex: 1,
    fontSize: 14,
    color: colors.cream,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.cream,
    fontWeight: '500',
  },
  emptySub: {
    fontSize: 12,
    color: colors.textMuted,
  },
  logoutBtn: {
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 12,
  },
  logoutText: {
    fontSize: 12,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});
