// 送信した気分の「締め」を伝えるカード。
//
// 2 つの終わり方で同じ見た目を使う:
//   🍻 「かー」が返ってきた   … 何人から返事が来たか
//   🍺 3時間経過して返事なし … 「気分じゃないかも？」
//
// 以前、返事なしの方だけ 2.5 秒で自動的に消えるポップアップだった。
// その瞬間に画面を見ていないと気づけず、痕跡も残らないため
// 「送ったのに何も起きなかった」ようにしか見えなかった。
// 返事があった時と同じく、ユーザーが自分で閉じるまで残す形に揃える。
//
// 閉じる = mood に closedAt を入れる、なので閉じずにアプリを終了しても
// 次回起動時にまた出る (購読クエリが closedAt == null を見ているため)。
//
// ★ 全画面を覆うが pointerEvents は既定 (auto) のままにする。
//   このカードは「閉じる」操作を要求する画面なので、裏側のタップを
//   拾わせない方が正しい。自動で消える通知レイヤー
//   (WaitingExpiredNotice) とは性質が違う。
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { colors } from '../config/colors';

type Props = {
  visible: boolean;
  emoji: string;
  title: string;
  sub: string;
  // 残り時間などの補足。省略すると行ごと出さない。
  footer?: string;
  onClose: () => void;
};

export default function MoodClosingCard({
  visible,
  emoji,
  title,
  sub,
  footer,
  onClose,
}: Props) {
  if (!visible) return null;

  return (
    <View style={styles.layer}>
      <View style={styles.card}>
        <Text style={styles.emoji}>{emoji}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{sub}</Text>
        {footer ? <Text style={styles.footer}>{footer}</Text> : null}
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.9 }]}
        >
          <Text style={styles.btnText}>とじる</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,20,40,0.86)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.aiDeep,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  emoji: { fontSize: 56, marginBottom: 12 },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.yamabuki,
    textAlign: 'center',
  },
  sub: {
    marginTop: 8,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  footer: {
    marginTop: 14,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  btn: {
    marginTop: 22,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.shu,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
