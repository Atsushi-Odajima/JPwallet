import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { notificationText } from '../i18n/labels';
import { useMarkNotificationsRead, useNotifications } from '../lib/queries';
import { EmptyState, formatDate } from './ui';

/** ヘッダーの通知ベル（10 秒ごとにポーリング） */
export function NotificationBell() {
  const q = useNotifications(10_000);
  const mark = useMarkNotificationsRead();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = q.data?.unread_count ?? 0;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={t('notif.aria')}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread > 0) mark.mutate(undefined);
        }}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-2 py-1 text-xs font-semibold text-slate-500">{t('notif.title')}</p>
          {q.data && q.data.data.length === 0 && <EmptyState>{t('notif.empty')}</EmptyState>}
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {q.data?.data.map((n) => {
              const text = notificationText(t, locale, n);
              return (
                <li key={n.id} className={`px-2 py-2 ${n.read_at ? '' : 'bg-brand-50/60'}`}>
                  <p className="text-sm font-medium text-slate-800">{text.title}</p>
                  {text.body && <p className="text-xs text-slate-600">{text.body}</p>}
                  <p className="mt-0.5 text-[10px] text-slate-400">{formatDate(n.created_at)}</p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
