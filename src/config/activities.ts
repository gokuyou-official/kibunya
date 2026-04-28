// アクティビティ定義(興味リスト + マッチング絵文字)
export type ActivityId = 'drinking' | 'sauna' | 'lunch' | 'mahjong';

export type ActivityDef = {
  id: ActivityId;
  label: string;
  // 送信待ち状態(ホームや通知カードで表示)
  waitEmoji: string;
  // マッチ成立時の絵文字
  matchEmoji: string;
  // 送信コピー
  sendCopy: string;
  // 待機コピー
  waitCopy: string;
};

export const ACTIVITIES: ActivityDef[] = [
  {
    id: 'drinking',
    label: 'ちょい飲み',
    waitEmoji: '🍺',
    matchEmoji: '🍻',
    sendCopy: 'ちょい飲みの気分？',
    waitCopy: '誘ってないけど知っている',
  },
  {
    id: 'sauna',
    label: 'サウナ',
    waitEmoji: '🧖‍♀️',
    matchEmoji: '♨️',
    sendCopy: 'サウナの気分？',
    waitCopy: '整いたいだけ。誰かが来たら一緒に整う。',
  },
  {
    id: 'lunch',
    label: 'ランチ',
    waitEmoji: '🍜',
    matchEmoji: '🍽️',
    sendCopy: 'ランチの気分？',
    waitCopy: 'お腹すいた。誰かと食べたい気分。',
  },
  {
    id: 'mahjong',
    label: '麻雀',
    waitEmoji: '🀄',
    matchEmoji: '💸',
    sendCopy: '麻雀の気分？',
    waitCopy: '卓を囲みたいだけ。誰か来たら打つ。',
  },
];

export function getActivity(id: ActivityId | string | undefined): ActivityDef {
  return ACTIVITIES.find((a) => a.id === id) ?? ACTIVITIES[0];
}
