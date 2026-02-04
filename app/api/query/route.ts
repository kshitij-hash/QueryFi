import { NextRequest, NextResponse } from "next/server";
import { runDefiAgent } from "@/lib/defi-agent";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, queryId } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    if (!queryId || typeof queryId !== "string") {
      return NextResponse.json({ error: "Missing queryId" }, { status: 400 });
    }

    const response = await runDefiAgent(query);

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
