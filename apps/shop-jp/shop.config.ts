/**
 * ショップ設定（フロントと Pages Functions で共有）。
 * shop-global はこのファイルだけ差し替えれば英語 / USD 版になる。
 */
export const SHOP = {
  id: 'shop-jp',
  name: 'サクラ雑貨店',
  tagline: '日本の暮らしの道具を、ていねいに。',
  locale: 'ja-JP',
  currency: 'JPY' as const,
  /** 通貨の小数桁（表示・最小単位変換） */
  decimals: 0,
  webhookPath: '/api/webhook',
  texts: {
    demo: 'これはデモECです。payCcount（デモ）で支払います。実際の資金は移動しません。',
    products: '商品',
    cart: 'カート',
    empty: 'カートは空です',
    add: 'カートに入れる',
    remove: '削除',
    total: '合計',
    checkout: 'payCcountで支払う',
    checkoutHint: 'payCcount のウォレット残高（JPY / ポイント / 外貨 / BTC / ETH）で支払えます。加盟店には JPY で精算されます。',
    orders: '注文一覧',
    order: '注文',
    status: '状態',
    webhook: 'Webhook 受信',
    thanksTitle: 'ご注文ありがとうございます',
    thanksWaiting: '支払いの確認（Webhook）を待っています…',
    thanksPaid: '支払いを確認しました（payment.succeeded を受信）',
    backToShop: 'ショップに戻る',
    viewOrders: '注文一覧を見る',
    statusLabels: { pending: '支払い待ち', paid: '支払済', refunded: '返金済', partially_refunded: '一部返金', expired: '期限切れ', canceled: 'キャンセル' } as Record<string, string>,
    setupTitle: '加盟店の設定が必要です',
    setupBody: 'PAYCCOUNT_SECRET_KEY が設定されていません。README の手順で APIキーと Webhook シークレットを .dev.vars に設定してください。',
    qty: '数量',
  },
  products: [
    { id: 'p-tenugui', name: '手ぬぐい（藍染）', price: '1200', emoji: '🧣', description: '奈良の職人が染めた綿 100% の手ぬぐい。' },
    { id: 'p-yunomi', name: '湯のみ（美濃焼）', price: '2480', emoji: '🍵', description: '手になじむ厚みの湯のみ。食洗機対応。' },
    { id: 'p-incense', name: 'お香セット（白檀）', price: '1800', emoji: '🕯️', description: '京都の老舗の白檀のお香 30 本入り。' },
    { id: 'p-furoshiki', name: '風呂敷（大判）', price: '3300', emoji: '🎁', description: '90cm 角の大判風呂敷。贈り物の包みに。' },
    { id: 'p-chopsticks', name: '若狭塗の箸（2 膳）', price: '5980', emoji: '🥢', description: '夫婦箸。桐箱入り。' },
  ],
} as const;

export type Product = (typeof SHOP.products)[number];

export function findProduct(id: string): Product | undefined {
  return SHOP.products.find((p) => p.id === id);
}

/** 最小単位 → 表示（例: 1200 → ¥1,200 / 4999 → $49.99） */
export function formatPrice(minor: string | number): string {
  const n = typeof minor === 'string' ? Number(minor) : minor;
  const value = n / 10 ** SHOP.decimals;
  return new Intl.NumberFormat(SHOP.locale, { style: 'currency', currency: SHOP.currency, minimumFractionDigits: SHOP.decimals }).format(value);
}
