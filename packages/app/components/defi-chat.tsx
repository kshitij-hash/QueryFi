"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useYellowPayment } from "@/hooks/useYellowPayment";
import {
  MagnifyingGlassIcon,
  ArrowUpIcon,
  WarningIcon,
  ArrowClockwiseIcon,
} from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";

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

const EXAMPLE_QUERIES = [
  { text: "Best yield for ETH?", price: "$0.05" },
  { text: "Calculate IL for ETH $2000→$3000", price: "$0.03" },
  { text: "What's the price of ETH?", price: "$0.01" },
  { text: "What is a flash loan?", price: "$0.01" },
];

export function DeFiChat() {
  const { isConnected: isWalletConnected } = useAccount();
  const {
    connect,
    payForQuery,
    isConnected: isChannelConnected,
    formattedBalance,
    isLoading: isConnecting,
    error: connectionError,
  } = useYellowPayment();

  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = sessionStorage.getItem("queryfi-messages");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Persist messages to sessionStorage
  useEffect(() => {
    if (messages.length > 0) {
      sessionStorage.setItem("queryfi-messages", JSON.stringify(messages));
    } else {
      sessionStorage.removeItem("queryfi-messages");
    }
  }, [messages]);

  // Auto-scroll to latest message
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Only count real conversation (user/assistant) as worth preserving
  const hasConversation = messages.some((m) => m.role === "user" || m.role === "assistant");

  const handleClearHistory = () => {
    setMessages([]);
    sessionStorage.removeItem("queryfi-messages");
  };

  // Open payment channel with $1 deposit
  const handleOpenChannel = async () => {
    try {
      await connect("1000000"); // 1 USDC in 6-decimal units
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: hasConversation
            ? "Channel reconnected with $1.00 USDC. You can continue querying!"
            : "Payment channel opened with $1.00 USDC. Ask me anything about DeFi!",
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Failed to open channel: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ]);
    }
  };

  const handleSend = async (text?: string) => {
    const message = text || input.trim();
    if (!message || !isChannelConnected) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setIsLoading(true);

    try {
      // Generate query ID
      const queryId = `q_${Date.now()}`;

      // Determine price based on query type (simplified classification)
      let price = QUERY_PRICES.general_question;
      const lowerMsg = message.toLowerCase();
      if (lowerMsg.includes("health") || lowerMsg.includes("liquidation")) {
        price = QUERY_PRICES.health_factor;
      } else if (lowerMsg.includes("yield") || lowerMsg.includes("apy")) {
        price = QUERY_PRICES.yield_search;
      } else if (lowerMsg.includes("impermanent") || lowerMsg.includes("il")) {
        price = QUERY_PRICES.il_calculation;
      }

      // Pay for query via state channel (instant, gasless)
      await payForQuery(queryId, price);

      // Call AI backend API
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: message, queryId, price }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get response");
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
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
    <TooltipProvider>
      <Card className="flex flex-col h-[calc(100dvh-6rem)] overflow-hidden">
        {/* Balance Header */}
        <div className="shrink-0 p-4 border-b border-border flex justify-between items-center">
          <div>
            <span className="text-sm text-muted-foreground">
              Channel Balance:
            </span>
            <span className="ml-2 font-mono font-bold">
              ${formattedBalance()} USDC
            </span>
          </div>
          {!isChannelConnected ? (
            <div className="flex items-center gap-2">
              {hasConversation && (
                <Button onClick={handleClearHistory} variant="ghost" size="sm" className="text-muted-foreground">
                  New Session
                </Button>
              )}
              <Button onClick={handleOpenChannel} disabled={isConnecting} size="sm">
                {isConnecting ? (
                  <>
                    <Spinner className="size-3.5 mr-2" />
                    {hasConversation ? "Reconnecting..." : "Opening..."}
                  </>
                ) : hasConversation ? (
                  <>
                    <ArrowClockwiseIcon className="size-3.5 mr-1.5" />
                    Reconnect ($1)
                  </>
                ) : (
                  "Open Channel ($1)"
                )}
              </Button>
            </div>
          ) : (
            <Badge variant="secondary" className="bg-success/15 text-success">
              Channel Active
            </Badge>
          )}
        </div>

        {/* Reconnect banner — only when there's real conversation to preserve */}
        {!isChannelConnected && hasConversation && !isConnecting && (
          <div className="shrink-0 px-4 py-2 bg-warning/10 border-b border-warning/20 flex items-center justify-center gap-2 text-sm text-warning">
            <ArrowClockwiseIcon className="size-4" />
            Channel disconnected. Reconnect to continue querying.
          </div>
        )}

        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0 p-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              {isChannelConnected ? (
                <>
                  <MagnifyingGlassIcon className="size-10 text-muted-foreground/50 mb-3" />
                  <p className="text-lg font-medium text-foreground">
                    Ask anything about DeFi
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Yields, health factors, impermanent loss &amp; more
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  Open a payment channel to start querying
                </p>
              )}
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`mb-4 ${msg.role === "user" ? "text-right" : ""}`}
              >
                <p className="text-xs text-muted-foreground mb-1">
                  {msg.role === "user"
                    ? "You"
                    : msg.role === "assistant"
                      ? "QueryFi"
                      : "System"}
                </p>
                <div
                  className={`inline-block max-w-[80%] px-4 py-2.5 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md"
                      : msg.role === "system"
                        ? "bg-warning/10 text-warning rounded-2xl rounded-bl-md"
                        : "bg-card border border-border rounded-2xl rounded-bl-md"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm prose-invert max-w-none text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_p]:my-1.5 [&_strong]:text-foreground [&_a]:text-primary">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                  )}
                  {msg.cost !== undefined && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="mt-2 text-xs cursor-default">
                          Cost: ${msg.cost.toFixed(2)}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Paid via state channel (instant, gasless)
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-1">QueryFi</p>
              <div className="inline-block max-w-[80%] px-4 py-2.5 bg-card border border-border rounded-2xl rounded-bl-md space-y-2">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </ScrollArea>

        {/* Example query chips — hidden once conversation starts */}
        {isChannelConnected && !isLoading && !hasConversation && (
          <div className="shrink-0 px-4 pt-3 pb-1 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Try asking:</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q.text}
                  onClick={() => handleSend(q.text)}
                  className="px-2.5 py-1 rounded-full text-xs border border-border bg-card hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
                >
                  {q.text}{" "}
                  <span className="text-muted-foreground">{q.price}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 p-4 border-t border-border flex gap-2">
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
            className="rounded-full"
          />
          <Button
            size="icon"
            onClick={() => handleSend()}
            disabled={isLoading || !input.trim() || !isChannelConnected}
            className="shrink-0 rounded-full"
          >
            <ArrowUpIcon className="size-4" weight="bold" />
          </Button>
        </div>

        {/* Error Display */}
        {connectionError && (
          <div className="shrink-0 px-4 pb-3">
            <Alert variant="destructive">
              <WarningIcon className="size-4" />
              <AlertDescription>{connectionError}</AlertDescription>
            </Alert>
          </div>
        )}
      </Card>
    </TooltipProvider>
  );
}
