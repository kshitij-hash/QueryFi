"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

export default function Home() {
  const { isConnected } = useAccount();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">QueryFi</h1>
          <ConnectButton />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto text-center space-y-6">
          <h2 className="text-4xl font-bold text-foreground">
            Pay-per-Query DeFi Analytics
          </h2>
          <p className="text-lg text-muted-foreground">
            Ask anything about DeFi. Pay only for what you use.
          </p>

          {!isConnected ? (
            <div className="p-8 rounded-xl border border-border bg-card flex flex-col items-center">
              <p className="text-muted-foreground mb-4">
                Connect your wallet to start querying
              </p>
              <ConnectButton />
            </div>
          ) : (
            <div className="p-8 rounded-xl border border-border bg-card">
              <p className="text-foreground mb-2">Wallet connected!</p>
              <p className="text-muted-foreground text-sm">
                Chat interface coming soon...
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
            {[
              { query: "Basic Question", price: "$0.01" },
              { query: "Health Factor", price: "$0.02" },
              { query: "IL Calculation", price: "$0.03" },
              { query: "Yield Search", price: "$0.05" },
            ].map((item) => (
              <div
                key={item.query}
                className="p-4 rounded-lg border border-border bg-card/50"
              >
                <p className="text-sm text-muted-foreground">{item.query}</p>
                <p className="text-lg font-bold text-primary">{item.price}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
