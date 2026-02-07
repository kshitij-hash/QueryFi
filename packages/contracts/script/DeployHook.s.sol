// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/src/utils/HookMiner.sol";

import {MicropaymentSettlementHook} from "../src/MicropaymentSettlementHook.sol";

/// @title DeployHook
/// @notice Deployment script for MicropaymentSettlementHook on Base Sepolia
contract DeployHook is Script {
    // Base Sepolia PoolManager (Uniswap v4)
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    // CREATE2 deterministic deployer
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Base Sepolia USDC
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Agent Wallet on Base Sepolia (direct key for reliable on-chain settlement)
    address constant AGENT_WALLET = 0x0E5C53F6838A0333895E4cFe48f721Bea806D266;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer address:", deployer);
        console.log("Pool Manager:", POOL_MANAGER);
        console.log("Agent Wallet:", AGENT_WALLET);
        console.log("USDC:", USDC);

        // Mine salt for correct hook address (AFTER_SWAP_FLAG set in low bits)
        uint160 flags = uint160(Hooks.AFTER_SWAP_FLAG);
        bytes memory creationCode = type(MicropaymentSettlementHook).creationCode;
        bytes memory constructorArgs = abi.encode(IPoolManager(POOL_MANAGER), AGENT_WALLET, USDC);

        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, creationCode, constructorArgs);

        console.log("Computed hook address:", hookAddress);

        vm.startBroadcast(deployerPrivateKey);

        MicropaymentSettlementHook hook =
            new MicropaymentSettlementHook{salt: salt}(IPoolManager(POOL_MANAGER), AGENT_WALLET, USDC);

        vm.stopBroadcast();

        require(address(hook) == hookAddress, "Hook address mismatch");

        console.log("Hook deployed at:", address(hook));
        console.log("Agent wallet:", hook.agentWallet());
        console.log("USDC address:", hook.usdc());
        console.log("Settlement threshold:", hook.settlementThreshold());
    }
}
