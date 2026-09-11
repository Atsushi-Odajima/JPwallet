import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useSearchParams } from 'react-router-dom';
import { SHOP, formatPrice, type Product } from '../shop.config';
import type { Order } from '../functions/_lib/store';

const T = SHOP.texts;
const CART_KEY = `${SHOP.id}.cart`;

type Cart = Record<string, number>;

function useCart() {
  const [cart, setCart] = useState<Cart>(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart]);
  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const remove = (id: string) =>
    setCart((c) => {
      const n = { ...c };
      delete n[id];
      return n;
    });
  const setQty = (id: string, qty: number) => setCart((c) => (qty <= 0 ? (({ [id]: _, ...rest }) => rest)(c) : { ...c, [id]: qty }));
  const clear = () => setCart({});
  return { cart, add, remove, setQty, clear };
}

interface Config {
  configured: boolean;
  webhook_configured: boolean;
  api_url: string;
  storage: string;
}

export function App() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json() as Promise<Config>)
      .then((c) => setConfig(c))
      .catch(() => setConfig(null));
  }, []);
  return (
    <div className="min-h-screen">
      <div className="bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-amber-950">{T.demo}</div>
      <header className="border-b border-sky-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-xl font-bold text-sky-800">
            🌎 {SHOP.name}
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/" className="hover:underline">
              {T.products}
            </Link>
            <Link to="/orders" className="hover:underline">
              {T.orders}
            </Link>
          </nav>
        </div>
      </header>
      {config && !config.configured && (
        <div className="mx-auto mt-4 max-w-5xl rounded-lg border border-sky-300 bg-sky-100 px-4 py-3 text-sm text-sky-900">
          <p className="font-semibold">{T.setupTitle}</p>
          <p>{T.setupBody}</p>
        </div>
      )}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<ShopPage />} />
          <Route path="/thanks" element={<ThanksPage />} />
          <Route path="/orders" element={<OrdersPage />} />
        </Routes>
      </main>
      <footer className="mt-10 border-t border-sky-100 px-4 py-6 text-center text-xs text-slate-500">
        {SHOP.name} — {T.demo}
        {config && (
          <span className="ml-2">
            (payCcount API: {config.api_url} / storage: {config.storage})
          </span>
        )}
      </footer>
    </div>
  );
}

