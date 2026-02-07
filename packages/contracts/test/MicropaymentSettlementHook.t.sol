// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {MicropaymentSettlementHook} from "../src/MicropaymentSettlementHook.sol";

contract MicropaymentSettlementHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    MicropaymentSettlementHook hook;

    address constant AGENT_WALLET = address(0x1234567890123456789012345678901234567890);
    uint256 constant SETTLEMENT_THRESHOLD = 1e6; // 1 USDC (6 decimals)
    uint256 constant MIN_DEPOSIT = 1000; // 0.001 USDC

    MockERC20 usdc;

    // Pool with the hook
    PoolKey poolKey;
    PoolId poolId;

    // Test addresses
    address payer1 = address(0x1111111111111111111111111111111111111111);
    address payer2 = address(0x2222222222222222222222222222222222222222);
    address unauthorized = address(0xbAd0000000000000000000000000000000000000);

    function setUp() public {
        // Deploy fresh PoolManager and all routers
        deployFreshManagerAndRouters();

        // Deploy USDC mock (used for micropayment tests, separate from pool currencies)
        usdc = new MockERC20("USD Coin", "USDC", 6);

        // Compute hook address with AFTER_SWAP_FLAG
        uint160 flags = uint160(Hooks.AFTER_SWAP_FLAG);
        address hookAddress = address(flags);

        // Deploy hook to the flag-encoded address using deployCodeTo
        deployCodeTo(
            "MicropaymentSettlementHook.sol",
            abi.encode(manager, AGENT_WALLET, address(usdc)),
            hookAddress
        );
        hook = MicropaymentSettlementHook(hookAddress);

        // Deploy and approve two test currencies for pool operations
        deployMintAndApprove2Currencies();

        // Initialize a pool with the hook
        (poolKey, poolId) = initPool(currency0, currency1, IHooks(hookAddress), 3000, SQRT_PRICE_1_1);

        // Add liquidity so swaps can occur
        modifyLiquidityRouter.modifyLiquidity(poolKey, LIQUIDITY_PARAMS, ZERO_BYTES);
    }

    // ============ Constructor Tests ============

    function test_constructor_setsAgentWallet() public view {
        assertEq(hook.agentWallet(), AGENT_WALLET);
    }

    function test_constructor_setsUsdcAddress() public view {
        assertEq(hook.usdc(), address(usdc));
    }

    function test_constructor_setsThreshold() public view {
        assertEq(hook.SETTLEMENT_THRESHOLD(), SETTLEMENT_THRESHOLD);
    }

    function test_constructor_authorizesAgentByDefault() public view {
        assertTrue(hook.isAuthorizedPayer(AGENT_WALLET));
    }

    // ============ Authorization Tests ============

    function test_authorizePayer_addsNewPayer() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(payer1);

        assertTrue(hook.isAuthorizedPayer(payer1));
    }

    function test_authorizePayer_emitsEvent() public {
        vm.prank(AGENT_WALLET);
        vm.expectEmit(true, false, false, false);
        emit MicropaymentSettlementHook.PayerAuthorized(payer1);
        hook.authorizePayer(payer1);
    }

    function test_authorizePayer_revertsIfNotAgent() public {
        vm.prank(unauthorized);
        vm.expectRevert(MicropaymentSettlementHook.OnlyAgentCanManage.selector);
        hook.authorizePayer(payer1);
    }

    function test_authorizePayer_revertsIfZeroAddress() public {
        vm.prank(AGENT_WALLET);
        vm.expectRevert(MicropaymentSettlementHook.InvalidAgentWallet.selector);
        hook.authorizePayer(address(0));
    }

    function test_authorizePayer_revertsIfAlreadyAuthorized() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(payer1);

        vm.prank(AGENT_WALLET);
        vm.expectRevert(MicropaymentSettlementHook.PayerAlreadyAuthorized.selector);
        hook.authorizePayer(payer1);
    }

    function test_revokePayer_removesPayer() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(payer1);
        assertTrue(hook.isAuthorizedPayer(payer1));

        vm.prank(AGENT_WALLET);
        hook.revokePayer(payer1);
        assertFalse(hook.isAuthorizedPayer(payer1));
    }

    function test_revokePayer_emitsEvent() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(payer1);

        vm.prank(AGENT_WALLET);
        vm.expectEmit(true, false, false, false);
        emit MicropaymentSettlementHook.PayerRevoked(payer1);
        hook.revokePayer(payer1);
    }

    function test_revokePayer_revertsIfNotAgent() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(payer1);

        vm.prank(unauthorized);
        vm.expectRevert(MicropaymentSettlementHook.OnlyAgentCanManage.selector);
        hook.revokePayer(payer1);
    }

    function test_revokePayer_revertsIfNotAuthorized() public {
        vm.prank(AGENT_WALLET);
        vm.expectRevert(MicropaymentSettlementHook.PayerNotFound.selector);
        hook.revokePayer(payer1);
    }

    // ============ depositMicropayment Tests ============

    function test_depositMicropayment_updatesBalance() public {
        uint256 amount = 100000; // 0.10 USDC
        bytes32 queryId = keccak256("query_1");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);

        hook.depositMicropayment(amount, queryId);

        assertEq(hook.accumulatedBalance(), amount);
    }

    function test_depositMicropayment_transfersTokens() public {
        uint256 amount = 100000; // 0.10 USDC
        bytes32 queryId = keccak256("query_1");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);

        uint256 hookBalanceBefore = usdc.balanceOf(address(hook));
        hook.depositMicropayment(amount, queryId);
        uint256 hookBalanceAfter = usdc.balanceOf(address(hook));

        assertEq(hookBalanceAfter - hookBalanceBefore, amount);
    }

    function test_depositMicropayment_emitsEvent() public {
        uint256 amount = 100000;
        bytes32 queryId = keccak256("query_1");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);

        vm.expectEmit(true, true, false, true);
        emit MicropaymentSettlementHook.MicropaymentReceived(address(this), amount, queryId);

        hook.depositMicropayment(amount, queryId);
    }

    function test_depositMicropayment_multipleDeposits() public {
        bytes32 queryId1 = keccak256("query_1");
        bytes32 queryId2 = keccak256("query_2");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 200000);
        usdc.approve(address(hook), 200000);

        hook.depositMicropayment(50000, queryId1);
        hook.depositMicropayment(150000, queryId2);

        assertEq(hook.accumulatedBalance(), 200000);
    }

    function test_depositMicropayment_revertsIfUnauthorized() public {
        uint256 amount = 100000;
        bytes32 queryId = keccak256("query_unauth");

        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);

        vm.expectRevert(MicropaymentSettlementHook.PayerNotAuthorized.selector);
        hook.depositMicropayment(amount, queryId);
    }

    function test_depositMicropayment_rejectsZeroAmount() public {
        bytes32 queryId = keccak256("query_zero");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        vm.expectRevert(MicropaymentSettlementHook.AmountTooSmall.selector);
        hook.depositMicropayment(0, queryId);
    }

    function test_depositMicropayment_rejectsBelowMinimum() public {
        bytes32 queryId = keccak256("query_dust");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), MIN_DEPOSIT - 1);
        usdc.approve(address(hook), MIN_DEPOSIT - 1);

        vm.expectRevert(MicropaymentSettlementHook.AmountTooSmall.selector);
        hook.depositMicropayment(MIN_DEPOSIT - 1, queryId);
    }

    function test_depositMicropayment_acceptsMinimumAmount() public {
        bytes32 queryId = keccak256("query_min");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), MIN_DEPOSIT);
        usdc.approve(address(hook), MIN_DEPOSIT);

        hook.depositMicropayment(MIN_DEPOSIT, queryId);
        assertEq(hook.accumulatedBalance(), MIN_DEPOSIT);
    }

    // ============ Auto-Settlement Tests ============

    function test_depositMicropayment_autoSettlesAtThreshold() public {
        bytes32 queryId = keccak256("query_settlement");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), SETTLEMENT_THRESHOLD);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD);

        hook.depositMicropayment(SETTLEMENT_THRESHOLD, queryId);

        assertEq(usdc.balanceOf(AGENT_WALLET), SETTLEMENT_THRESHOLD);
        assertEq(hook.accumulatedBalance(), 0);
    }

    function test_depositMicropayment_autoSettlesAboveThreshold() public {
        bytes32 queryId = keccak256("query_big");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        uint256 amount = SETTLEMENT_THRESHOLD + 500000; // 1.5 USDC
        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);

        hook.depositMicropayment(amount, queryId);

        assertEq(usdc.balanceOf(AGENT_WALLET), amount);
        assertEq(hook.accumulatedBalance(), 0);
    }

    function test_depositMicropayment_emitsSettlementEvent() public {
        bytes32 queryId = keccak256("query_settle");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), SETTLEMENT_THRESHOLD);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD);

        vm.expectEmit(true, false, false, true);
        emit MicropaymentSettlementHook.SettlementExecuted(AGENT_WALLET, SETTLEMENT_THRESHOLD);

        hook.depositMicropayment(SETTLEMENT_THRESHOLD, queryId);
    }

    function test_depositMicropayment_accumulatesMultipleBeforeSettlement() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 500000);
        usdc.approve(address(hook), 500000);
        hook.depositMicropayment(500000, keccak256("query_1"));

        assertEq(hook.accumulatedBalance(), 500000);
        assertEq(usdc.balanceOf(AGENT_WALLET), 0);

        usdc.mint(address(this), 600000);
        usdc.approve(address(hook), 600000);
        hook.depositMicropayment(600000, keccak256("query_2"));

        assertEq(hook.accumulatedBalance(), 0);
        assertEq(usdc.balanceOf(AGENT_WALLET), 1100000);
    }

    // ============ Manual Settlement Tests ============

    function test_settleNow_transfersToAgent() public {
        bytes32 queryId = keccak256("query_manual");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        uint256 amount = 500000; // 0.5 USDC
        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);
        hook.depositMicropayment(amount, queryId);

        vm.prank(AGENT_WALLET);
        hook.settleNow();

        assertEq(usdc.balanceOf(AGENT_WALLET), amount);
        assertEq(hook.accumulatedBalance(), 0);
    }

    function test_settleNow_onlyAgent() public {
        bytes32 queryId = keccak256("query_auth");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 100000);
        usdc.approve(address(hook), 100000);
        hook.depositMicropayment(100000, queryId);

        vm.prank(unauthorized);
        vm.expectRevert(MicropaymentSettlementHook.OnlyAgentCanSettle.selector);
        hook.settleNow();
    }

    function test_settleNow_noBalanceDoesNothing() public {
        vm.prank(AGENT_WALLET);
        hook.settleNow();

        assertEq(usdc.balanceOf(AGENT_WALLET), 0);
    }

    function test_settleNow_emitsEvent() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 500000);
        usdc.approve(address(hook), 500000);
        hook.depositMicropayment(500000, keccak256("query"));

        vm.prank(AGENT_WALLET);
        vm.expectEmit(true, false, false, true);
        emit MicropaymentSettlementHook.SettlementExecuted(AGENT_WALLET, 500000);
        hook.settleNow();
    }

    // ============ getAgentBalance Tests ============

    function test_getAgentBalance_returnsAccumulated() public {
        bytes32 queryId = keccak256("query_balance");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 300000);
        usdc.approve(address(hook), 300000);
        hook.depositMicropayment(300000, queryId);

        assertEq(hook.getAgentBalance(), 300000);
    }

    function test_getAgentBalance_returnsZeroInitially() public view {
        assertEq(hook.getAgentBalance(), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_depositMicropayment(uint256 amount) public {
        amount = bound(amount, MIN_DEPOSIT, SETTLEMENT_THRESHOLD - 1);

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);

        hook.depositMicropayment(amount, keccak256("fuzz_query"));

        assertEq(hook.accumulatedBalance(), amount);
    }

    function testFuzz_multiplePayersDeposit(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, MIN_DEPOSIT, 400000);
        amount2 = bound(amount2, MIN_DEPOSIT, 400000);

        vm.startPrank(AGENT_WALLET);
        hook.authorizePayer(payer1);
        hook.authorizePayer(payer2);
        vm.stopPrank();

        usdc.mint(payer1, amount1);
        usdc.mint(payer2, amount2);

        vm.prank(payer1);
        usdc.approve(address(hook), amount1);
        vm.prank(payer1);
        hook.depositMicropayment(amount1, keccak256("payer1_query"));

        vm.prank(payer2);
        usdc.approve(address(hook), amount2);
        vm.prank(payer2);
        hook.depositMicropayment(amount2, keccak256("payer2_query"));

        assertEq(hook.accumulatedBalance(), amount1 + amount2);
    }

    // ============ afterSwap Hook Tests ============

    function test_afterSwap_incrementsTotalSwapsTracked() public {
        assertEq(hook.totalSwapsTracked(), 0);

        // Perform a swap (exact input, zeroForOne)
        swap(poolKey, true, -100, ZERO_BYTES);

        assertEq(hook.totalSwapsTracked(), 1);
    }

    function test_afterSwap_incrementsPoolSwapCount() public {
        assertEq(hook.poolSwapCount(poolId), 0);

        swap(poolKey, true, -100, ZERO_BYTES);

        assertEq(hook.poolSwapCount(poolId), 1);
    }

    function test_afterSwap_multipleSwapsIncrement() public {
        swap(poolKey, true, -100, ZERO_BYTES);
        swap(poolKey, false, -100, ZERO_BYTES);
        swap(poolKey, true, -100, ZERO_BYTES);

        assertEq(hook.totalSwapsTracked(), 3);
        assertEq(hook.poolSwapCount(poolId), 3);
    }

    function test_afterSwap_emitsSwapTrackedEvent() public {
        vm.expectEmit(true, false, false, true);
        emit MicropaymentSettlementHook.SwapTracked(poolId, address(swapRouter), 1);

        swap(poolKey, true, -100, ZERO_BYTES);
    }

    function test_getHookPermissions_onlyAfterSwap() public view {
        Hooks.Permissions memory perms = hook.getHookPermissions();

        assertFalse(perms.beforeInitialize);
        assertFalse(perms.afterInitialize);
        assertFalse(perms.beforeAddLiquidity);
        assertFalse(perms.afterAddLiquidity);
        assertFalse(perms.beforeRemoveLiquidity);
        assertFalse(perms.afterRemoveLiquidity);
        assertFalse(perms.beforeSwap);
        assertTrue(perms.afterSwap);
        assertFalse(perms.beforeDonate);
        assertFalse(perms.afterDonate);
        assertFalse(perms.beforeSwapReturnDelta);
        assertFalse(perms.afterSwapReturnDelta);
        assertFalse(perms.afterAddLiquidityReturnDelta);
        assertFalse(perms.afterRemoveLiquidityReturnDelta);
    }
}
