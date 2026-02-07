// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

import {MicropaymentSettlementHook} from "../src/MicropaymentSettlementHook.sol";

/// @title TestSettlement
/// @notice Verifies on-chain state of the deployed hook and runs settlement E2E if authorized.
///         If the deployer is not authorized, it reports the on-chain state for manual verification.
contract TestSettlement is Script {
    // Deployed hook
    address constant HOOK = 0xe0d92A5e1D733517aa8b4b5Cf4A874722b30C040;

    // Base Sepolia USDC
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        MicropaymentSettlementHook hook = MicropaymentSettlementHook(HOOK);

        console.log("=== Hook On-Chain State ===");
        console.log("Hook address:", HOOK);
        console.log("Agent wallet:", hook.agentWallet());
        console.log("USDC token:", hook.usdc());
        console.log("Settlement threshold:", hook.SETTLEMENT_THRESHOLD());
        console.log("Min deposit:", hook.MIN_DEPOSIT());
        console.log("Accumulated balance:", hook.accumulatedBalance());
        console.log("Total swaps tracked:", hook.totalSwapsTracked());

        // Balances
        uint256 agentUsdc = IERC20(USDC).balanceOf(hook.agentWallet());
        uint256 hookUsdc = IERC20(USDC).balanceOf(HOOK);
        uint256 deployerUsdc = IERC20(USDC).balanceOf(deployer);
        console.log("");
        console.log("=== USDC Balances ===");
        console.log("Agent wallet USDC:", agentUsdc);
        console.log("Hook contract USDC:", hookUsdc);
        console.log("Deployer USDC:", deployerUsdc);

        // PoolManager check
        address pm = address(hook.poolManager());
        console.log("");
        console.log("=== Pool Manager ===");
        console.log("PoolManager:", pm);

        // Check authorization
        bool deployerAuth = hook.isAuthorizedPayer(deployer);
        bool agentAuth = hook.isAuthorizedPayer(hook.agentWallet());
        console.log("");
        console.log("=== Authorization ===");
        console.log("Deployer authorized:", deployerAuth);
        console.log("Agent authorized:", agentAuth);

        // If deployer is the agent wallet, run full E2E test
        if (deployer == hook.agentWallet()) {
            console.log("");
            console.log("=== Running Full E2E Test ===");
            _runSettlementTest(hook, deployer, deployerPrivateKey, deployerUsdc);
        } else if (deployerAuth && deployerUsdc >= hook.MIN_DEPOSIT()) {
            console.log("");
            console.log("=== Running Authorized Payer Test ===");
            _runSettlementTest(hook, deployer, deployerPrivateKey, deployerUsdc);
        } else {
            console.log("");
            console.log("=== E2E Test Skipped ===");
            if (!deployerAuth) {
                console.log("Reason: Deployer not authorized. Agent wallet must call authorizePayer().");
                console.log("The settlement-service.ts uses Circle API to call depositMicropayment().");
                console.log("Circle wallet (agent) is pre-authorized by constructor.");
            }
            if (deployerUsdc < hook.MIN_DEPOSIT()) {
                console.log("Reason: Deployer has insufficient USDC.");
            }
        }
    }

    function _runSettlementTest(
        MicropaymentSettlementHook hook,
        address deployer,
        uint256 deployerPrivateKey,
        uint256 deployerUsdc
    ) internal {
        uint256 agentUsdcBefore = IERC20(USDC).balanceOf(hook.agentWallet());

        // Use 1 USDC (at threshold) if enough, otherwise use what's available
        uint256 depositAmount = 1_000_000;
        if (deployerUsdc < depositAmount) {
            depositAmount = deployerUsdc;
        }

        vm.startBroadcast(deployerPrivateKey);
        IERC20(USDC).approve(HOOK, depositAmount);
        hook.depositMicropayment(depositAmount, keccak256("e2e_test"));
        vm.stopBroadcast();

        uint256 hookBalanceAfter = hook.accumulatedBalance();
        uint256 agentUsdcAfter = IERC20(USDC).balanceOf(hook.agentWallet());

        console.log("Deposited:", depositAmount);
        console.log("Hook accumulated after:", hookBalanceAfter);
        console.log("Agent USDC after:", agentUsdcAfter);

        if (depositAmount >= hook.SETTLEMENT_THRESHOLD()) {
            if (hookBalanceAfter == 0 && agentUsdcAfter > agentUsdcBefore) {
                console.log("RESULT: Auto-settlement SUCCESS");
            } else {
                console.log("RESULT: Unexpected state after deposit");
            }
        } else {
            console.log("RESULT: Payment accumulated (below threshold)");
        }
    }
}
