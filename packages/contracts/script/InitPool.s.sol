// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @title InitPool
/// @notice Initializes a pool on Base Sepolia with the MicropaymentSettlementHook
contract InitPool is Script {
    // Base Sepolia PoolManager (Uniswap v4)
    IPoolManager constant POOL_MANAGER = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);

    // Deployed hook address
    address constant HOOK = 0x0cD33a7a876AF045e49a80f07C8c8eaF7A1bc040;

    // Base Sepolia USDC
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Base Sepolia WETH (Uniswap canonical)
    address constant WETH = 0x4200000000000000000000000000000000000006;

    // 1:1 price (sqrtPriceX96)
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Sort currencies — currency0 must be the lower address
        (address token0, address token1) = USDC < WETH ? (USDC, WETH) : (WETH, USDC);

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000, // 0.30% fee tier
            tickSpacing: int24(60),
            hooks: IHooks(HOOK)
        });

        console.log("Initializing pool...");
        console.log("Token0:", token0);
        console.log("Token1:", token1);
        console.log("Hook:", HOOK);
        console.log("Fee: 3000 (0.30%)");

        vm.startBroadcast(deployerPrivateKey);
        int24 tick = POOL_MANAGER.initialize(poolKey, SQRT_PRICE_1_1);
        vm.stopBroadcast();

        console.log("Pool initialized at tick:", tick);
    }
}
