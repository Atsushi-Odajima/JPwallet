/** Cloudflare Workers のバインディング（環境変数） */
export interface Bindings {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DATABASE_URL?: string;
  AUTH_MODE?: 'supabase' | 'demo' | string;
  JWT_SECRET?: string;
  APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  DEMO_MOCK_ENDPOINTS?: string;
  RATES_PROVIDER?: 'mock' | 'live' | string;
}

export interface AppConfig {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  databaseUrl?: string;
  authMode: 'supabase' | 'demo';
  jwtSecret?: string;
  appUrl: string;
  allowedOrigins: string[];
  mockEndpoints: boolean;
  ratesProvider: 'mock' | 'live';
}

export function configFromEnv(env: Bindings): AppConfig {
  const authMode = env.AUTH_MODE === 'demo' ? 'demo' : 'supabase';
  if (authMode === 'demo' && !env.JWT_SECRET) {
    throw new Error('AUTH_MODE=demo には JWT_SECRET が必要です');
  }
  return {
    supabaseUrl: env.SUPABASE_URL || undefined,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    databaseUrl: env.DATABASE_URL || undefined,
    authMode,
    jwtSecret: env.JWT_SECRET || undefined,
    appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
    allowedOrigins: (env.ALLOWED_ORIGINS || '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    mockEndpoints: env.DEMO_MOCK_ENDPOINTS === 'true' || env.DEMO_MOCK_ENDPOINTS === '1',
    ratesProvider: env.RATES_PROVIDER === 'live' ? 'live' : 'mock',
  };
}
