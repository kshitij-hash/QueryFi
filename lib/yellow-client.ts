import type { Hex, Address } from "viem";
import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createAppSessionMessage,
  createSubmitAppStateMessage,
  createCloseAppSessionMessage,
  createPingMessage,
  RPCProtocolVersion,
  type MessageSigner,
} from "@erc7824/nitrolite";

const CLEARNODE_URL = "wss://clearnet-sandbox.yellow.com/ws";

const PAYMENT_ASSET = "ytest.usd";

export const AUTH_SCOPE = "console";
export const AUTH_APPLICATION = "queryfi-defi-agent";
export const AUTH_ALLOWANCES = [{ asset: PAYMENT_ASSET, amount: "10000000" }];
export const AUTH_DURATION_SECS = 86400;

interface PaymentResult {
  queryId: string;
  amount: string;
  instant: boolean;
  appSessionId: Hex;
  version: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class YellowPaymentClient {
  private ws: WebSocket | null = null;
  private authSigner: MessageSigner | null = null;
  private sessionSigner: MessageSigner | null = null;
  private sessionKeyAddress: Address = "0x0" as Address;
  private userAddress: Address = "0x0" as Address;
  private agentAddress: Address = "0x0" as Address;
  private appSessionId: Hex | null = null;
  private stateVersion: number = 0;
  private userBalance: bigint = 0n;
  private agentBalance: bigint = 0n;
  private connected: boolean = false;
  private authenticated: boolean = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private onBalanceChange?: (userBalance: string, agentBalance: string) => void;
  private expiresAt: bigint = 0n;

  async connect(
    userAddress: Address,
    sessionKeyAddress: Address,
    authSigner: MessageSigner,
    sessionSigner: MessageSigner,
    expiresAt: bigint,
    onBalanceChange?: (userBalance: string, agentBalance: string) => void,
  ): Promise<void> {
    this.userAddress = userAddress;
    this.sessionKeyAddress = sessionKeyAddress;
    this.authSigner = authSigner;
    this.sessionSigner = sessionSigner;
    this.expiresAt = expiresAt;
    this.onBalanceChange = onBalanceChange;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(CLEARNODE_URL);

      const connectTimeout = setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
        this.ws?.close();
      }, 15000);

      this.ws.onopen = async () => {
        clearTimeout(connectTimeout);
        console.log("[Yellow] WebSocket connected to ClearNode");
        this.connected = true;

        try {
          await this.authenticate();
          this.startPingLoop();
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectTimeout);
        console.error("[Yellow] WebSocket error:", error);
        reject(new Error("WebSocket connection failed"));
      };

