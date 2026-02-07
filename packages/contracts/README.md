# QueryFi Smart Contracts

Micropayment settlement hooks for the QueryFi pay-per-query DeFi analytics agent. Two contracts handle on-chain settlement of off-chain micropayments accumulated via Yellow Network state channels.

## Contracts

### MicropaymentSettlementHook (Base Sepolia)

Uniswap v4 `BaseHook` with `afterSwap` permission. Accumulates USDC micropayments via `depositMicropayment()` and auto-settles to the agent wallet at the 1 USDC threshold. The `afterSwap` callback tracks swap counts per pool. Supports off-chain settlement recording via `recordSettlement()` for audit trails.

Deployed via HookMiner CREATE2 to derive an address with the correct v4 flag bits.

| Item | Value |
|------|-------|
| Address | [`0xe0d92A5e1D733517aa8b4b5Cf4A874722b30C040`](https://sepolia.basescan.org/address/0xe0d92A5e1D733517aa8b4b5Cf4A874722b30C040) |
| Pool | USDC/WETH, 3000 bps fee, tick spacing 60 |
| PoolManager | [`0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`](https://sepolia.basescan.org/address/0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408) |

### ArcSettlementHook (Arc Testnet)

Standalone micropayment settlement for Circle's Arc chain. Same core logic (accumulate, threshold, auto-settle) without DEX dependencies. Adds configurable thresholds via `setSettlementThreshold()` for dynamic payout policy.

| Item | Value |
|------|-------|
| Address | [`0xE8FE7028671C26f9A0843d5c24B0019bfa8d5A00`](https://testnet.arcscan.app/address/0xE8FE7028671C26f9A0843d5c24B0019bfa8d5A00) |
| USDC | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |

## Build & Test

```bash
forge install
forge build
forge test -vvv
```

86 tests (38 MicropaymentSettlementHook + 48 ArcSettlementHook) including fuzz tests.

## Deploy

```bash
# Base Sepolia
forge script script/DeployHook.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast

# Initialize pool
forge script script/InitPool.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast

# Arc Testnet
forge script script/DeployArcHook.s.sol --rpc-url $ARC_RPC --broadcast
```
