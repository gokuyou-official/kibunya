// HomeScreen の「待ちますかー」状態を、画面ツリーの外から解除するための仕組み。
//
// なぜ Context が要るか:
//   MatchOverlay と useMatchEvents は App.tsx の Root に置かれており、
//   NavigationContainer の外にいる。一方 HomeScreen は
//   Root → NavigationContainer → MainTabs → Tab.Screen の奥にあるため、
//   props で直接つなぐことができない。navigationRef 経由で setParams する
//   手もあるが、対象スクリーンの route key に依存して壊れやすい。
//   「上から下へ一方向に合図を流すだけ」なので軽い Context が素直。
//
// 仕組み:
//   Root が resetToken (単調増加のカウンタ) を持ち、「かー」を検知した
//   タイミングでインクリメントする。HomeScreen は値の変化だけを見て
//   waiting を false にする。タイムスタンプではなくカウンタなのは、
//   同一ミリ秒に 2 回発火した際に値が変わらず取りこぼすのを避けるため。
import React, { createContext, useContext, useMemo } from 'react';

type WaitingResetValue = {
  // 値が変わったら「待機を解除せよ」の合図。初期値 0 では何もしない。
  resetToken: number;
};

const WaitingResetContext = createContext<WaitingResetValue>({ resetToken: 0 });

export function WaitingResetProvider({
  resetToken,
  children,
}: {
  resetToken: number;
  children: React.ReactNode;
}) {
  // Root は認証状態やプロフィールの更新でも再 render される。value を
  // 毎回新しいオブジェクトにすると、その度に consumer まで再 render が
  // 伝播してしまうので resetToken が変わった時だけ作り直す。
  const value = useMemo(() => ({ resetToken }), [resetToken]);
  return (
    <WaitingResetContext.Provider value={value}>
      {children}
    </WaitingResetContext.Provider>
  );
}

export function useWaitingReset() {
  return useContext(WaitingResetContext);
}
