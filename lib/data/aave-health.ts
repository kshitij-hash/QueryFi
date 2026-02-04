import { createPublicClient, http, formatUnits, isAddress } from "viem";
import { mainnet } from "viem/chains";

const AAVE_V3_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as const;

const POOL_ABI = [
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserAccountData",
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface HealthFactorResult {
  healthFactor: number;
  totalCollateral: number;
  totalDebt: number;
  ltv: number;
  availableBorrows: number;
}

function getClient() {
  const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  const rpcUrl = alchemyKey
    ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
    : "https://eth.drpc.org";

  return createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });
}

export async function getHealthFactor(
  addressOrEns: string
): Promise<HealthFactorResult> {
  const client = getClient();

  let address: `0x${string}`;
  if (addressOrEns.endsWith(".eth")) {
    const resolved = await client.getEnsAddress({ name: addressOrEns });
    if (!resolved) {
      throw new Error(`Could not resolve ENS name: ${addressOrEns}`);
    }
    address = resolved;
  } else if (isAddress(addressOrEns)) {
    address = addressOrEns as `0x${string}`;
  } else {
    throw new Error(
      `Invalid address or ENS name: ${addressOrEns}`
    );
  }

  const result = await client.readContract({
    address: AAVE_V3_POOL,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: [address],
  });

  const [
    totalCollateralBase,
    totalDebtBase,
    availableBorrowsBase,
    ,
    ltv,
    healthFactor,
  ] = result;

  return {
    healthFactor: parseFloat(formatUnits(healthFactor, 18)),
    totalCollateral: parseFloat(formatUnits(totalCollateralBase, 8)),
    totalDebt: parseFloat(formatUnits(totalDebtBase, 8)),
    ltv: Number(ltv) / 100,
    availableBorrows: parseFloat(formatUnits(availableBorrowsBase, 8)),
  };
}
