import { NextRequest, NextResponse } from "next/server";
import { withdrawToTreasury } from "@/lib/circle-wallet";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { amount } = body;

    if (!amount || typeof amount !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid amount (string required)" },
        { status: 400 }
      );
    }

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }

    const transaction = await withdrawToTreasury(amount);

    return NextResponse.json({ success: true, transaction });
  } catch (error) {
    console.error("Withdraw API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Withdrawal failed",
      },
      { status: 500 }
    );
  }
}
