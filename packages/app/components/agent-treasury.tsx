"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WalletIcon, ClockIcon, WarningIcon, CheckCircleIcon } from "@phosphor-icons/react";

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
  const [isSettling, setIsSettling] = useState(false);
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
      const txId = json.settlement.transactionId;
      const txShort = txId ? truncateAddress(txId) : "pending";
      setSettleResult(
        `Settlement submitted: $${json.settlement.amountUsdc} USDC (tx: ${txShort})`
      );
      // Refresh settlement immediately (clears pending), then poll wallet
      // multiple times since the on-chain tx takes time to confirm
      fetchSettlement();
      setTimeout(fetchWallet, 3000);
      setTimeout(fetchWallet, 8000);
      setTimeout(fetchWallet, 15000);
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
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-28" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
          <Skeleton className="h-8 w-full rounded-full" />
        </div>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-5">
        <Alert variant="destructive">
          <WarningIcon className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchWallet}>
          Retry
        </Button>
      </Card>
    );
  }

  if (!data) return null;

  const hasPending = settlement ? settlement.accumulated > 0 : false;
  const progressPercent = settlement
    ? Math.min((settlement.accumulated / settlement.threshold) * 100, 100)
    : 0;

  // Total earned = settled history + pending accumulated
  const totalEarnedMicro = settlement
    ? settlement.history.reduce((sum, s) => sum + s.amount, 0) + settlement.accumulated
    : 0;
  const totalEarnedUsdc = (totalEarnedMicro / 1_000_000).toFixed(2);
  const totalQueries = settlement
    ? settlement.history.reduce((sum, s) => sum + s.queryIds.length, 0) + settlement.pendingPayments
    : 0;


  return (
    <TooltipProvider>
      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5 shrink-0">
            <WalletIcon className="size-4" />
            Agent Treasury
          </h3>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Badge variant="secondary" className="bg-success/15 text-success text-[10px]">
              {data.wallet.blockchain}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="font-mono text-[10px] cursor-default">
                  {truncateAddress(data.wallet.address)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {data.wallet.address}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">USDC Balance</p>
              <p className="text-2xl font-bold text-foreground tabular-nums">
                ${data.usdcBalance}
              </p>
            </div>
            {totalEarnedMicro > 0 && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total Earned</p>
                <p className="text-lg font-bold text-success tabular-nums">
                  +${totalEarnedUsdc}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {totalQueries} queries
                </p>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => { fetchWallet(); fetchSettlement(); }}
            disabled={isLoading}
          >
            {isLoading ? <Spinner className="size-3.5" /> : "Refresh"}
          </Button>
        </div>

        {/* Settlement Section */}
        {settlement && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <ClockIcon className="size-3.5" />
                  Pending Settlement
                </h4>
                {settlement.readyToSettle && (
                  <Badge className="bg-warning/15 text-warning text-[10px]">
                    Threshold Reached
                  </Badge>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Accumulated ({settlement.pendingPayments} queries)
                  </p>
                  <p className="text-lg font-bold text-foreground tabular-nums">
                    ${settlement.accumulatedUsdc}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
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
                <Progress
                  value={progressPercent}
                  className="h-1.5 [&>[data-slot=progress-indicator]]:shadow-[0_0_8px_oklch(0.59_0.20_277_/_0.3)]"
                />
              </div>

              {settleResult && (
                <Alert variant={settleResult.startsWith("Error") ? "destructive" : "default"}>
                  {settleResult.startsWith("Error") ? (
                    <WarningIcon className="size-4" />
                  ) : (
                    <CheckCircleIcon className="size-4 text-success" />
                  )}
                  <AlertDescription className="text-xs break-all">
                    {settleResult}
                  </AlertDescription>
                </Alert>
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
          </>
        )}
      </Card>
    </TooltipProvider>
  );
}
