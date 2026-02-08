import { NextRequest, NextResponse } from "next/server";
import { runDefiAgent, type ConversationMessage } from "@/lib/defi-agent";
import { recordPayment } from "@/lib/settlement-tracker";
import { checkAndAutoSettle } from "@/lib/settlement-service";

// Default per-query cost in micro-USDC (0.01 USDC = 10,000 micro-USDC)
const DEFAULT_QUERY_COST_MICRO_USDC = 10_000;

// Track last-seen version per session to prevent replay attacks
const sessionVersions = new Map<string, number>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, queryId, price, history, payment } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    if (!queryId || typeof queryId !== "string") {
      return NextResponse.json({ error: "Missing queryId" }, { status: 400 });
    }

    // Validate payment proof
    if (
      !payment ||
      typeof payment.appSessionId !== "string" ||
      !payment.appSessionId ||
      typeof payment.version !== "number" ||
      payment.version <= 0
    ) {
      return NextResponse.json(
        { error: "Payment required: missing or invalid payment proof" },
        { status: 402 }
      );
    }

    const lastVersion = sessionVersions.get(payment.appSessionId) ?? 0;
    if (payment.version <= lastVersion) {
      return NextResponse.json(
        { error: "Payment required: stale payment version (possible replay)" },
        { status: 402 }
      );
    }

    // Payment verified — update last-seen version
    sessionVersions.set(payment.appSessionId, payment.version);

    // Validate and sanitize conversation history
    const conversationHistory: ConversationMessage[] = Array.isArray(history)
      ? history
          .filter(
            (m: unknown): m is ConversationMessage =>
              typeof m === "object" &&
              m !== null &&
              ("role" in m) &&
              (m as Record<string, unknown>).role !== undefined &&
              ((m as Record<string, unknown>).role === "user" || (m as Record<string, unknown>).role === "assistant") &&
              typeof (m as Record<string, unknown>).content === "string"
          )
          .slice(-10)
      : [];

    const response = await runDefiAgent(query, conversationHistory);

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
