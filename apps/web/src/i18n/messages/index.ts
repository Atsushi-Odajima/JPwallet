import { admin } from './admin';
import { common } from './common';
import { merchant } from './merchant';
import { user } from './user';

/** 全名前空間を結合した辞書。キーは各ファイルの接頭辞（common は無印、u. / m. / a.）で衝突しない */
const ja = { ...common.ja, ...user.ja, ...merchant.ja, ...admin.ja };
const en = { ...common.en, ...user.en, ...merchant.en, ...admin.en };

export type MessageKey = keyof typeof ja;
export const messages: Record<'ja' | 'en', Record<MessageKey, string>> = { ja, en };

export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(ja, key);
}
