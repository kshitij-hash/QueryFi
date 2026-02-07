// Micropayment accumulator with file-based persistence
// Tracks off-chain Yellow Network payments and triggers on-chain settlement at threshold
// State survives server restarts via a JSON file in the project root

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const SETTLEMENT_THRESHOLD = 1_000_000; // 1 USDC in micro-units (6 decimals)

const STATE_FILE = join(process.cwd(), ".settlement-state.json");

interface PaymentRecord {
  queryId: string;
  amount: number;
  timestamp: number;
}

export interface SettlementRecord {
  transactionId: string | null;
  arcTransactionHash: string | null;
  amount: number;
  queryIds: string[];
  timestamp: number;
  chains: string[];
}

interface PersistedState {
  accumulatedAmount: number;
  payments: PaymentRecord[];
  lastSettlementTime: number | null;
  settlementHistory: SettlementRecord[];
}

function loadState(): PersistedState {
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as PersistedState;
    // Ensure settlementHistory exists (backwards compat with old state files)
    if (!parsed.settlementHistory) parsed.settlementHistory = [];
    return parsed;
  } catch {
    return { accumulatedAmount: 0, payments: [], lastSettlementTime: null, settlementHistory: [] };
  }
}

function saveState(state: PersistedState): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[SettlementTracker] Failed to persist state:", err);
  }
}

export function recordPayment(queryId: string, amountMicroUsdc: number) {
  const state = loadState();
  state.accumulatedAmount += amountMicroUsdc;
  state.payments.push({
    queryId,
    amount: amountMicroUsdc,
    timestamp: Date.now(),
  });
  saveState(state);
}

export function getAccumulated(): number {
  return loadState().accumulatedAmount;
}

export function getPayments(): PaymentRecord[] {
  return [...loadState().payments];
}

export function getLastSettlementTime(): number | null {
  return loadState().lastSettlementTime;
}

export function shouldSettle(): boolean {
  return loadState().accumulatedAmount >= SETTLEMENT_THRESHOLD;
}

export function getThreshold(): number {
  return SETTLEMENT_THRESHOLD;
}

/** Resets the tracker after a successful on-chain settlement. Returns the settled data. */
export function resetAfterSettlement(): {
  amount: number;
  payments: PaymentRecord[];
} {
  const state = loadState();
  const settled = {
    amount: state.accumulatedAmount,
    payments: [...state.payments],
  };
  state.accumulatedAmount = 0;
  state.payments = [];
  state.lastSettlementTime = Date.now();
  saveState(state);
  return settled;
}

/** Add a completed settlement to the persisted history */
export function addSettlementToHistory(record: SettlementRecord): void {
  const state = loadState();
  state.settlementHistory.push(record);
  saveState(state);
}

/** Get persisted settlement history */
export function getSettlementHistory(): SettlementRecord[] {
  return [...loadState().settlementHistory];
}
