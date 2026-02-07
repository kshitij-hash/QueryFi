const SYMBOL_TO_COINGECKO: Record<string, string> = {
  eth: "ethereum",
  btc: "bitcoin",
  usdc: "usd-coin",
  usdt: "tether",
  dai: "dai",
  weth: "weth",
  wbtc: "wrapped-bitcoin",
  steth: "staked-ether",
  reth: "rocket-pool-eth",
  cbeth: "coinbase-wrapped-staked-eth",
  sol: "solana",
  matic: "matic-network",
  avax: "avalanche-2",
  bnb: "binancecoin",
  arb: "arbitrum",
  op: "optimism",
  link: "chainlink",
  uni: "uniswap",
  aave: "aave",
  mkr: "maker",
  crv: "curve-dao-token",
  ldo: "lido-dao",
};

export interface TokenPrice {
  price: number;
  symbol: string;
  timestamp: number;
}

export async function getTokenPrice(symbol: string): Promise<TokenPrice> {
  const normalized = symbol.toLowerCase().replace(/^\$/, "");
  const coingeckoId = SYMBOL_TO_COINGECKO[normalized];

  if (!coingeckoId) {
    throw new Error(
      `Unknown token symbol: ${symbol}. Supported: ${Object.keys(SYMBOL_TO_COINGECKO).join(", ")}`
    );
  }

  const url = `https://coins.llama.fi/prices/current/coingecko:${coingeckoId}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`DeFi Llama price API error: ${res.status}`);
  }

  const data = await res.json();
  const key = `coingecko:${coingeckoId}`;
  const coin = data.coins?.[key];

  if (!coin) {
    throw new Error(`No price data found for ${symbol}`);
  }

  return {
    price: coin.price,
    symbol: coin.symbol ?? symbol.toUpperCase(),
    timestamp: coin.timestamp,
  };
}
