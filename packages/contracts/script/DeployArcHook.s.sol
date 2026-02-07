// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ArcSettlementHook} from "../src/ArcSettlementHook.sol";

/// @title DeployArcHook
/// @notice Deployment script for ArcSettlementHook on Arc testnet
/// @dev Deploy: forge script script/DeployArcHook.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
contract DeployArcHook is Script {
    // Arc testnet native USDC
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    // Circle Agent Wallet (same address across chains)
    address constant AGENT_WALLET = 0x7dF4f69D82fb5594481eC99ec34479034fF26D9D;

    // Default settlement threshold: 1 USDC (6 decimals)
    uint256 constant THRESHOLD = 1e6;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== Arc Testnet Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Agent Wallet:", AGENT_WALLET);
        console.log("USDC (Arc native):", ARC_USDC);
        console.log("Settlement threshold:", THRESHOLD);

        vm.startBroadcast(deployerPrivateKey);

        ArcSettlementHook hook = new ArcSettlementHook(AGENT_WALLET, ARC_USDC, THRESHOLD);

        vm.stopBroadcast();

        console.log("=== Deployment Complete ===");
        console.log("ArcSettlementHook deployed at:", address(hook));
        console.log("Agent wallet:", hook.agentWallet());
        console.log("USDC address:", hook.usdc());
        console.log("Settlement threshold:", hook.settlementThreshold());
        console.log("");
        console.log("Next steps:");
        console.log("1. Set ARC_SETTLEMENT_HOOK_ADDRESS in .env.local");
        console.log("2. Verify on https://testnet.arcscan.app");
    }
}
