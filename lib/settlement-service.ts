// Bridge: triggers on-chain depositMicropayment via Circle agent wallet
// Connects off-chain Yellow Network micropayments to the MicropaymentSettlementHook contract

import { executeContractCall } from "@/lib/circle-wallet";
import {
  getAccumulated,
  getPayments,
  shouldSettle,
  resetAfterSettlement,
} from "@/lib/settlement-tracker";

const SETTLEMENT_HOOK_ADDRESS =
  process.env.SETTLEMENT_HOOK_ADDRESS ??
  "0xE8FE7028671C26f9A0843d5c24B0019bfa8d5A00";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

interface SettlementResult {
  transactionId: string | null;
  amount: number;
  queryIds: string[];
  timestamp: number;
}

// Keep recent settlement history in memory
const settlementHistory: SettlementResult[] = [];

/**
 * Triggers on-chain settlement by calling depositMicropayment() on the hook contract
 * via the Circle agent wallet.
 */
export async function triggerOnChainSettlement(): Promise<SettlementResult> {
  const accumulated = getAccumulated();
  if (accumulated === 0) {
    throw new Error("No accumulated payments to settle");
  }

  const payments = getPayments();

  // Use the first queryId as the on-chain identifier, or a combined hash
  // For simplicity, use the most recent queryId padded to bytes32
  const latestQueryId = payments[payments.length - 1]?.queryId ?? "settlement";
  const queryIdBytes32 = stringToBytes32(latestQueryId);

  // Call depositMicropayment(uint256 amount, bytes32 queryId) on the settlement hook
  const result = await executeContractCall(
    SETTLEMENT_HOOK_ADDRESS,
    "depositMicropayment(uint256,bytes32)",
    [accumulated.toString(), queryIdBytes32]
  );

  // Reset tracker after successful submission
  const settled = resetAfterSettlement();

  const settlementResult: SettlementResult = {
    transactionId: result.transactionId,
    amount: settled.amount,
    queryIds: settled.payments.map((p) => p.queryId),
    timestamp: Date.now(),
  };

  settlementHistory.push(settlementResult);

  console.log(
    `[Settlement] On-chain deposit: ${settled.amount} micro-USDC, tx: ${result.transactionId}`
  );

  return settlementResult;
}

/**
 * Approve the settlement hook contract to spend USDC on behalf of the Circle agent wallet.
 * This is a one-time setup call.
 */
export async function approveHookForUsdc(): Promise<{
  transactionId: string | null;
}> {
  const maxUint256 =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";

  const result = await executeContractCall(
    USDC_ADDRESS,
    "approve(address,uint256)",
    [SETTLEMENT_HOOK_ADDRESS, maxUint256]
  );

  console.log(
    `[Settlement] USDC approval for hook: tx ${result.transactionId}`
  );

  return { transactionId: result.transactionId };
}

/**
 * Check if auto-settlement should trigger, and do so if threshold is met.
 * Safe to call after every payment — only settles when threshold is reached.
 */
export async function checkAndAutoSettle(): Promise<SettlementResult | null> {
  if (!shouldSettle()) return null;

  try {
    return await triggerOnChainSettlement();
  } catch (error) {
    console.error("[Settlement] Auto-settle failed:", error);
    return null;
  }
}

export function getSettlementHistory(): SettlementResult[] {
  return [...settlementHistory];
}

/** Converts a string to a 0x-prefixed bytes32 hex string */
function stringToBytes32(str: string): string {
  const hex = Buffer.from(str.slice(0, 31))
    .toString("hex")
    .padEnd(64, "0");
  return "0x" + hex;
}
