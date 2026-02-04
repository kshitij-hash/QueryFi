export interface Pool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number | null;
  apyReward: number | null;
  stablecoin: boolean;
}

// In-memory cache
let cachedPools: Pool[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchPools(): Promise<Pool[]> {
  const now = Date.now();
  if (cachedPools.length > 0 && now - cacheTimestamp < CACHE_TTL) {
    return cachedPools;
  }

  const res = await fetch("https://yields.llama.fi/pools");
  if (!res.ok) {
    throw new Error(`DeFi Llama yields API error: ${res.status}`);
  }

  const data = await res.json();
  cachedPools = (data.data ?? []).map((p: Record<string, unknown>) => ({
    pool: p.pool as string,
    chain: p.chain as string,
    project: p.project as string,
    symbol: p.symbol as string,
    tvlUsd: p.tvlUsd as number,
    apy: p.apy as number,
    apyBase: (p.apyBase as number) ?? null,
    apyReward: (p.apyReward as number) ?? null,
    stablecoin: p.stablecoin as boolean,
  }));
  cacheTimestamp = now;

  return cachedPools;
}

export async function searchYields(options?: {
  token?: string;
  minTvl?: number;
  chain?: string;
  limit?: number;
}): Promise<Pool[]> {
  const { token, minTvl = 1_000_000, chain, limit = 10 } = options ?? {};
  const pools = await fetchPools();

  let filtered = pools.filter(
    (p) => p.tvlUsd >= minTvl && p.apy > 0 && p.apy < 1000
  );

  if (token) {
    const t = token.toUpperCase();
    filtered = filtered.filter((p) => p.symbol.toUpperCase().includes(t));
  }

  if (chain) {
    const c = chain.toLowerCase();
    filtered = filtered.filter((p) => p.chain.toLowerCase() === c);
  }

  filtered.sort((a, b) => b.apy - a.apy);

  return filtered.slice(0, limit);
}
