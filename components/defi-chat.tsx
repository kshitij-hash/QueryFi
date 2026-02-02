"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  cost?: number;
}

export function DeFiChat() {
  const { address, isConnected } = useAccount();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [balance, setBalance] = useState("0");

  const handleSend = async () => {
    if (!input.trim() || !isConnected) return;
    setInput("");
  };

  if (!isConnected) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">
          Connect your wallet to start querying
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-[500px]">
      {/* Balance Header */}
      <div className="p-4 border-b border-border flex justify-between items-center">
        <div>
          <span className="text-sm text-muted-foreground">Channel Balance:</span>
          <span className="ml-2 font-mono font-bold">${balance} USDC</span>
        </div>
        <Badge variant="secondary">Connected</Badge>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Ask me anything about DeFi!</p>
            <p className="text-sm mt-2">Examples:</p>
            <ul className="text-sm mt-1 space-y-1">
              <li>What&apos;s the best yield for ETH?</li>
              <li>Calculate IL if ETH went from $2000 to $3000</li>
              <li>Check health factor for vitalik.eth</li>
            </ul>
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
                {msg.cost && (
                  <Badge variant="outline" className="mt-2">
                    Cost: ${msg.cost.toFixed(2)}
                  </Badge>
                )}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner size={16} />
            <span>Analyzing...</span>
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about yields, health factors, IL..."
          disabled={isLoading}
        />
        <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
          Send
        </Button>
      </div>
    </Card>
  );
}
