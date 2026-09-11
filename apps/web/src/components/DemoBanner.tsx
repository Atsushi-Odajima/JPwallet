import { DEMO_NOTICE } from '@payccount/shared';

/**
 * デモ表示は TOP ページ（/）の最下部にだけ置く（仕様 §0）。
 * 他の画面には出さない（上部の帯は見た目を損ねるため廃止）。
 */
export function DemoFooter() {
  return (
    <footer className="mt-8 border-t border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
      <p className="font-semibold text-slate-700">{DEMO_NOTICE}</p>
      <p className="mt-1">payCcount は「クレジット決済・QR決済に続く第3の国内決済手段」の構想を示す動くプロトタイプです。</p>
      <p className="mt-1">法規制対応・実際の決済／為替／ブロックチェーン接続はスコープ外です。</p>
    </footer>
  );
}
