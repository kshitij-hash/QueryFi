"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

interface WalletData {
  wallet: {
    id: string;
    address: string;
    blockchain: string;
    state: string;
  };
  balances: Array<{
    token: { symbol: string; name: string };
    amount: string;
  }>;
  usdcBalance: string;
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function AgentTreasury() {
  const [data, setData] = useState<WalletData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/wallet");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch wallet");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load wallet");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  const handleWithdraw = async () => {
    if (!data) return;
    setIsWithdrawing(true);
    setWithdrawResult(null);
    try {
      const res = await fetch("/api/agent/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: data.usdcBalance }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Withdrawal failed");
      setWithdrawResult(
        `Withdrawal initiated (tx: ${json.transaction.transactionId})`
      );
      // Refresh balance after a short delay
      setTimeout(fetchWallet, 3000);
    } catch (err) {
      setWithdrawResult(
        `Error: ${err instanceof Error ? err.message : "Withdrawal failed"}`
      );
    } finally {
      setIsWithdrawing(false);
    }
  };

  if (isLoading && !data) {
    return (
      <Card className="p-6 flex items-center justify-center gap-2">
        <Spinner className="size-4" />
        <span className="text-muted-foreground text-sm">
          Loading agent wallet...
        </span>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchWallet}>
          Retry
        </Button>
      </Card>
    );
  }

  if (!data) return null;

  const hasBalance = parseFloat(data.usdcBalance) > 0;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Agent Treasury
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-green-500/20 text-green-400">
            {data.wallet.blockchain}
          </Badge>
          <Badge variant="outline" className="font-mono text-xs">
            {truncateAddress(data.wallet.address)}
          </Badge>
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">USDC Balance</p>
          <p className="text-3xl font-bold text-foreground tabular-nums">
            ${data.usdcBalance}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchWallet}
            disabled={isLoading}
          >
            {isLoading ? <Spinner className="size-3.5" /> : "Refresh"}
          </Button>
          <Button
            size="sm"
            onClick={handleWithdraw}
            disabled={isWithdrawing || !hasBalance}
          >
            {isWithdrawing ? (
              <>
                <Spinner className="size-3.5 mr-2" />
                Withdrawing...
              </>
            ) : (
              "Withdraw to Treasury"
            )}
          </Button>
        </div>
      </div>

      {withdrawResult && (
        <p
          className={`text-xs ${
            withdrawResult.startsWith("Error")
              ? "text-red-400"
              : "text-green-400"
          }`}
        >
          {withdrawResult}
        </p>
      )}
    </Card>
  );
}
