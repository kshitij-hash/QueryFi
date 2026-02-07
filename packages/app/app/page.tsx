"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { DeFiChat } from "@/components/defi-chat";
import { AgentTreasury } from "@/components/agent-treasury";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WalletIcon } from "@phosphor-icons/react";

const PRICING_ITEMS = [
  { query: "Basic Question", price: "$0.01", description: "General DeFi questions and concepts" },
  { query: "Health Factor", price: "$0.02", description: "Check liquidation risk for any address" },
  { query: "IL Calculation", price: "$0.03", description: "Impermanent loss between two price points" },
  { query: "Yield Search", price: "$0.05", description: "Find the best yields across protocols" },
] as const;

export default function Home() {
  const { isConnected } = useAccount();

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* Sticky Header */}
        <header className="sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b border-border">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <h1 className="text-xl font-bold text-gradient">QueryFi</h1>
            <ConnectButton
              chainStatus="icon"
              showBalance={false}
              accountStatus="avatar"
            />
          </div>
        </header>

        {/* Hero Section — only when disconnected */}
        {!isConnected && (
          <>
            <section className="relative py-12 text-center overflow-hidden">
              {/* Gradient orb */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] rounded-full bg-primary/15 blur-[100px] pointer-events-none" />

              <div className="relative space-y-4">
                <Badge variant="secondary" className="text-xs">
                  Pay per query &middot; No subscriptions
                </Badge>
                <h2 className="text-5xl font-bold tracking-tight text-foreground">
                  DeFi Analytics on Demand
                </h2>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                  AI-powered insights for yields, health factors, impermanent loss
                  &amp; more. Pay only for what you use.
                </p>

                {/* Pricing chips with tooltips */}
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  {PRICING_ITEMS.map((item) => (
                    <Tooltip key={item.query}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className="text-xs font-normal cursor-default"
                        >
                          {item.query}{" "}
                          <span className="ml-1 font-semibold text-primary">
                            {item.price}
                          </span>
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{item.description}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </section>

            <div className="container mx-auto px-4">
              <div className="max-w-6xl mx-auto">
                <Separator className="mb-8" />
              </div>
            </div>
          </>
        )}

        {/* Main Content */}
        {isConnected ? (
          <main className="container mx-auto px-4 py-4">
            <div className="max-w-6xl mx-auto flex flex-col lg:flex-row lg:items-start gap-6">
              <div className="flex-1 min-w-0">
                <DeFiChat />
              </div>
              <div className="w-full lg:w-[380px] shrink-0">
                <AgentTreasury />
              </div>
            </div>
          </main>
        ) : (
          <main className="container mx-auto px-4 pb-12">
            <div className="max-w-lg mx-auto">
              <Card className="p-10 text-center space-y-4">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
                  <WalletIcon className="size-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  Connect your wallet to get started
                </h3>
                <p className="text-sm text-muted-foreground">
                  Connect a wallet to open a payment channel and start asking
                  DeFi questions. You only pay for the queries you make.
                </p>
                <div className="pt-2 flex justify-center">
                  <ConnectButton />
                </div>
              </Card>
            </div>
          </main>
        )}
      </div>
    </TooltipProvider>
  );
}
