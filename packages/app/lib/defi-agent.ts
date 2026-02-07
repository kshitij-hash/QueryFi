import { searchYields } from "@/lib/data/defillama-yields";
import { getTokenPrice } from "@/lib/data/defillama-prices";
import { getHealthFactor } from "@/lib/data/aave-health";
import { calculateILFromPrices } from "@/lib/data/il-calculator";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `You are a DeFi analytics assistant and Uniswap v4 pool analyst. You help users find yield opportunities, check lending position health, calculate impermanent loss, look up token prices, and actively monitor and manage Uniswap v4 pools.

You also have your own on-chain wallet on Base Sepolia. You can check your wallet balance using the check_agent_wallet tool when users ask about your wallet.

You have direct access to a Uniswap v4 pool (USDC/WETH on Base Sepolia) and the MicropaymentSettlementHook attached to it. You can:
- Read live pool state (price, tick, liquidity) via get_pool_state
- Monitor hook activity (swap count, accumulated balance, settlement stats) via get_swap_activity
- Autonomously adjust settlement policy (threshold) via adjust_settlement_policy

When discussing pool state:
- sqrtPriceX96 is the square root of the price ratio encoded as a Q64.96 fixed-point number
- Tick represents the log-base-1.0001 of the price ratio
- Liquidity is the active liquidity concentrated around the current tick

When adjusting settlement policy:
- High swap volume → consider lowering threshold for faster payouts to the agent
- Low activity → consider raising threshold to batch settlements and save gas
- Always provide a clear reason for threshold changes

Guidelines:
- Use the available tools to fetch live data when the query requires it
- For general DeFi knowledge questions (e.g. "what is a flash loan?", "how does staking work?"), answer directly from your knowledge without using tools
- Format responses in concise markdown
- Include relevant numbers and sources
- When showing yields, mention APY, TVL, chain, and project
- When showing prices, include the token symbol and USD value
- For health factors, explain the risk level (>2 safe, 1.5-2 moderate, <1.5 risky, <1.1 danger)
- For impermanent loss, show the percentage and explain what it means`;

