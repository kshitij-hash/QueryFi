// Micropayment accumulator with Neon Postgres persistence via Drizzle
// Tracks off-chain Yellow Network payments and triggers on-chain settlement at threshold
// State persists across serverless cold starts via Neon database

import { db } from "@/lib/db";
import { payments, settlements } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { asc } from "drizzle-orm";

const SETTLEMENT_THRESHOLD = 1_000_000; // 1 USDC in micro-units (6 decimals)

export interface SettlementRecord {
  transactionId: string | null;
  arcTransactionHash: string | null;
  amount: number;
  queryIds: string[];
  timestamp: number;
  chains: string[];
}

export async function recordPayment(queryId: string, amountMicroUsdc: number) {
  await db.insert(payments).values({
    queryId,
    amount: amountMicroUsdc,
    timestamp: Date.now(),
  });
}

export async function getAccumulated(): Promise<number> {
  const [paymentSum] = await db
    .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments);

  return Number(paymentSum.total);
}

export async function getPayments() {
  return db.select().from(payments).orderBy(asc(payments.timestamp));
}

export async function getLastSettlementTime(): Promise<number | null> {
  const [latest] = await db
    .select({ timestamp: settlements.timestamp })
    .from(settlements)
    .orderBy(sql`${settlements.timestamp} desc`)
    .limit(1);

  return latest?.timestamp ?? null;
}

export async function shouldSettle(): Promise<boolean> {
  const accumulated = await getAccumulated();
  return accumulated >= SETTLEMENT_THRESHOLD;
}

export function getThreshold(): number {
  return SETTLEMENT_THRESHOLD;
}

/** Resets the tracker after a successful on-chain settlement. Returns the settled data. */
export async function resetAfterSettlement(): Promise<{
  amount: number;
  payments: { queryId: string; amount: number; timestamp: number }[];
}> {
  const rows = await db.select().from(payments).orderBy(asc(payments.timestamp));
  const amount = rows.reduce((sum, r) => sum + r.amount, 0);

  await db.delete(payments);

  return {
    amount,
    payments: rows.map((r) => ({
      queryId: r.queryId,
      amount: r.amount,
      timestamp: r.timestamp,
    })),
  };
}

/** Add a completed settlement to the persisted history */
export async function addSettlementToHistory(record: SettlementRecord): Promise<void> {
  await db.insert(settlements).values({
    transactionId: record.transactionId,
    arcTransactionHash: record.arcTransactionHash,
    amount: record.amount,
    queryIds: record.queryIds,
    timestamp: record.timestamp,
    chains: record.chains,
  });
}

/** Get persisted settlement history */
export async function getSettlementHistory(): Promise<SettlementRecord[]> {
  const rows = await db
    .select()
    .from(settlements)
    .orderBy(asc(settlements.timestamp));

  return rows.map((r) => ({
    transactionId: r.transactionId,
    arcTransactionHash: r.arcTransactionHash,
    amount: r.amount,
    queryIds: r.queryIds,
    timestamp: r.timestamp,
    chains: r.chains,
  }));
}