      this.ws.onclose = () => {
        console.log("[Yellow] WebSocket disconnected");
        this.connected = false;
        this.authenticated = false;
        this.stopPingLoop();
      };
    });
  }

  private async authenticate(): Promise<void> {
    if (!this.ws || !this.authSigner) throw new Error("Not connected");

    const authRequestMsg = await createAuthRequestMessage({
      address: this.userAddress,
      session_key: this.sessionKeyAddress,
      application: AUTH_APPLICATION,
      allowances: AUTH_ALLOWANCES,
      expires_at: this.expiresAt,
      scope: AUTH_SCOPE,
    });

    const challengePromise = this.waitForRawResponse("auth_challenge", 15000);

    this.ws.send(authRequestMsg);

    const rawResponse = await challengePromise;
    const challenge = rawResponse.res[2].challenge_message;
    console.log("[Yellow] Got challenge, requesting wallet signature...");

    const verifyPromise = this.waitForRawResponse("auth_verify", 30000);

    const authVerifyMsg = await createAuthVerifyMessageFromChallenge(
      this.authSigner,
      challenge,
    );

    this.ws.send(authVerifyMsg);

    const verifyResponse = await verifyPromise;
    if (verifyResponse.res[2].success === false) {
      throw new Error("Authentication rejected by ClearNode");
    }

    this.authenticated = true;
    console.log("[Yellow] Authenticated successfully");
  }

  async createPaymentSession(
    agentAddress: Address,
    initialDeposit: string,
  ): Promise<Hex> {
    if (!this.ws || !this.sessionSigner || !this.authenticated) {
      throw new Error("Not connected or not authenticated");
    }

    this.agentAddress = agentAddress;
    this.userBalance = BigInt(initialDeposit);
    this.agentBalance = 0n;
    this.stateVersion = 0;

    const sessionMsg = await createAppSessionMessage(this.sessionSigner, {
      definition: {
        application: AUTH_APPLICATION,
        protocol: RPCProtocolVersion.NitroRPC_0_2,
        participants: [this.userAddress, this.agentAddress],
        weights: [100, 0],
        quorum: 100,
        challenge: 0,
        nonce: Date.now(),
      },
      allocations: [
        {
          participant: this.userAddress,
          asset: PAYMENT_ASSET,
          amount: initialDeposit,
        },
        {
          participant: this.agentAddress,
          asset: PAYMENT_ASSET,
          amount: "0",
        },
      ],
    });

    const sessionPromise = this.waitForRawResponse("create_app_session", 30000);
    this.ws.send(sessionMsg);
    const response = await sessionPromise;

    this.appSessionId = response.res[2].app_session_id;
    this.stateVersion = response.res[2].version ?? 0;
    console.log("[Yellow] App session created:", this.appSessionId);

    return this.appSessionId!;
  }

  async sendMicropayment(
    amount: string,
    queryId: string,
  ): Promise<PaymentResult> {
    if (!this.ws || !this.sessionSigner || !this.appSessionId) {
      throw new Error("No active session");
    }

    const paymentAmount = BigInt(amount);
    if (paymentAmount > this.userBalance) {
      throw new Error(
        `Insufficient balance: have ${this.userBalance}, need ${paymentAmount}`,
      );
    }

    const newUserBalance = this.userBalance - paymentAmount;
    const newAgentBalance = this.agentBalance + paymentAmount;

    const stateMsg =
      await createSubmitAppStateMessage<RPCProtocolVersion.NitroRPC_0_2>(
        this.sessionSigner,
        {
          app_session_id: this.appSessionId,
          allocations: [
            {
              participant: this.userAddress,
              asset: PAYMENT_ASSET,
              amount: newUserBalance.toString(),
            },
            {
              participant: this.agentAddress,
              asset: PAYMENT_ASSET,
              amount: newAgentBalance.toString(),
            },
          ],
          session_data: JSON.stringify({ queryId, timestamp: Date.now() }),
        },
      );

    const statePromise = this.waitForRawResponse("submit_app_state", 15000);
    this.ws.send(stateMsg);
    const response = await statePromise;

    this.userBalance = newUserBalance;
    this.agentBalance = newAgentBalance;
    this.stateVersion = response.res[2].version ?? this.stateVersion + 1;

    console.log(
      `[Yellow] Payment: $${(Number(amount) / 1_000_000).toFixed(2)} for query ${queryId}`,
    );

    this.onBalanceChange?.(
      this.userBalance.toString(),
      this.agentBalance.toString(),
    );

    return {
      queryId,
      amount,
      instant: true,
      appSessionId: this.appSessionId,
      version: this.stateVersion,
    };
  }

  async closeSession(): Promise<void> {
    if (!this.ws || !this.sessionSigner || !this.appSessionId) return;

    const closeMsg = await createCloseAppSessionMessage(this.sessionSigner, {
      app_session_id: this.appSessionId,
      allocations: [
        {
          participant: this.userAddress,
          asset: PAYMENT_ASSET,
          amount: this.userBalance.toString(),
        },
        {
          participant: this.agentAddress,
          asset: PAYMENT_ASSET,
          amount: this.agentBalance.toString(),
        },
      ],
    });

    const closePromise = this.waitForRawResponse("close_app_session", 30000);
    this.ws.send(closeMsg);
    await closePromise;
    console.log("[Yellow] Session closed, settlement initiated");
    this.appSessionId = null;
  }

  private handleMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw);

      if (parsed.res && Array.isArray(parsed.res)) {
        const method = parsed.res[1] as string;

        const pending = this.pendingRequests.get(method);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(method);

          if (method === "error") {
            const errorMsg = parsed.res[2]?.error || "Unknown error";
            pending.reject(new Error(errorMsg));
            return;
          }

          pending.resolve(parsed);
          return;
        }

        if (method === "error" && this.pendingRequests.size > 0) {
          const errorMsg = parsed.res[2]?.error || "Unknown error";
          console.error("[Yellow] Error while request pending:", errorMsg);
          const [key, firstPending] = this.pendingRequests.entries().next()
            .value as [string, PendingRequest];
          clearTimeout(firstPending.timeout);
          this.pendingRequests.delete(key);
          firstPending.reject(new Error(errorMsg));
          return;
        }

        switch (method) {
          case "bu":
            console.log("[Yellow] Balance update received");
            break;
          case "ping":
            this.sendPong();
            break;
          case "assets":
            console.log("[Yellow] Assets list received");
            break;
          case "error":
            console.error("[Yellow] Error:", parsed.res[2]?.error);
            break;
          default:
            console.log("[Yellow] Unhandled message:", method);
        }
      }
    } catch (error) {
      console.error("[Yellow] Failed to parse message:", error);
    }
  }

  private waitForRawResponse(method: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(method);
        reject(new Error(`Timeout waiting for ${method} response`));
      }, timeoutMs);

      this.pendingRequests.set(method, { resolve, reject, timeout });
    });
  }

  private async sendPong(): Promise<void> {
    if (!this.ws || !this.sessionSigner) return;
    try {
      const pingMsg = await createPingMessage(this.sessionSigner);
      this.ws.send(pingMsg);
    } catch {}
  }

  private startPingLoop(): void {
    this.pingInterval = setInterval(async () => {
      if (this.ws?.readyState === WebSocket.OPEN && this.sessionSigner) {
        try {
          const pingMsg = await createPingMessage(this.sessionSigner);
          this.ws.send(pingMsg);
        } catch {}
      }
    }, 30000);
  }

  private stopPingLoop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  getBalance(): string {
    return this.userBalance.toString();
  }

  getAgentBalance(): string {
    return this.agentBalance.toString();
  }

  getSessionId(): Hex | null {
    return this.appSessionId;
  }

  getVersion(): number {
    return this.stateVersion;
  }

  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  disconnect(): void {
    this.stopPingLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
    this.appSessionId = null;
    this.userBalance = 0n;
    this.agentBalance = 0n;
    this.stateVersion = 0;

    for (const [key, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Disconnected"));
      this.pendingRequests.delete(key);
    }
  }
}
