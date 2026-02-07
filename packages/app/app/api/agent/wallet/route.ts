import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

export async function GET() {
  try {
    const privateKey = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
    if (!privateKey) {
      throw new Error("AGENT_PRIVATE_KEY not configured");
    }

    const account = privateKeyToAccount(privateKey);
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    const usdcRaw = await client.readContract({
      address: USDC_ADDRESS,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account.address],
    });

    const usdcBalance = (Number(usdcRaw) / 1_000_000).toFixed(2);

    return NextResponse.json({
      wallet: {
        id: "agent-eoa",
        address: account.address,
        blockchain: "BASE-SEPOLIA",
        state: "LIVE",
      },
      balances: [
        {
          token: { symbol: "USDC", name: "USD Coin" },
          amount: usdcBalance,
        },
      ],
      usdcBalance,
    });
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
