import { NextRequest, NextResponse } from "next/server";
import {
  triggerOnChainSettlement,
  flushHookBalance,
  getSettlementHistory,
} from "@/lib/settlement-service";
import {
  getAccumulated,
  getPayments,
  getThreshold,
  getLastSettlementTime,
} from "@/lib/settlement-tracker";

/** GET — Return current settlement status (pending payments, history) */
export async function GET() {
  try {
    const [accumulated, payments, history, lastSettlement] = await Promise.all([
      getAccumulated(),
      getPayments(),
      getSettlementHistory(),
      getLastSettlementTime(),
    ]);
    const threshold = getThreshold();

    return NextResponse.json({
      accumulated,
      accumulatedUsdc: (accumulated / 1_000_000).toFixed(6),
      threshold,
      thresholdUsdc: (threshold / 1_000_000).toFixed(6),
      pendingPayments: payments.length,
      payments: payments.slice(-20), // last 20
      readyToSettle: accumulated >= threshold,
      lastSettlementTime: lastSettlement,
      history: history.slice(-10), // last 10 settlements
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST — Trigger on-chain settlement (manual or threshold-based) */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body as { action?: string };

    // Special action: flush hook balance back to agent wallet
    if (action === "flush") {
      const result = await flushHookBalance();
      return NextResponse.json({ success: true, ...result });
    }

    // Default action: trigger settlement
    const accumulated = await getAccumulated();
    if (accumulated === 0) {
      return NextResponse.json(
        { error: "No accumulated payments to settle" },
        { status: 400 }
      );
    }

    const result = await triggerOnChainSettlement();

    return NextResponse.json({
      success: true,
      settlement: {
        transactionId: result.transactionId,
        arcTransactionHash: result.arcTransactionHash,
        chains: result.chains,
        amount: result.amount,
        amountUsdc: (result.amount / 1_000_000).toFixed(6),
        queryIds: result.queryIds,
        timestamp: result.timestamp,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
