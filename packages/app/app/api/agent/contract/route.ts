import { NextRequest, NextResponse } from "next/server";
import { executeContractCall } from "@/lib/circle-wallet";

const ALLOWED_CONTRACTS = new Set(
  [
    process.env.SETTLEMENT_HOOK_ADDRESS ?? "0x0cD33a7a876AF045e49a80f07C8c8eaF7A1bc040",
    process.env.ARC_SETTLEMENT_HOOK_ADDRESS,
  ]
    .filter(Boolean)
    .map((a) => a!.toLowerCase())
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

    const result = await executeContractCall(
      contractAddress,
      abiFunctionSignature,
      abiParameters ?? []
    );

    return NextResponse.json({ success: true, transaction: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
