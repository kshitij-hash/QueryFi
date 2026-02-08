import { NextRequest, NextResponse } from "next/server";
import { executeContractCall } from "@/lib/circle-wallet";

const BASE_HOOK = (
  process.env.SETTLEMENT_HOOK_ADDRESS ?? "0x974E39C679dd172eC68568cBa6f62CdF4BFeC040"
).toLowerCase();

const ARC_HOOK = process.env.ARC_SETTLEMENT_HOOK_ADDRESS?.toLowerCase();

const ALLOWED_CONTRACTS = new Set(
  [BASE_HOOK, ARC_HOOK].filter(Boolean) as string[]
);

const ALLOWED_FUNCTIONS = new Set([
  "depositMicropayment(uint256,bytes32)",
  "recordSettlement(uint256,bytes32)",
  "settleNow()",
  "setSettlementThreshold(uint256)",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contractAddress, abiFunctionSignature, abiParameters } = body;

    if (!contractAddress || !abiFunctionSignature) {
      return NextResponse.json(
        { error: "contractAddress and abiFunctionSignature are required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_CONTRACTS.has(contractAddress.toLowerCase())) {
      return NextResponse.json(
        { error: "Contract address not allowed" },
        { status: 403 }
      );
    }

    if (!ALLOWED_FUNCTIONS.has(abiFunctionSignature)) {
      return NextResponse.json(
        { error: "Function not allowed" },
        { status: 403 }
      );
    }

    // Use Arc Circle wallet for Arc hook contracts, Base wallet for everything else
    const isArcContract = ARC_HOOK && contractAddress.toLowerCase() === ARC_HOOK;
    const walletId = isArcContract
      ? process.env.ARC_CIRCLE_WALLET_ID
      : undefined;

    const result = await executeContractCall(
      contractAddress,
      abiFunctionSignature,
      abiParameters ?? [],
      walletId
    );

    return NextResponse.json({ success: true, transaction: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
