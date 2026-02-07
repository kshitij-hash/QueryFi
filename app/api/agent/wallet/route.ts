import { NextResponse } from "next/server";
import { getAgentWallet, getAgentBalance } from "@/lib/circle-wallet";

export async function GET() {
  try {
    const [wallet, balances] = await Promise.all([
      getAgentWallet(),
      getAgentBalance(),
    ]);

    const usdcBalance =
      balances.find((b) => b.token.symbol === "USDC")?.amount ?? "0";

    return NextResponse.json({ wallet, balances, usdcBalance });
  } catch (error) {
    console.error("Agent wallet API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch wallet",
      },
      { status: 500 }
    );
  }
}
