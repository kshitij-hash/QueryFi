import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

function getClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    throw new Error(
      "Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET environment variables"
    );
  }

  return initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });
}

export async function getAgentWallet() {
  const walletId = process.env.CIRCLE_WALLET_ID;
  if (!walletId) {
    throw new Error("Missing CIRCLE_WALLET_ID environment variable");
  }

  const client = getClient();
  const response = await client.getWallet({ id: walletId });
  const wallet = response.data?.wallet;

  if (!wallet) {
    throw new Error("Wallet not found");
  }

  return {
    id: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
    state: wallet.state,
  };
}

export async function getAgentBalance() {
  const walletId = process.env.CIRCLE_WALLET_ID;
  if (!walletId) {
    throw new Error("Missing CIRCLE_WALLET_ID environment variable");
  }

  const client = getClient();
  const response = await client.getWalletTokenBalance({
    id: walletId,
    includeAll: true,
  });

  const tokenBalances = response.data?.tokenBalances ?? [];

  return tokenBalances.map((tb) => ({
    token: {
      symbol: tb.token?.symbol ?? "UNKNOWN",
      name: tb.token?.name ?? "Unknown Token",
    },
    amount: tb.amount ?? "0",
  }));
}

export async function withdrawToTreasury(amount: string) {
  const walletId = process.env.CIRCLE_WALLET_ID;
  const treasuryAddress = process.env.CIRCLE_TREASURY_ADDRESS;

  if (!walletId) {
    throw new Error("Missing CIRCLE_WALLET_ID environment variable");
  }
  if (!treasuryAddress) {
    throw new Error("Missing CIRCLE_TREASURY_ADDRESS environment variable");
  }

  const client = getClient();

  // USDC token ID on Base Sepolia (from Circle's token registry)
  const USDC_TOKEN_ID = "bdf128b4-827b-5267-8f9e-243694989b5f";

  const response = await client.createTransaction({
    walletId,
    amount: [amount],
    destinationAddress: treasuryAddress,
    tokenId: USDC_TOKEN_ID,
    fee: {
      type: "level",
      config: { feeLevel: "MEDIUM" },
    },
  });

  const tx = response.data;

  return {
    transactionId: tx?.id ?? null,
    state: tx?.state ?? "UNKNOWN",
    amount,
    destination: treasuryAddress,
  };
}

export async function executeContractCall(
  contractAddress: string,
  abiFunctionSignature: string,
  abiParameters: string[]
) {
  const walletId = process.env.CIRCLE_WALLET_ID;
  if (!walletId) {
    throw new Error("Missing CIRCLE_WALLET_ID environment variable");
  }

  const client = getClient();

  const response = await client.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: {
      type: "level",
      config: { feeLevel: "MEDIUM" },
    },
  });

  const tx = response.data;

  return {
    transactionId: tx?.id ?? null,
    state: tx?.state ?? "UNKNOWN",
    contractAddress,
    abiFunctionSignature,
  };
}
