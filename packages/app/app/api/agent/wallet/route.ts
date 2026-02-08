import { NextResponse } from "next/server";
import { getAgentWallet, getAgentBalance } from "@/lib/circle-wallet";

export async function GET() {
  try {
    const wallet = await getAgentWallet();
    const balances = await getAgentBalance();

    const usdcEntry = balances.find((b) => b.token.symbol === "USDC");
    const usdcBalance = usdcEntry?.amount ?? "0.00";

    return NextResponse.json({
      wallet: {
        id: wallet.id,
        address: wallet.address,
        blockchain: wallet.blockchain,
        state: wallet.state,
      },
      balances,
      usdcBalance,
    });
  } catch (error) {
    console.error("Agent wallet API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch wallet",
      },
      { status: 500 },
    );
  }
}
