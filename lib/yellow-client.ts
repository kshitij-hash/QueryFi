import type { Hex } from "viem";

const CLEARNODE_SANDBOX = "wss://clearnet-sandbox.yellow.com/ws";

export type MessageSigner = (message: string) => Promise<string>;

interface PaymentResult {
  queryId: string;
  amount: string;
  instant: boolean;
  signature?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class YellowPaymentClient {
  private ws: WebSocket | null = null;
  private messageSigner: MessageSigner | null = null;
  private userAddress: string = "";
  private agentAddress: string = "";
  private sessionId: string | null = null;
  private balance: string = "0";
  private connected: boolean = false;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestIdCounter: number = 0;

  /**
   * Connect to Yellow Network ClearNode
   */
  async connect(userAddress: string, signer: MessageSigner): Promise<void> {
    this.userAddress = userAddress;
    this.messageSigner = signer;

    // For hackathon demo: simulate connection without real WebSocket
    // Yellow Network sandbox requires pre-existing channel setup
    console.log("✅ Connected to Yellow Network ClearNode (simulated)");
    this.connected = true;
    return Promise.resolve();
  }

  /**
   * Connect to real Yellow Network (for production)
   */
  async connectReal(userAddress: string, signer: MessageSigner): Promise<void> {
    this.userAddress = userAddress;
    this.messageSigner = signer;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(CLEARNODE_SANDBOX);

      this.ws.onopen = () => {
        console.log("✅ Connected to Yellow Network ClearNode");
        this.connected = true;
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        console.error("❌ Yellow Network WebSocket error:", error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log("🔌 Disconnected from Yellow Network");
        this.connected = false;
      };
    });
  }

  /**
   * Create a payment session with the agent
   */
  async createPaymentSession(
    agentAddress: string,
    initialDeposit: string
  ): Promise<string> {
    if (!this.messageSigner || !this.connected) {
      throw new Error("Not connected");
    }

    this.agentAddress = agentAddress;
    this.balance = initialDeposit;

    const requestId = this.generateRequestId();
    const timestamp = Date.now();

    // Create app session request following Nitrolite RPC format
    const params = {
      definition: {
        application: "queryfi-pay-per-query",
        protocol: "NitroRPC/0.2",
        participants: [this.userAddress, agentAddress],
        weights: [100, 0],
        quorum: 100,
        challenge: 0,
        nonce: timestamp,
      },
      allocations: [
        {
          participant: this.userAddress,
          asset: "usdc",
          amount: initialDeposit,
        },
        {
          participant: agentAddress,
          asset: "usdc",
          amount: "0",
        },
      ],
    };

    // Create the RPC message
    const rpcData = [requestId, "create_app_session", params, timestamp];
    const messageToSign = JSON.stringify(rpcData);

    try {
      // Sign the message to prove intent (off-chain signature)
      const signature = await this.messageSigner!(messageToSign);

      // For hackathon demo: simulate session creation
      // In production, this would send to Yellow Network
      this.sessionId = `session_${timestamp}`;
      console.log("📝 Session created:", this.sessionId);
      console.log("🔏 Signature:", signature.slice(0, 20) + "...");

      return this.sessionId;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Send a micropayment for a query
   */
  async sendMicropayment(
    amount: string,
    queryId: string
  ): Promise<PaymentResult> {
    if (!this.messageSigner || !this.connected) {
      throw new Error("Not connected");
    }

    if (!this.sessionId) {
      throw new Error("No active session");
    }

    // Create payment data
    const paymentData = {
      type: "micropayment",
      amount, // In USDC units (6 decimals: 10000 = $0.01)
      queryId,
      timestamp: Date.now(),
      sessionId: this.sessionId,
    };

    // For hackathon demo: simulate payment without signature prompt
    // This demonstrates the UX of instant, gasless micropayments
    // In production, each payment would be signed and sent to Yellow Network
    console.log("💰 Micropayment:", `$${(Number(amount) / 1_000_000).toFixed(2)}`, "for query:", queryId);

    // Update local balance
    this.balance = String(Number(this.balance) - Number(amount));

    return {
      queryId,
      amount,
      instant: true,
      signature: "simulated",
    };
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle session creation response
      if (message.result?.app_session_id) {
        this.sessionId = message.result.app_session_id;
        const pending = this.pendingRequests.get("session_create");
        if (pending) {
          pending.resolve(this.sessionId);
          this.pendingRequests.delete("session_create");
        }
        console.log("📝 Session created:", this.sessionId);
        return;
      }

      // Handle RPC response format
      if (message.res && Array.isArray(message.res)) {
        const [, , result] = message.res;
        if (result?.app_session_id) {
          this.sessionId = result.app_session_id;
          const pending = this.pendingRequests.get("session_create");
          if (pending) {
            pending.resolve(this.sessionId);
            this.pendingRequests.delete("session_create");
          }
          console.log("📝 Session created:", this.sessionId);
          return;
        }
      }

      // Handle payment confirmation
      if (message.method === "payment_confirmed") {
        console.log("💰 Payment confirmed:", message.params?.amount);
        return;
      }

      // Handle errors
      if (message.error) {
        console.error("❌ Yellow error:", message.error);
        // Reject any pending requests
        for (const [key, pending] of this.pendingRequests) {
          pending.reject(new Error(message.error.message || "Unknown error"));
          this.pendingRequests.delete(key);
        }
        return;
      }

      // Handle balance updates
      if (message.method === "balance_update") {
        this.balance = message.params?.balance || this.balance;
        console.log("💵 Balance updated:", this.balance);
        return;
      }
    } catch (error) {
      console.error("Failed to parse message:", error);
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    this.requestIdCounter++;
    return `req_${Date.now()}_${this.requestIdCounter}`;
  }

  /**
   * Get current channel balance
   */
  getBalance(): string {
    return this.balance;
  }

  /**
   * Get session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get user address
   */
  getUserAddress(): string {
    return this.userAddress;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from Yellow Network
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.sessionId = null;
    this.balance = "0";
  }
}
