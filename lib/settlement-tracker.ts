// In-memory micropayment accumulator
// Tracks off-chain Yellow Network payments and triggers on-chain settlement at threshold

const SETTLEMENT_THRESHOLD = 1_000_000; // 1 USDC in micro-units (6 decimals)

interface PaymentRecord {
  queryId: string;
  amount: number;
  timestamp: number;
}

let accumulatedAmount = 0;
let payments: PaymentRecord[] = [];
let lastSettlementTime: number | null = null;

export function recordPayment(queryId: string, amountMicroUsdc: number) {
  accumulatedAmount += amountMicroUsdc;
  payments.push({
    queryId,
    amount: amountMicroUsdc,
    timestamp: Date.now(),
  });
}

export function getAccumulated(): number {
  return accumulatedAmount;
}

export function getPayments(): PaymentRecord[] {
  return [...payments];
}

export function getLastSettlementTime(): number | null {
  return lastSettlementTime;
}

export function shouldSettle(): boolean {
  return accumulatedAmount >= SETTLEMENT_THRESHOLD;
}

export function getThreshold(): number {
  return SETTLEMENT_THRESHOLD;
}

/** Resets the tracker after a successful on-chain settlement. Returns the settled data. */
export function resetAfterSettlement(): {
  amount: number;
  payments: PaymentRecord[];
} {
  const settled = {
    amount: accumulatedAmount,
    payments: [...payments],
  };
  accumulatedAmount = 0;
  payments = [];
  lastSettlementTime = Date.now();
  return settled;
}
