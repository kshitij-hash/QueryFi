"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useYellowPayment } from "@/hooks/useYellowPayment";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  cost?: number;
}

// Query pricing in USDC
const QUERY_PRICES: Record<string, number> = {
  health_factor: 0.02,
  yield_search: 0.05,
  il_calculation: 0.03,
  portfolio_overview: 0.1,
  general_question: 0.01,
};

export function DeFiChat() {
  const { address, isConnected: isWalletConnected } = useAccount();
  const {
    connect,
    payForQuery,
    isConnected: isChannelConnected,
    balance,
    formattedBalance,
    isLoading: isConnecting,
    error: connectionError,
  } = useYellowPayment();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Open payment channel with $1 deposit
  const handleOpenChannel = async () => {
    try {
      await connect("1000000"); // 1 USDC in 6-decimal units
      setMessages([
        {
          role: "system",
          content:
            "Payment channel opened with $1.00 USDC. Ask me anything about DeFi!",
        },
      ]);
    } catch (error) {
      setMessages([
        {
          role: "system",
          content: `Failed to open channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ]);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !isChannelConnected) return;

    const userMessage = input;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      // Generate query ID
      const queryId = `q_${Date.now()}`;

      // Determine price based on query type (simplified classification)
      let price = QUERY_PRICES.general_question;
      const lowerMsg = userMessage.toLowerCase();
      if (lowerMsg.includes("health") || lowerMsg.includes("liquidation")) {
        price = QUERY_PRICES.health_factor;
      } else if (lowerMsg.includes("yield") || lowerMsg.includes("apy")) {
        price = QUERY_PRICES.yield_search;
      } else if (lowerMsg.includes("impermanent") || lowerMsg.includes("il")) {
        price = QUERY_PRICES.il_calculation;
      }

      // Pay for query via state channel (instant, gasless)
      await payForQuery(queryId, price);

      // TODO: Call AI backend API
      // For now, simulate response
      const mockResponse = getMockResponse(userMessage);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: mockResponse,
          cost: price,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${error instanceof Error ? error.message : "Failed to process query"}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isWalletConnected) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">
          Connect your wallet to start querying
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-[500px] overflow-hidden">
      {/* Balance Header */}
      <div className="flex-shrink-0 p-4 border-b border-border flex justify-between items-center">
        <div>
          <span className="text-sm text-muted-foreground">Channel Balance:</span>
          <span className="ml-2 font-mono font-bold">
            ${formattedBalance()} USDC
          </span>
        </div>
        {!isChannelConnected ? (
          <Button
            onClick={handleOpenChannel}
            disabled={isConnecting}
            size="sm"
          >
            {isConnecting ? (
              <>
                <Spinner className="size-3.5 mr-2" />
                Opening...
              </>
            ) : (
              "Open Channel ($1)"
            )}
          </Button>
        ) : (
          <Badge variant="secondary" className="bg-green-500/20 text-green-400">
            Channel Active
          </Badge>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 p-4">
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            {isChannelConnected ? (
              <>
                <p>Ask me anything about DeFi!</p>
                <p className="text-sm mt-2">Examples:</p>
                <ul className="text-sm mt-1 space-y-1">
                  <li>What&apos;s the best yield for ETH? ($0.05)</li>
                  <li>Calculate IL if ETH went from $2000 to $3000 ($0.03)</li>
                  <li>Check health factor for vitalik.eth ($0.02)</li>
                </ul>
              </>
            ) : (
              <p>Open a payment channel to start querying</p>
            )}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`mb-4 ${msg.role === "user" ? "text-right" : ""}`}
            >
              <div
                className={`inline-block max-w-[80%] p-3 rounded-lg ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : msg.role === "system"
                      ? "bg-yellow-500/20 text-yellow-200"
                      : "bg-muted"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.cost !== undefined && (
                  <Badge variant="outline" className="mt-2 text-xs">
                    Cost: ${msg.cost.toFixed(2)}
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            <span>Analyzing...</span>
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="flex-shrink-0 p-4 border-t border-border flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={
            isChannelConnected
              ? "Ask about yields, health factors, IL..."
              : "Open a payment channel first"
          }
          disabled={isLoading || !isChannelConnected}
        />
        <Button
          onClick={handleSend}
          disabled={isLoading || !input.trim() || !isChannelConnected}
        >
          Send
        </Button>
      </div>

      {/* Error Display */}
      {connectionError && (
        <div className="flex-shrink-0 p-2 bg-red-500/20 text-red-400 text-sm text-center">
          {connectionError}
        </div>
      )}
    </Card>
  );
}

// Mock response generator (to be replaced with actual AI backend)
function getMockResponse(query: string): string {
  const lower = query.toLowerCase();

  if (lower.includes("yield") || lower.includes("apy")) {
    return `Top ETH Yields (DeFi Llama):

1. Lido stETH - 3.2% APY ($12.5B TVL)
2. Rocket Pool rETH - 3.1% APY ($2.1B TVL)
3. Aave v3 ETH - 2.8% APY ($1.8B TVL)
4. Compound v3 ETH - 2.5% APY ($890M TVL)

Recommendation: Lido offers the best risk-adjusted yield with high liquidity.`;
  }

  if (lower.includes("health") || lower.includes("liquidation")) {
    return `Health Factor Analysis:

Unable to fetch on-chain data for this address.

General guidelines:
- Health Factor > 2.0: Safe
- Health Factor 1.5-2.0: Moderate risk
- Health Factor < 1.5: Consider repaying debt
- Health Factor < 1.1: High liquidation risk`;
  }

  if (lower.includes("impermanent") || lower.includes("il")) {
    return `Impermanent Loss Calculator:

For a 50% price change:
- V2 LP: ~5.7% IL
- V3 Concentrated (2x): ~11.4% IL

IL is only realized when you withdraw. If fees earned > IL, you're still profitable.`;
  }

  return `I can help you with:
- Finding best DeFi yields
- Checking lending position health factors
- Calculating impermanent loss
- General DeFi questions

What would you like to know?`;
}
