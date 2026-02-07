export interface ILResult {
  ilPercent: number;
  holdValue: number;
  lpValue: number;
}

/**
 * Calculate impermanent loss for a standard 50/50 LP position.
 * Standard formula: IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
 * Result is negative (e.g. -2.02% for a 1.5x price change).
 */
export function calculateIL(priceRatioChange: number): ILResult {
  const ratio = priceRatioChange;
  const sqrtRatio = Math.sqrt(ratio);
  const lpValue = (2 * sqrtRatio) / (1 + ratio);
  const holdValue = (1 + ratio) / 2;
  // Standard IL: compare LP value to initial value (1.0), not to hold value
  const ilPercent = (lpValue - 1) * 100;

  return {
    ilPercent: Math.round(ilPercent * 10000) / 10000,
    holdValue: Math.round(holdValue * 10000) / 10000,
    lpValue: Math.round(lpValue * 10000) / 10000,
  };
}

/**
 * Convenience wrapper: calculate IL from entry and current price.
 */
export function calculateILFromPrices(
  entryPrice: number,
  currentPrice: number
): ILResult {
  const priceRatio = currentPrice / entryPrice;
  return calculateIL(priceRatio);
}
