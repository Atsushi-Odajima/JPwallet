import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-5xl font-bold text-slate-300">404</p>
        <p className="mt-2 text-slate-600">ページが見つかりません</p>
        <Link to="/" className="mt-4 inline-block text-sm text-brand-600 underline">
          ホームへ戻る
        </Link>
      </div>
    </div>
  );
}
