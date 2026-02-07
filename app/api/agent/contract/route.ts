import { NextRequest, NextResponse } from "next/server";
import { executeContractCall } from "@/lib/circle-wallet";

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
