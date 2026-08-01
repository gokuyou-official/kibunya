// 「待ちますかー」が3時間経過で自動解除される時に、一瞬だけ出す一言。
//
// 設計上の制約:
//   - システムダイアログ (Alert.alert) は世界観に合わないので使わない。
//   - ユーザーの操作を要求せず、自動で消える。
//   - Modal ではなく画面内の絶対配置レイヤーにし、さらに
//     pointerEvents="none" を付ける。SendOverlay / MatchOverlay の
//     コメントにある通り、全画面を覆う透明ビューが残るとタッチを
//     奪って操作不能になる事故が起きうるため、そもそも当たり判定を
//     持たせない形にしている。
//
// タイムライン (合計 2.5 秒):
//   フェードイン 300ms → 保持 1800ms → フェードアウト 400ms → onFinish()
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { colors } from '../config/colors';

const FADE_IN_MS = 300;
const HOLD_MS = 1800;
const FADE_OUT_MS = 400;

type Props = {
  visible: boolean;
  // フェードアウト完了後に呼ばれる。呼び出し側はここで待機状態を解除する。
  onFinish: () => void;
};

export default function WaitingExpiredNotice({ visible, onFinish }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  // onFinish の識別子が変わってもアニメーションを作り直さないよう ref 経由で呼ぶ
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    if (!visible) return;

    opacity.setValue(0);
    translateY.setValue(8);

    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: FADE_IN_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(HOLD_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    anim.start(({ finished }) => {
      // 途中で中断された場合 (先に「かー」が返ってきた等) は何もしない。
      // 解除は中断させた側の経路が既に行っている。
      if (finished) onFinishRef.current();
    });

    return () => anim.stop();
  }, [visible, opacity, translateY]);

  if (!visible) return null;

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View
        style={[styles.card, { opacity, transform: [{ translateY }] }]}
      >
        <Text style={styles.text}>キブンじゃないかも？</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: colors.aiDeep,
    borderWidth: 1,
    borderColor: colors.yamabuki,
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 26,
  },
  text: {
    color: colors.cream,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
});
