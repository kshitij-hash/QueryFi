// Bridge: triggers on-chain depositMicropayment via Circle agent wallet
// Connects off-chain Yellow Network micropayments to the MicropaymentSettlementHook contract
// Multi-chain: settles on Base Sepolia (primary) and Arc testnet (when configured)

import { executeContractCall } from "@/lib/circle-wallet";
import {
  getAccumulated,
  getPayments,
  shouldSettle,
  resetAfterSettlement,
} from "@/lib/settlement-tracker";
import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

// Base Sepolia settlement config
const SETTLEMENT_HOOK_ADDRESS =
  process.env.SETTLEMENT_HOOK_ADDRESS ??
  "0xe0d92A5e1D733517aa8b4b5Cf4A874722b30C040";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Arc testnet settlement config (multi-chain treasury support)
const ARC_HOOK_ADDRESS = process.env.ARC_SETTLEMENT_HOOK_ADDRESS as
  | Hex
  | undefined;

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

interface SettlementResult {
  transactionId: string | null;
  arcTransactionHash: string | null;
  amount: number;
  queryIds: string[];
  timestamp: number;
  chains: string[];
}

// Keep recent settlement history in memory
const settlementHistory: SettlementResult[] = [];

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
 * via a direct viem wallet client. Returns the tx hash or null if Arc is not configured.
 */
async function settleOnArc(
  amount: number,
  queryIdBytes32: Hex
): Promise<string | null> {
  if (!ARC_HOOK_ADDRESS) return null;

  const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    console.warn(
      "[Settlement] Arc settlement skipped: PRIVATE_KEY not configured"
    );
    return null;
  }

  try {
    const account = privateKeyToAccount(privateKey);
    const client = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http("https://rpc.testnet.arc.network"),
    });

    const hash = await client.writeContract({
      address: ARC_HOOK_ADDRESS,
      abi: parseAbi([
        "function depositMicropayment(uint256 amount, bytes32 queryId)",
      ]),
      functionName: "depositMicropayment",
      args: [BigInt(amount), queryIdBytes32],
    });

    console.log(`[Settlement] Arc testnet deposit tx: ${hash}`);
    return hash;
  } catch (error) {
    console.error(
      "[Settlement] Arc settlement failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

/**
 * Triggers on-chain settlement by calling depositMicropayment() on the hook contract
 * via the Circle agent wallet (Base Sepolia) and optionally on Arc testnet.
 * Multi-chain: settles on all configured chains for treasury redundancy.
 * Retries up to 3 times with exponential backoff.
 */
export async function triggerOnChainSettlement(): Promise<SettlementResult> {
  if (settlementInProgress) {
    throw new Error("Settlement already in progress");
  }

  const accumulated = getAccumulated();
  if (accumulated === 0) {
    throw new Error("No accumulated payments to settle");
  }

  settlementInProgress = true;

  try {
    const payments = getPayments();

    // Use the most recent queryId padded to bytes32
    const latestQueryId =
      payments[payments.length - 1]?.queryId ?? "settlement";
    const queryIdBytes32 = stringToBytes32(latestQueryId);

    // Settle on Base Sepolia via Circle wallet
    const result = await withRetry(
      () =>
        executeContractCall(
          SETTLEMENT_HOOK_ADDRESS,
          "depositMicropayment(uint256,bytes32)",
          [accumulated.toString(), queryIdBytes32]
        ),
      "depositMicropayment"
    );

    // Settle on Arc testnet in parallel (best-effort, non-blocking)
    const arcTxHash = await settleOnArc(
      accumulated,
      queryIdBytes32 as Hex
    );

    // Reset tracker after successful Base Sepolia submission
    const settled = resetAfterSettlement();

    const chains = ["base-sepolia"];
    if (arcTxHash) chains.push("arc-testnet");

    const settlementResult: SettlementResult = {
      transactionId: result.transactionId,
      arcTransactionHash: arcTxHash,
      amount: settled.amount,
      queryIds: settled.payments.map((p) => p.queryId),
      timestamp: Date.now(),
      chains,
    };

    settlementHistory.push(settlementResult);

    console.log(
      `[Settlement] On-chain deposit: ${settled.amount} micro-USDC, chains: ${chains.join(", ")}, base tx: ${result.transactionId}${arcTxHash ? `, arc tx: ${arcTxHash}` : ""}`
    );

    return settlementResult;
  } finally {
    settlementInProgress = false;
  }
}

/**
 * Approve the settlement hook contract to spend USDC on behalf of the Circle agent wallet.
 * This is a one-time setup call. Retries on failure.
 */
export async function approveHookForUsdc(): Promise<{
  transactionId: string | null;
}> {
  const maxUint256 =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";

  const result = await withRetry(
    () =>
      executeContractCall(USDC_ADDRESS, "approve(address,uint256)", [
        SETTLEMENT_HOOK_ADDRESS,
        maxUint256,
      ]),
    "USDC approval"
  );

  console.log(
    `[Settlement] USDC approval for hook: tx ${result.transactionId}`
  );

  return { transactionId: result.transactionId };
}

/**
 * Check if auto-settlement should trigger, and do so if threshold is met.
 * Safe to call after every payment — only settles when threshold is reached.
 * Prevents concurrent settlement attempts.
 */
export async function checkAndAutoSettle(): Promise<SettlementResult | null> {
  if (!shouldSettle()) return null;
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
