/**
 * Shop configuration (shared by the frontend and Pages Functions).
 * shop-global: English UI, USD prices, merchant settles in USD.
 */
export const SHOP = {
  id: 'shop-global',
  name: 'Globe Goods',
  tagline: 'Everyday essentials, shipped worldwide.',
  locale: 'en-US',
  currency: 'USD' as const,
  /** decimals of the currency (cents) */
  decimals: 2,
  webhookPath: '/api/webhook',
  texts: {
    demo: 'This is a demo store. Payments run on payCcount (demo) — no real money moves.',
    products: 'Products',
    cart: 'Cart',
    empty: 'Your cart is empty',
    add: 'Add to cart',
    remove: 'Remove',
    total: 'Total',
    checkout: 'Pay with payCcount',
    checkoutHint: 'Japanese customers can pay from their payCcount balance in JPY, points, USD, BTC or ETH. You are settled in USD.',
    orders: 'Orders',
    order: 'Order',
    status: 'Status',
    webhook: 'Webhooks received',
    thanksTitle: 'Thank you for your order',
    thanksWaiting: 'Waiting for payment confirmation (webhook)…',
    thanksPaid: 'Payment confirmed (payment.succeeded received)',
    backToShop: 'Back to shop',
    viewOrders: 'View orders',
    statusLabels: { pending: 'Pending', paid: 'Paid', refunded: 'Refunded', partially_refunded: 'Partially refunded', expired: 'Expired', canceled: 'Canceled' } as Record<string, string>,
    setupTitle: 'Merchant setup required',
    setupBody: 'PAYCCOUNT_SECRET_KEY is not set. Follow the README to put your API key and webhook secret into .dev.vars.',
    qty: 'Qty',
  },
  products: [
    { id: 'g-bottle', name: 'Insulated Bottle 500ml', price: '2999', emoji: '🧴', description: 'Keeps drinks cold for 24h, hot for 12h.' },
    { id: 'g-backpack', name: 'Commuter Backpack', price: '8900', emoji: '🎒', description: '20L, water-resistant, laptop sleeve.' },
    { id: 'g-earbuds', name: 'Wireless Earbuds', price: '4999', emoji: '🎧', description: 'ANC, 30h battery with case.' },
    { id: 'g-notebook', name: 'Dotted Notebook (A5)', price: '1450', emoji: '📓', description: '192 pages, 100gsm paper.' },
    { id: 'g-lamp', name: 'Desk Lamp', price: '3600', emoji: '💡', description: 'Dimmable LED with USB-C charging port.' },
  ],
} as const;

export type Product = (typeof SHOP.products)[number];

export function findProduct(id: string): Product | undefined {
  return SHOP.products.find((p) => p.id === id);
}

/** minor units → display (e.g. 4999 → $49.99) */
export function formatPrice(minor: string | number): string {
  const n = typeof minor === 'string' ? Number(minor) : minor;
  const value = n / 10 ** SHOP.decimals;
  return new Intl.NumberFormat(SHOP.locale, { style: 'currency', currency: SHOP.currency, minimumFractionDigits: SHOP.decimals }).format(value);
}
