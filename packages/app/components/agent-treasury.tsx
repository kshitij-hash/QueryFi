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

interface SettlementStatus {
  accumulated: number;
  accumulatedUsdc: string;
  threshold: number;
  thresholdUsdc: string;
  pendingPayments: number;
  readyToSettle: boolean;
  lastSettlementTime: number | null;
  history: Array<{
    transactionId: string | null;
    amount: number;
    queryIds: string[];
    timestamp: number;
  }>;
}

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function AgentTreasury() {
  const [data, setData] = useState<WalletData | null>(null);
  const [settlement, setSettlement] = useState<SettlementStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<string | null>(null);
  const [settleResult, setSettleResult] = useState<string | null>(null);

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

  const fetchSettlement = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/settle");
      const json = await res.json();
      if (res.ok) setSettlement(json);
    } catch {
      // Settlement status is supplementary, don't block UI
    }
  }, []);

  useEffect(() => {
    fetchWallet();
    fetchSettlement();
  }, [fetchWallet, fetchSettlement]);

  // Poll settlement status every 10s
  useEffect(() => {
    const interval = setInterval(fetchSettlement, 10000);
    return () => clearInterval(interval);
  }, [fetchSettlement]);

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
      setTimeout(fetchWallet, 3000);
    } catch (err) {
      setWithdrawResult(
        `Error: ${err instanceof Error ? err.message : "Withdrawal failed"}`
      );
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleSettle = async () => {
    setIsSettling(true);
    setSettleResult(null);
    try {
      const res = await fetch("/api/agent/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Settlement failed");
      setSettleResult(
        `Settlement submitted: $${json.settlement.amountUsdc} USDC (tx: ${json.settlement.transactionId})`
      );
      // Refresh both after settlement
      setTimeout(() => {
        fetchWallet();
        fetchSettlement();
      }, 3000);
    } catch (err) {
      setSettleResult(
        `Error: ${err instanceof Error ? err.message : "Settlement failed"}`
      );
    } finally {
      setIsSettling(false);
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
  const hasPending = settlement ? settlement.accumulated > 0 : false;
  const progressPercent = settlement
    ? Math.min((settlement.accumulated / settlement.threshold) * 100, 100)
    : 0;

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
            onClick={() => { fetchWallet(); fetchSettlement(); }}
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

      {/* Settlement Section */}
      {settlement && (
        <div className="border-t border-border pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Pending Settlement
            </h4>
            {settlement.readyToSettle && (
              <Badge className="bg-yellow-500/20 text-yellow-400 text-[10px]">
                Threshold Reached
              </Badge>
            )}
          </div>

          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                Accumulated ({settlement.pendingPayments} queries)
              </p>
              <p className="text-xl font-bold text-foreground tabular-nums">
                ${settlement.accumulatedUsdc}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSettle}
              disabled={isSettling || !hasPending}
            >
              {isSettling ? (
                <>
                  <Spinner className="size-3.5 mr-2" />
                  Settling...
                </>
              ) : (
                "Settle Now"
              )}
            </Button>
          </div>

          {/* Progress bar toward threshold */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>${settlement.accumulatedUsdc}</span>
              <span>${settlement.thresholdUsdc} (auto-settle)</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {settleResult && (
            <p
              className={`text-xs ${
                settleResult.startsWith("Error")
                  ? "text-red-400"
                  : "text-green-400"
              }`}
            >
              {settleResult}
            </p>
          )}

          {/* Recent settlements */}
          {settlement.history.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Recent Settlements
              </p>
              {settlement.history.slice(-3).reverse().map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs text-muted-foreground"
                >
                  <span>
                    ${(s.amount / 1_000_000).toFixed(2)} ({s.queryIds.length} queries)
                  </span>
                  <span className="font-mono text-[10px]">
                    {s.transactionId
                      ? truncateAddress(s.transactionId)
                      : "pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
