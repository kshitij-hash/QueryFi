"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { type Hex, type Address } from "viem";
import {
  YellowPaymentClient,
  AUTH_SCOPE,
  AUTH_APPLICATION,
  AUTH_ALLOWANCES,
  AUTH_DURATION_SECS,
} from "@/lib/yellow-client";
import {
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
} from "@erc7824/nitrolite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const AGENT_ADDRESS = (process.env.NEXT_PUBLIC_AGENT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

export function useYellowPayment() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const clientRef = useRef<YellowPaymentClient | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [balance, setBalance] = useState<string>("0");
  const [sessionId, setSessionId] = useState<Hex | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new YellowPaymentClient();
    }
    return clientRef.current;
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  const connect = useCallback(
    async (depositAmount: string) => {
      if (!address) throw new Error("Wallet not connected");
      if (!walletClient) throw new Error("Wallet client not available");

      setIsLoading(true);
      setError(null);

      try {
        const client = getClient();

        const expiresAt = BigInt(
          Math.floor(Date.now() / 1000) + AUTH_DURATION_SECS,
        );

        const sessionPrivateKey = generatePrivateKey();
        const sessionAccount = privateKeyToAccount(sessionPrivateKey);

        const authParams = {
          scope: AUTH_SCOPE,
          session_key: sessionAccount.address as Address,
          expires_at: expiresAt,
          allowances: AUTH_ALLOWANCES,
        };

        const eip712Signer = createEIP712AuthMessageSigner(
          walletClient,
          authParams,
          { name: AUTH_APPLICATION },
        );

        const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

        const onBalanceChange = (userBalance: string) => {
          setBalance(userBalance);
        };

        const onDisconnect = () => {
          console.log("[Yellow] Connection lost, resetting state");
          setIsConnected(false);
          setBalance("0");
          setSessionId(null);
          setError("Connection lost. Please reopen the channel.");
        };

        await client.connect(
          address as Address,
          sessionAccount.address as Address,
          eip712Signer,
          sessionSigner,
          expiresAt,
          onBalanceChange,
          onDisconnect,
        );

        const newSessionId = await client.createPaymentSession(
          AGENT_ADDRESS,
          depositAmount,
        );

        setIsConnected(true);
        setBalance(depositAmount);
        setSessionId(newSessionId);

        return newSessionId;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Connection failed";
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [address, walletClient, getClient],
  );

  const payForQuery = useCallback(
    async (queryId: string, priceUsdc: number) => {
      const client = clientRef.current;
      if (!client || !isConnected) {
        throw new Error("Not connected to Yellow Network");
      }

      const amount = String(Math.floor(priceUsdc * 1_000_000));

      const result = await client.sendMicropayment(amount, queryId);

      setBalance(client.getBalance());

      return result;
    },
    [isConnected],
  );

  const closeSession = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      await client.closeSession();
    } finally {
      setIsConnected(false);
      setBalance("0");
      setSessionId(null);
    }
  }, []);

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

  const formattedBalance = useCallback(() => {
    return (Number(balance) / 1_000_000).toFixed(2);
  }, [balance]);

  return {
    isConnected,
    balance,
    sessionId,
    isLoading,
    error,

    connect,
    payForQuery,
    closeSession,
    disconnect,

    formattedBalance,
  };
}
