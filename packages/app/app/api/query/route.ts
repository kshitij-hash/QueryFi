import { NextRequest, NextResponse } from "next/server";
import { runDefiAgent } from "@/lib/defi-agent";
import { recordPayment } from "@/lib/settlement-tracker";
import { checkAndAutoSettle } from "@/lib/settlement-service";

// Default per-query cost in micro-USDC (0.01 USDC = 10,000 micro-USDC)
const DEFAULT_QUERY_COST_MICRO_USDC = 10_000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, queryId, price } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    if (!queryId || typeof queryId !== "string") {
      return NextResponse.json({ error: "Missing queryId" }, { status: 400 });
    }

    const response = await runDefiAgent(query);

    // Use the price from the frontend (USDC), convert to micro-USDC, or fall back to default
    const amountMicroUsdc =
      typeof price === "number" && price > 0
        ? Math.floor(price * 1_000_000)
        : DEFAULT_QUERY_COST_MICRO_USDC;

    // Record the micropayment for this query
    await recordPayment(queryId, amountMicroUsdc);

    // Auto-settle in background if threshold is reached (fire-and-forget)
    checkAndAutoSettle().catch((err) =>
      console.error("[Query] Background auto-settle error:", err)
    );

    return NextResponse.json({ response });
  } catch (error) {
    console.error("Query API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
