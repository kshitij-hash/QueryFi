"use client";

import { useState, useCallback, useRef } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { YellowPaymentClient } from "@/lib/yellow-client";

const AGENT_ADDRESS =
  process.env.NEXT_PUBLIC_AGENT_ADDRESS ||
  "0x0000000000000000000000000000000000000000";

interface PaymentResult {
  queryId: string;
  amount: string;
  instant: boolean;
  signature?: string;
}

export function useYellowPayment() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Use ref to persist client across renders
  const clientRef = useRef<YellowPaymentClient | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [balance, setBalance] = useState<string>("0");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Get or create the Yellow client
   */
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new YellowPaymentClient();
    }
    return clientRef.current;
  }, []);

  /**
   * Connect to Yellow Network and create payment session
   * @param depositAmount Amount to deposit in USDC units (6 decimals)
   */
  const connect = useCallback(
    async (depositAmount: string) => {
      if (!address) throw new Error("Wallet not connected");

      setIsLoading(true);
      setError(null);

      try {
        const client = getClient();

        // Create signer function using wagmi
        const signer = async (msg: string) => signMessageAsync({ message: msg });

        // Connect to Yellow Network
        await client.connect(address, signer);

        // Create payment session with agent
        const newSessionId = await client.createPaymentSession(
          AGENT_ADDRESS,
          depositAmount
        );

        setIsConnected(true);
        setBalance(depositAmount);
        setSessionId(newSessionId);

        return newSessionId;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Connection failed";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [address, signMessageAsync, getClient]
  );

  /**
   * Pay for a query
   * @param queryId Unique identifier for the query
   * @param priceUsdc Price in USDC (e.g., 0.01 for 1 cent)
   */
  const payForQuery = useCallback(
    async (queryId: string, priceUsdc: number): Promise<PaymentResult> => {
      const client = clientRef.current;
      if (!client || !isConnected) {
        throw new Error("Not connected to Yellow Network");
      }

      // Convert price to 6-decimal USDC units
      const amount = String(Math.floor(priceUsdc * 1_000_000));

      const result = await client.sendMicropayment(amount, queryId);

      // Update local balance
      setBalance(client.getBalance());

      return result;
    },
    [isConnected]
  );

  /**
   * Disconnect from Yellow Network
   */
  const disconnect = useCallback(() => {
    const client = clientRef.current;
    if (client) {
      client.disconnect();
      clientRef.current = null;
    }

    setIsConnected(false);
    setBalance("0");
    setSessionId(null);
    setError(null);
  }, []);

  /**
   * Format balance for display
   */
  const formattedBalance = useCallback(() => {
    return (Number(balance) / 1_000_000).toFixed(2);
  }, [balance]);

  return {
    // State
    isConnected,
    balance,
    sessionId,
    isLoading,
    error,

    // Actions
    connect,
    payForQuery,
    disconnect,

    // Helpers
    formattedBalance,
  };
}
