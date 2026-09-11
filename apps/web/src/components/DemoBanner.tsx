import { DEMO_NOTICE } from '@payccount/shared';
import { FlaskConical } from 'lucide-react';

/** 全画面に表示するデモ表示 */
export function DemoBanner() {
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-amber-950">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      <span>{DEMO_NOTICE} 実際の資金・カード・暗号資産は扱いません。</span>
    </div>
  );
}

/** TOP ページのフッター */
export function DemoFooter() {
  return (
    <footer className="mt-8 border-t border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
      <p className="font-semibold text-slate-700">{DEMO_NOTICE}</p>
      <p className="mt-1">payCcount は「クレジット決済・QR決済に続く第3の国内決済手段」の構想を示す動くプロトタイプです。</p>
      <p className="mt-1">法規制対応・実際の決済／為替／ブロックチェーン接続はスコープ外です。</p>
    </footer>
  );
}