const tools = [
  {
    type: "function" as const,
    function: {
      name: "search_yields",
      description:
        "Search for DeFi yield opportunities from DeFi Llama. Returns top pools sorted by APY.",
      parameters: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description:
              "Token symbol to filter by (e.g. ETH, USDC, BTC). Optional.",
          },
          chain: {
            type: "string",
            description:
              "Chain to filter by (e.g. Ethereum, Arbitrum, Optimism). Optional.",
          },
          min_tvl: {
            type: "number",
            description:
              "Minimum TVL in USD. Defaults to 1000000 ($1M). Optional.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_token_price",
      description: "Get the current price of a token in USD from DeFi Llama.",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "Token symbol (e.g. ETH, BTC, USDC)",
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_health_factor",
      description:
        "Get the Aave V3 health factor and position details for an Ethereum address or ENS name.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description:
              "Ethereum address (0x...) or ENS name (e.g. vitalik.eth)",
          },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "calculate_impermanent_loss",
      description:
        "Calculate impermanent loss for a 50/50 LP position given entry and current price of the volatile asset.",
      parameters: {
        type: "object",
        properties: {
          entry_price: {
            type: "number",
            description: "Price of the asset when entering the LP position",
          },
          current_price: {
            type: "number",
            description: "Current price of the asset",
          },
        },
        required: ["entry_price", "current_price"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_agent_wallet",
      description:
        "Check the AI agent's own on-chain wallet address, balances, and status on Base Sepolia.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_pool_state",
      description:
        "Read the current state of the Uniswap v4 USDC/WETH pool on Base Sepolia. Returns sqrtPriceX96, tick, liquidity, and fee tier.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_swap_activity",
      description:
        "Get swap activity and settlement stats from the MicropaymentSettlementHook on Base Sepolia. Returns total swaps tracked, accumulated balance, settlement threshold, total settled, and settlement count.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "adjust_settlement_policy",
      description:
        "Adjust the settlement threshold on the MicropaymentSettlementHook. Call this when the user requests a threshold change. The threshold is in USDC (e.g. 0.50 for $0.50). Minimum is $0.01. If the user doesn't provide a reason, infer one based on context (e.g. 'user requested lower threshold for faster payouts').",
      parameters: {
        type: "object",
        properties: {
          new_threshold_usdc: {
            type: "number",
            description:
              "New settlement threshold in USDC (e.g. 0.50 for $0.50). Minimum 0.01.",
          },
          reason: {
            type: "string",
            description:
              "Reason for adjusting the threshold. Infer from context if user doesn't provide one.",
          },
        },
        required: ["new_threshold_usdc"],
      },
    },
  },
];

async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "search_yields": {
      const results = await searchYields({
        token: args.token as string | undefined,
        chain: args.chain as string | undefined,
        minTvl: args.min_tvl as number | undefined,
      });
      return JSON.stringify(results, null, 2);
    }
    case "get_token_price": {
      const result = await getTokenPrice(args.symbol as string);
      return JSON.stringify(result, null, 2);
    }
    case "get_health_factor": {
      const result = await getHealthFactor(args.address as string);
      return JSON.stringify({
        ...result,
        healthFactor: result.healthFactor === Infinity ? "Infinity (no debt)" : result.healthFactor,
      }, null, 2);
    }
    case "calculate_impermanent_loss": {
      const result = calculateILFromPrices(
        args.entry_price as number,
        args.current_price as number
      );
      return JSON.stringify(result, null, 2);
    }
    case "check_agent_wallet": {
      const { createPublicClient, http, parseAbi } = await import("viem");
      const { baseSepolia } = await import("viem/chains");
      const { privateKeyToAccount } = await import("viem/accounts");
      const pk = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
      const account = privateKeyToAccount(pk);
      const client = createPublicClient({ chain: baseSepolia, transport: http() });
      const usdcRaw = await client.readContract({
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
        functionName: "balanceOf",
        args: [account.address],
      });
      const usdcBalance = (Number(usdcRaw) / 1_000_000).toFixed(2);
      return JSON.stringify({
        wallet: { address: account.address, blockchain: "BASE-SEPOLIA", state: "LIVE" },
        usdcBalance,
      }, null, 2);
    }
    case "get_pool_state": {
      const { createPublicClient, http, parseAbi, keccak256, encodePacked } = await import("viem");
      const { baseSepolia } = await import("viem/chains");

      const POOL_MANAGER = "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408";
      const USDC_ADDR = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
      const WETH_ADDR = "0x4200000000000000000000000000000000000006";
      const hookAddress = process.env.SETTLEMENT_HOOK_ADDRESS ?? "0x0cD33a7a876AF045e49a80f07C8c8eaF7A1bc040";

      const client = createPublicClient({ chain: baseSepolia, transport: http() });

      // Sort currencies (currency0 < currency1 by address)
      const [token0, token1] = USDC_ADDR.toLowerCase() < WETH_ADDR.toLowerCase()
        ? [USDC_ADDR, WETH_ADDR] : [WETH_ADDR, USDC_ADDR];

      // Compute PoolId = keccak256(abi.encode(PoolKey))
      const { encodeAbiParameters } = await import("viem");
      const poolId = keccak256(
        encodeAbiParameters(
          [
            { type: "address" }, // currency0
            { type: "address" }, // currency1
            { type: "uint24" },  // fee
            { type: "int24" },   // tickSpacing
            { type: "address" }, // hooks
          ],
          [token0 as `0x${string}`, token1 as `0x${string}`, 3000, 60, hookAddress as `0x${string}`]
        )
      );

      // Read pool state via StateView or PoolManager getSlot0
      // Use PoolManager.extsload to read pool state
      // Slot0 is stored at keccak256(poolId . POOLS_SLOT)
      // POOLS_SLOT = 6 for Uniswap v4 PoolManager
      const poolsSlot = keccak256(
        encodePacked(["bytes32", "uint256"], [poolId, BigInt(6)])
      );

      // Read 4 slots starting from poolsSlot (sqrtPriceX96+tick in slot0, then liquidity)
      const pmAbi = parseAbi([
        "function extsload(bytes32 slot) view returns (bytes32)",
      ]);

      // Slot 0: sqrtPriceX96 (160 bits) + tick (24 bits) + protocolFee (24 bits)
      const slot0Raw = await client.readContract({
        address: POOL_MANAGER as `0x${string}`,
        abi: pmAbi,
        functionName: "extsload",
        args: [poolsSlot],
      });

      // Parse slot0: sqrtPriceX96 is in lower 160 bits
      const slot0BigInt = BigInt(slot0Raw);
      const sqrtPriceX96 = slot0BigInt & ((BigInt(1) << BigInt(160)) - BigInt(1));
      // tick is in bits 160-183 (24 bits, signed)
      const tickRaw = Number((slot0BigInt >> BigInt(160)) & BigInt(0xFFFFFF));
      const tick = tickRaw >= 0x800000 ? tickRaw - 0x1000000 : tickRaw;

      // Slot 3 (offset +3): liquidity
      const liquiditySlot = BigInt(poolsSlot) + BigInt(3);
      const liquiditySlotHex = ("0x" + liquiditySlot.toString(16).padStart(64, "0")) as `0x${string}`;
      const liquidityRaw = await client.readContract({
        address: POOL_MANAGER as `0x${string}`,
        abi: pmAbi,
        functionName: "extsload",
        args: [liquiditySlotHex],
      });
      const liquidity = BigInt(liquidityRaw) & ((BigInt(1) << BigInt(128)) - BigInt(1));

      // Compute human-readable price from sqrtPriceX96
      // price = (sqrtPriceX96 / 2^96)^2
      const Q96 = BigInt(1) << BigInt(96);
      const priceRatio = Number(sqrtPriceX96) / Number(Q96);
      const price = priceRatio * priceRatio;

      return JSON.stringify({
        poolId,
        token0,
        token1,
        fee: 3000,
        tickSpacing: 60,
        hook: hookAddress,
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick,
        liquidity: liquidity.toString(),
        priceRatio: price.toFixed(8),
        analysis: sqrtPriceX96 === BigInt(0)
          ? "Pool has not been initialized yet (sqrtPriceX96 = 0)."
          : `Pool is active. Current tick: ${tick}, liquidity: ${liquidity.toString()}. The pool uses a 0.30% fee tier with 60-tick spacing.`,
      }, null, 2);
    }
    case "get_swap_activity": {
      const { createPublicClient, http, parseAbi } = await import("viem");
      const { baseSepolia } = await import("viem/chains");

      const hookAddress = (process.env.SETTLEMENT_HOOK_ADDRESS ??
        "0x0cD33a7a876AF045e49a80f07C8c8eaF7A1bc040") as `0x${string}`;

      const client = createPublicClient({ chain: baseSepolia, transport: http() });

      const hookAbi = parseAbi([
        "function totalSwapsTracked() view returns (uint256)",
        "function accumulatedBalance() view returns (uint256)",
        "function settlementThreshold() view returns (uint256)",
        "function totalSettled() view returns (uint256)",
        "function settlementCount() view returns (uint256)",
      ]);

      const [totalSwaps, accumulated, threshold, totalSettled, settlementCt] = await Promise.all([
        client.readContract({ address: hookAddress, abi: hookAbi, functionName: "totalSwapsTracked" }),
        client.readContract({ address: hookAddress, abi: hookAbi, functionName: "accumulatedBalance" }),
        client.readContract({ address: hookAddress, abi: hookAbi, functionName: "settlementThreshold" }),
        client.readContract({ address: hookAddress, abi: hookAbi, functionName: "totalSettled" }),
        client.readContract({ address: hookAddress, abi: hookAbi, functionName: "settlementCount" }),
      ]);

      const accUsdc = (Number(accumulated) / 1_000_000).toFixed(4);
      const threshUsdc = (Number(threshold) / 1_000_000).toFixed(4);
      const settledUsdc = (Number(totalSettled) / 1_000_000).toFixed(4);
      const readyToSettle = Number(accumulated) >= Number(threshold);

      return JSON.stringify({
        hookAddress,
        totalSwapsTracked: Number(totalSwaps),
        accumulatedBalance: accUsdc,
        accumulatedBalanceRaw: accumulated.toString(),
        settlementThreshold: threshUsdc,
        settlementThresholdRaw: threshold.toString(),
        totalSettled: settledUsdc,
        settlementCount: Number(settlementCt),
        readyToSettle,
        analysis: `Hook has tracked ${totalSwaps} swaps. Accumulated: $${accUsdc} USDC (threshold: $${threshUsdc}). ${Number(settlementCt)} settlements completed totaling $${settledUsdc} USDC.${readyToSettle ? " Ready to settle now!" : ""}`,
      }, null, 2);
    }
    case "adjust_settlement_policy": {
      const { createPublicClient, createWalletClient, http, parseAbi } = await import("viem");
      const { baseSepolia } = await import("viem/chains");
      const { privateKeyToAccount } = await import("viem/accounts");

      const hookAddress = (process.env.SETTLEMENT_HOOK_ADDRESS ??
        "0x0cD33a7a876AF045e49a80f07C8c8eaF7A1bc040") as `0x${string}`;

      const newThresholdUsdc = args.new_threshold_usdc as number;
      const reason = (args.reason as string) || "User-requested threshold adjustment";

      // Convert USDC to 6-decimal raw
      const newThresholdRaw = BigInt(Math.round(newThresholdUsdc * 1_000_000));

      // Minimum check (0.01 USDC = 10000 raw)
      if (newThresholdRaw < BigInt(10000)) {
        return JSON.stringify({ error: "Threshold too low. Minimum is $0.01 USDC (10000 raw units)." });
      }

      const agentPk = process.env.AGENT_PRIVATE_KEY as `0x${string}`;
      const account = privateKeyToAccount(agentPk);

      // Read current threshold first
      const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
      const hookAbi = parseAbi([
        "function settlementThreshold() view returns (uint256)",
        "function setSettlementThreshold(uint256 newThreshold)",
      ]);
      const oldThresholdRaw = await publicClient.readContract({
        address: hookAddress,
        abi: hookAbi,
        functionName: "settlementThreshold",
      });
      const oldThresholdUsdc = (Number(oldThresholdRaw) / 1_000_000).toFixed(4);

      // Send the transaction
      const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(),
      });

      const txHash = await walletClient.writeContract({
        address: hookAddress,
        abi: hookAbi,
        functionName: "setSettlementThreshold",
        args: [newThresholdRaw],
      });

      return JSON.stringify({
        success: true,
        transactionHash: txHash,
        oldThreshold: `$${oldThresholdUsdc} USDC`,
        newThreshold: `$${newThresholdUsdc.toFixed(4)} USDC`,
        reason,
        analysis: `Settlement threshold updated from $${oldThresholdUsdc} to $${newThresholdUsdc.toFixed(4)} USDC. Reason: ${reason}. Tx: ${txHash}`,
      }, null, 2);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

async function callOpenRouter(messages: ChatMessage[]) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${text}`);
  }

  return res.json();
}

export async function runDefiAgent(query: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: query },
  ];

  const MAX_ITERATIONS = 5;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const data = await callOpenRouter(messages);
    const choice = data.choices?.[0];

    if (!choice) {
      return "No response generated.";
    }

    const message = choice.message;
    const finishReason = choice.finish_reason;

    // If the model wants to call tools
    if (finishReason === "tool_calls" || message.tool_calls?.length) {
      // Add the assistant message with tool_calls
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      // Execute each tool call and add results
      for (const toolCall of message.tool_calls) {
        let result: string;
        try {
          const args = JSON.parse(toolCall.function.arguments);
          result = await executeTool(toolCall.function.name, args);
        } catch (err) {
          result = JSON.stringify({
            error:
              err instanceof Error ? err.message : "Tool execution failed",
          });
        }
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      continue;
    }

    // Done — return the text
    return message.content || "No response generated.";
  }

  return "Max tool iterations reached. Please try a simpler query.";
}
