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
import { createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, arcTestnet } from "viem/chains";

// Base Sepolia settlement config
const SETTLEMENT_HOOK_ADDRESS = (process.env.SETTLEMENT_HOOK_ADDRESS ??
  "0x0cD33a7a876AF045e49a80f07C8c8eaF7A1bc040") as Hex;

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
 * Get a viem wallet client for Base Sepolia using the agent private key.
 */
function getBaseSepoliaClient() {
  const privateKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    throw new Error("AGENT_PRIVATE_KEY not configured");
  }

  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });
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

  const privateKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) {
    console.warn(
      "[Settlement] Arc settlement skipped: AGENT_PRIVATE_KEY not configured"
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
 * Triggers on-chain settlement by calling recordSettlement() on the hook contract
 * via direct viem wallet client (Base Sepolia) and optionally on Arc testnet.
 * recordSettlement() creates an on-chain audit trail AND transfers USDC from hook reserve.
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

    // Record settlement on Base Sepolia via direct viem call.
    // recordSettlement() creates an on-chain audit trail (event + counters)
    // AND transfers USDC from the hook's pre-funded reserve to the agent wallet.
    const txHash = await withRetry(
      async () => {
        const client = getBaseSepoliaClient();
        return client.writeContract({
          address: SETTLEMENT_HOOK_ADDRESS,
          abi: parseAbi([
            "function recordSettlement(uint256 amount, bytes32 queryId)",
          ]),
          functionName: "recordSettlement",
          args: [BigInt(accumulated), queryIdBytes32 as Hex],
        });
      },
      "recordSettlement"
    );

    console.log(`[Settlement] Base Sepolia tx: ${txHash}`);

    // Record on Arc testnet (best-effort, non-blocking)
    const arcTxHash = await settleOnArc(
      accumulated,
      queryIdBytes32 as Hex
    );

    // Reset tracker after successful Base Sepolia submission
    const settled = resetAfterSettlement();

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

    addSettlementToHistory(settlementResult);

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
  const txHash = await withRetry(
    async () => {
      const client = getBaseSepoliaClient();
      return client.writeContract({
        address: SETTLEMENT_HOOK_ADDRESS,
        abi: parseAbi(["function settleNow()"]),
        functionName: "settleNow",
        args: [],
      });
    },
    "settleNow"
  );

  console.log(`[Settlement] settleNow called on hook: tx ${txHash}`);

  return { transactionId: txHash };
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
  return getPersistedHistory();
}

/** Converts a string to a 0x-prefixed bytes32 hex string */
function stringToBytes32(str: string): string {
  const hex = Buffer.from(str.slice(0, 31))
    .toString("hex")
    .padEnd(64, "0");
  return "0x" + hex;
}
