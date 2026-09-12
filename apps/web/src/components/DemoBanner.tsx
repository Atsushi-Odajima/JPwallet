import { useI18n } from '../i18n';

/**
 * デモ表示は TOP ページ（/）の最下部にだけ置く（仕様 §0）。
 * 他の画面には出さない（上部の帯は見た目を損ねるため廃止）。
 */
export function DemoFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-8 border-t border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
      <p className="font-semibold text-slate-700">{t('demo.notice')}</p>
      <p className="mt-1">{t('demo.line1')}</p>
      <p className="mt-1">{t('demo.line2')}</p>
    </footer>
  );
}
