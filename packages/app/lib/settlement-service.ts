// Bridge: records off-chain Yellow Network micropayments on-chain via the MicropaymentSettlementHook
// Uses recordSettlement() which creates an on-chain audit trail AND transfers USDC from hook reserve
// Multi-chain: records on Base Sepolia (primary) and Arc testnet (when configured)

import {
  getAccumulated,
  getPayments,
  shouldSettle,
  resetAfterSettlement,
  addSettlementToHistory,
  getSettlementHistory as getPersistedHistory,
} from "@/lib/settlement-tracker";
import { executeContractCall } from "@/lib/circle-wallet";

// Base Sepolia settlement config
const SETTLEMENT_HOOK_ADDRESS =
  process.env.SETTLEMENT_HOOK_ADDRESS ?? "0x974E39C679dd172eC68568cBa6f62CdF4BFeC040";

// Arc testnet settlement config (multi-chain treasury support)
const ARC_HOOK_ADDRESS = process.env.ARC_SETTLEMENT_HOOK_ADDRESS as
  | string
  | undefined;

// Circle wallet ID for Arc testnet (separate SCA wallet on Arc chain)
const ARC_CIRCLE_WALLET_ID = process.env.ARC_CIRCLE_WALLET_ID as
  | string
  | undefined;

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

interface SettlementResult {
  /** Circle transaction UUID (Base Sepolia) or null */
  transactionId: string | null;
  arcTransactionHash: string | null;
  amount: number;
  queryIds: string[];
  timestamp: number;
  chains: string[];
}

// Track in-flight settlement to prevent concurrent attempts
let settlementInProgress = false;

/**
 * Retries an async function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = MAX_RETRIES
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[Settlement] ${label} attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms:`,
          error instanceof Error ? error.message : error
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Settle on Arc testnet by calling depositMicropayment() on the ArcSettlementHook
 * via Circle Wallets (executeContractCall with Arc wallet ID).
 * Returns the Circle transaction ID or null if Arc is not configured.
 */
async function settleOnArc(
  amount: number,
  queryIdBytes32: string
): Promise<string | null> {
  if (!ARC_HOOK_ADDRESS || !ARC_CIRCLE_WALLET_ID) {
    if (ARC_HOOK_ADDRESS && !ARC_CIRCLE_WALLET_ID) {
      console.warn(
        "[Settlement] Arc settlement skipped: ARC_CIRCLE_WALLET_ID not configured"
      );
    }
    return null;
  }

  try {
    const result = await executeContractCall(
      ARC_HOOK_ADDRESS,
      "depositMicropayment(uint256,bytes32)",
      [amount.toString(), queryIdBytes32],
      ARC_CIRCLE_WALLET_ID
    );

    console.log(`[Settlement] Arc testnet Circle tx: ${result.transactionId}`);
    return result.transactionId;
  } catch (error) {
    console.error(
      "[Settlement] Arc settlement failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Triggers on-chain settlement by calling recordSettlement() on the hook contract
 * via Circle Wallets on Base Sepolia and optionally on Arc testnet.
 * recordSettlement() creates an on-chain audit trail AND transfers USDC from hook reserve.
 * Retries up to 3 times with exponential backoff.
 */
export async function triggerOnChainSettlement(): Promise<SettlementResult> {
  if (settlementInProgress) {
    throw new Error("Settlement already in progress");
  }

  const accumulated = await getAccumulated();
  if (accumulated === 0) {
    throw new Error("No accumulated payments to settle");
  }

  settlementInProgress = true;

  try {
    const payments = await getPayments();

    // Use the most recent queryId padded to bytes32
    const latestQueryId =
      payments[payments.length - 1]?.queryId ?? "settlement";
    const queryIdBytes32 = stringToBytes32(latestQueryId);

    // Record settlement on Base Sepolia via Circle Wallet SDK.
    // recordSettlement() creates an on-chain audit trail (event + counters)
    // AND transfers USDC from the hook's pre-funded reserve to the agent wallet.
    const circleResult = await withRetry(
      () =>
        executeContractCall(
          SETTLEMENT_HOOK_ADDRESS,
          "recordSettlement(uint256,bytes32)",
          [accumulated.toString(), queryIdBytes32]
        ),
      "recordSettlement"
    );
    const txHash = circleResult.transactionId;

    console.log(`[Settlement] Base Sepolia Circle tx: ${txHash}`);

    // Record on Arc testnet (best-effort, non-blocking)
    const arcTxHash = await settleOnArc(
      accumulated,
      queryIdBytes32
    );

    // Reset tracker after successful Base Sepolia submission
    const settled = await resetAfterSettlement();

    const chains = ["base-sepolia"];
    if (arcTxHash) chains.push("arc-testnet");

    const settlementResult: SettlementResult = {
      transactionId: txHash,
      arcTransactionHash: arcTxHash,
      amount: settled.amount,
      queryIds: settled.payments.map((p) => p.queryId),
      timestamp: Date.now(),
      chains,
    };

    await addSettlementToHistory(settlementResult);

    console.log(
      `[Settlement] Recorded: ${settled.amount} micro-USDC, chains: ${chains.join(", ")}, base tx: ${txHash}${arcTxHash ? `, arc tx: ${arcTxHash}` : ""}`
    );

    return settlementResult;
  } finally {
    settlementInProgress = false;
  }
}

/**
 * Call settleNow() on the hook to flush any accumulated balance back to the agent wallet.
 */
export async function flushHookBalance(): Promise<{
  transactionId: string | null;
}> {
  const circleResult = await withRetry(
    () =>
      executeContractCall(
        SETTLEMENT_HOOK_ADDRESS,
        "settleNow()",
        []
      ),
    "settleNow"
  );
  const txHash = circleResult.transactionId;

  console.log(`[Settlement] settleNow called via Circle SDK: tx ${txHash}`);

  return { transactionId: txHash };
}

/**
 * Check if auto-settlement should trigger, and do so if threshold is met.
 * Safe to call after every payment — only settles when threshold is reached.
 * Prevents concurrent settlement attempts.
 */
export async function checkAndAutoSettle(): Promise<SettlementResult | null> {
  if (!(await shouldSettle())) return null;
  if (settlementInProgress) return null;

  try {
    return await triggerOnChainSettlement();
  } catch (error) {
    console.error(
      "[Settlement] Auto-settle failed after retries:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export async function getSettlementHistory(): Promise<SettlementResult[]> {
  return getPersistedHistory();
}

/** Converts a string to a 0x-prefixed bytes32 hex string */
function stringToBytes32(str: string): string {
  const hex = Buffer.from(str.slice(0, 31))
    .toString("hex")
    .padEnd(64, "0");
  return "0x" + hex;
}