function ShopPage() {
  const { cart, add, remove, setQty, clear } = useCart();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = useMemo(
    () => Object.entries(cart).map(([id, qty]) => ({ product: SHOP.products.find((p) => p.id === id)!, qty })).filter((l) => l.product),
    [cart],
  );
  const total = lines.reduce((s, l) => s + BigInt(l.product.price) * BigInt(l.qty), 0n);

  const checkout = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines.map((l) => ({ id: l.product.id, qty: l.qty })) }),
      });
      const json = (await res.json()) as { url?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      clear();
      window.location.assign(json.url ?? "/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <section>
        <p className="mb-4 text-sm text-slate-600">{SHOP.tagline}</p>
        {params.get('canceled') && <p className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm">Payment was canceled (order {params.get('canceled')}).</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SHOP.products.map((p: Product) => (
            <article key={p.id} className="flex flex-col rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
              <div className="flex h-28 items-center justify-center rounded-xl bg-sky-50 text-5xl">{p.emoji}</div>
              <h2 className="mt-3 font-semibold">{p.name}</h2>
              <p className="flex-1 text-xs text-slate-500">{p.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-bold tabular-nums">{formatPrice(p.price)}</span>
                <button type="button" onClick={() => add(p.id)} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">
                  {T.add}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <aside className="h-fit rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
        <h2 className="font-semibold">{T.cart}</h2>
        {lines.length === 0 && <p className="mt-2 text-sm text-slate-500">{T.empty}</p>}
        <ul className="mt-2 divide-y divide-sky-50 text-sm">
          {lines.map((l) => (
            <li key={l.product.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate">{l.product.name}</p>
                <p className="text-xs text-slate-500">{formatPrice(l.product.price)}</p>
              </div>
              <input
                type="number"
                min={1}
                max={99}
                value={l.qty}
                aria-label={T.qty}
                onChange={(e) => setQty(l.product.id, Number(e.target.value))}
                className="w-14 rounded border border-slate-300 px-1 py-0.5 text-right"
              />
              <button type="button" onClick={() => remove(l.product.id)} className="text-xs text-slate-400 hover:text-sky-600">
                {T.remove}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-sky-100 pt-3">
          <span className="text-sm text-slate-600">{T.total}</span>
          <span className="text-lg font-bold tabular-nums">{formatPrice(total.toString())}</span>
        </div>
        {error && <p className="mt-2 rounded bg-sky-100 px-2 py-1 text-xs text-sky-800">{error}</p>}
        <button
          type="button"
          disabled={lines.length === 0 || busy}
          onClick={checkout}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1e3a8a] px-4 py-3 font-semibold text-white shadow hover:bg-[#312e81] disabled:opacity-50"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-sm font-extrabold text-[#1e3a8a]">P</span>
          {busy ? '…' : T.checkout}
        </button>
        <p className="mt-2 text-[11px] text-slate-500">{T.checkoutHint}</p>
      </aside>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'paid' ? 'bg-emerald-100 text-emerald-800' : status === 'pending' ? 'bg-amber-100 text-amber-800' : status.includes('refund') ? 'bg-slate-200 text-slate-700' : 'bg-sky-100 text-sky-800';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{T.statusLabels[status] ?? status}</span>;
}

function ThanksPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id');
  const [order, setOrder] = useState<Order | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let stop = false;
    const load = async () => {
      const r = await fetch(`/api/orders/${sessionId}`);
      if (r.ok) setOrder(await r.json());
    };
    load();
    const id = setInterval(() => {
      if (!stop) load();
    }, 2000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [sessionId]);
  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-sky-100 bg-white p-6 text-center shadow-sm">
      <p className="text-4xl">🎉</p>
      <h1 className="mt-2 text-xl font-bold">{T.thanksTitle}</h1>
      {order && (
        <div className="mt-4 text-left text-sm">
          <p className="text-slate-500">
            {T.order} {order.id}
          </p>
          <ul className="mt-1 divide-y divide-sky-50">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between py-1">
                <span>
                  {i.name} ×{i.qty}
                </span>
                <span className="tabular-nums">{formatPrice((BigInt(i.price) * BigInt(i.qty)).toString())}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between font-bold">
            <span>{T.total}</span>
            <span>{formatPrice(order.total)}</span>
          </p>
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="flex items-center justify-between">
              <span>{T.status}</span>
              <StatusBadge status={order.status} />
            </p>
            <p className="mt-1 text-xs text-slate-600">{order.status === 'paid' ? T.thanksPaid : T.thanksWaiting}</p>
            {order.webhooks.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {order.webhooks.map((w) => (
                  <li key={w.event_id} className="font-mono">
                    {w.type} · {w.event_id}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="mt-4 flex justify-center gap-3 text-sm">
        <Link to="/" className="text-sky-800 underline">
          {T.backToShop}
        </Link>
        <Link to="/orders" className="text-sky-800 underline">
          {T.viewOrders}
        </Link>
      </div>
    </div>
  );
}

function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  useEffect(() => {
    const load = () =>
      fetch('/api/orders')
        .then((r) => r.json())
        .then((j) => setOrders((j as { data?: Order[] }).data ?? []));
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">{T.orders}</h1>
      {orders.length === 0 && <p className="text-sm text-slate-500">—</p>}
      <div className="space-y-3">
        {orders.map((o) => (
          <article key={o.id} className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{o.id}</p>
                <p className="text-xs text-slate-500">{new Date(o.created_at).toLocaleString(SHOP.locale)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold tabular-nums">{formatPrice(o.total)}</span>
                <StatusBadge status={o.status} />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-600">{o.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}</p>
            <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
              <p className="font-semibold text-slate-600">{T.webhook}</p>
              {o.webhooks.length === 0 && <p className="text-slate-400">—</p>}
              <ul className="mt-1 space-y-0.5">
                {o.webhooks.map((w) => (
                  <li key={w.event_id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-mono">{w.type}</span>
                    <span className="text-slate-500">{w.summary}</span>
                    <span className="text-slate-400">{new Date(w.received_at).toLocaleTimeString(SHOP.locale)}</span>
                  </li>
                ))}
              </ul>
              {o.checkout_url && o.status === 'pending' && (
                <a href={o.checkout_url} className="mt-1 inline-block text-sky-800 underline">
                  {T.checkout} →
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
