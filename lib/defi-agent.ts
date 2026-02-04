import { searchYields } from "@/lib/data/defillama-yields";
import { getTokenPrice } from "@/lib/data/defillama-prices";
import { getHealthFactor } from "@/lib/data/aave-health";
import { calculateILFromPrices } from "@/lib/data/il-calculator";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `You are a DeFi analytics assistant. You help users find yield opportunities, check lending position health, calculate impermanent loss, and look up token prices.

Guidelines:
- Use the available tools to fetch live data before answering
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
      return JSON.stringify(result, null, 2);
    }
    case "calculate_impermanent_loss": {
      const result = calculateILFromPrices(
        args.entry_price as number,
        args.current_price as number
      );
      return JSON.stringify(result, null, 2);
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
