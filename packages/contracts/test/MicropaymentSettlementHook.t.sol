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
        assertEq(hook.settlementThreshold(), SETTLEMENT_THRESHOLD);
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

    // ============ _settle() Counter Tests ============

    function test_depositMicropayment_autoSettleUpdatesCounters() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), SETTLEMENT_THRESHOLD);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD);
        hook.depositMicropayment(SETTLEMENT_THRESHOLD, keccak256("counter_auto"));

        assertEq(hook.settlementCount(), 1);
        assertEq(hook.totalSettled(), SETTLEMENT_THRESHOLD);
    }

    function test_settleNow_updatesCounters() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        uint256 amount = 500000; // 0.5 USDC
        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);
        hook.depositMicropayment(amount, keccak256("counter_manual"));

        vm.prank(AGENT_WALLET);
        hook.settleNow();

        assertEq(hook.settlementCount(), 1);
        assertEq(hook.totalSettled(), amount);
    }

    function test_multipleAutoSettlements_incrementCounters() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        // First auto-settle
        usdc.mint(address(this), SETTLEMENT_THRESHOLD);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD);
        hook.depositMicropayment(SETTLEMENT_THRESHOLD, keccak256("multi_1"));

        // Second auto-settle
        usdc.mint(address(this), SETTLEMENT_THRESHOLD);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD);
        hook.depositMicropayment(SETTLEMENT_THRESHOLD, keccak256("multi_2"));

        assertEq(hook.settlementCount(), 2);
        assertEq(hook.totalSettled(), SETTLEMENT_THRESHOLD * 2);
    }

    function test_setSettlementThreshold_autoSettleUpdatesCounters() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        // Deposit 0.5 USDC (below 1 USDC threshold)
        usdc.mint(address(this), 500000);
        usdc.approve(address(hook), 500000);
        hook.depositMicropayment(500000, keccak256("thresh_counter"));

        assertEq(hook.settlementCount(), 0);
        assertEq(hook.totalSettled(), 0);

        // Lower threshold to 0.25 USDC — triggers auto-settle
        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(250000);

        assertEq(hook.settlementCount(), 1);
        assertEq(hook.totalSettled(), 500000);
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

    // ============ recordSettlement Tests (audit-trail-only, no USDC transfer) ============

    function test_recordSettlement_updatesCounters() public {
        uint256 amount = 100000; // 0.10 USDC
        bytes32 queryId = keccak256("settlement_1");

        vm.prank(AGENT_WALLET);
        hook.recordSettlement(amount, queryId);

        assertEq(hook.totalSettled(), amount);
        assertEq(hook.settlementCount(), 1);
    }

    function test_recordSettlement_emitsEvent() public {
        uint256 amount = 50000;
        bytes32 queryId = keccak256("settlement_event");

        vm.prank(AGENT_WALLET);
        vm.expectEmit(true, true, false, true);
        emit MicropaymentSettlementHook.SettlementRecorded(AGENT_WALLET, amount, queryId, 1);
        hook.recordSettlement(amount, queryId);
    }

    function test_recordSettlement_transfersFromReserve() public {
        uint256 amount = 100000;
        bytes32 queryId = keccak256("transfer_test");

        // Fund the hook with a USDC reserve
        usdc.mint(address(hook), 500000);

        uint256 agentBefore = usdc.balanceOf(AGENT_WALLET);
        uint256 hookBefore = usdc.balanceOf(address(hook));

        vm.prank(AGENT_WALLET);
        hook.recordSettlement(amount, queryId);

        assertEq(usdc.balanceOf(AGENT_WALLET), agentBefore + amount);
        assertEq(usdc.balanceOf(address(hook)), hookBefore - amount);
    }

    function test_recordSettlement_skipsTransferIfNoReserve() public {
        uint256 amount = 100000;
        bytes32 queryId = keccak256("no_reserve");

        // No USDC in hook — should still record but not transfer
        uint256 agentBefore = usdc.balanceOf(AGENT_WALLET);

        vm.prank(AGENT_WALLET);
        hook.recordSettlement(amount, queryId);

        // Counters still updated
        assertEq(hook.totalSettled(), amount);
        assertEq(hook.settlementCount(), 1);
        // No transfer happened
        assertEq(usdc.balanceOf(AGENT_WALLET), agentBefore);
    }

    function test_recordSettlement_doesNotAffectAccumulatedBalance() public {
        uint256 amount = 100000;
        bytes32 queryId = keccak256("no_accumulate");

        usdc.mint(address(hook), amount);

        vm.prank(AGENT_WALLET);
        hook.recordSettlement(amount, queryId);

        assertEq(hook.accumulatedBalance(), 0);
    }

    function test_recordSettlement_multipleRecords() public {
        usdc.mint(address(hook), 500000);

        vm.startPrank(AGENT_WALLET);
        hook.recordSettlement(50000, keccak256("batch_1"));
        hook.recordSettlement(75000, keccak256("batch_2"));
        hook.recordSettlement(25000, keccak256("batch_3"));
        vm.stopPrank();

        assertEq(hook.totalSettled(), 150000);
        assertEq(hook.settlementCount(), 3);
        assertEq(usdc.balanceOf(AGENT_WALLET), 150000);
    }

    function test_recordSettlement_revertsIfNotAgent() public {
        vm.prank(unauthorized);
        vm.expectRevert(MicropaymentSettlementHook.OnlyAgentCanSettle.selector);
        hook.recordSettlement(100000, keccak256("unauth"));
    }

    function test_recordSettlement_rejectsBelowMinimum() public {
        vm.prank(AGENT_WALLET);
        vm.expectRevert(MicropaymentSettlementHook.AmountTooSmall.selector);
        hook.recordSettlement(MIN_DEPOSIT - 1, keccak256("dust"));
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

    // ============ setSettlementThreshold Tests ============

    function test_setSettlementThreshold_updatesCorrectly() public {
        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(500000); // 0.50 USDC

        assertEq(hook.settlementThreshold(), 500000);
    }

    function test_setSettlementThreshold_emitsEvent() public {
        vm.prank(AGENT_WALLET);
        vm.expectEmit(false, false, false, true);
        emit MicropaymentSettlementHook.ThresholdUpdated(SETTLEMENT_THRESHOLD, 500000);
        hook.setSettlementThreshold(500000);
    }

    function test_setSettlementThreshold_revertsIfNotAgent() public {
        vm.prank(unauthorized);
        vm.expectRevert(MicropaymentSettlementHook.OnlyAgentCanManage.selector);
        hook.setSettlementThreshold(500000);
    }

    function test_setSettlementThreshold_revertsIfBelowMinimum() public {
        vm.prank(AGENT_WALLET);
        vm.expectRevert(MicropaymentSettlementHook.ThresholdTooLow.selector);
        hook.setSettlementThreshold(9999); // Below MIN_THRESHOLD (10000)
    }

    function test_setSettlementThreshold_autoSettlesWhenLowered() public {
        // Deposit 0.5 USDC (below current 1 USDC threshold)
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 500000);
        usdc.approve(address(hook), 500000);
        hook.depositMicropayment(500000, keccak256("pre_threshold"));

        assertEq(hook.accumulatedBalance(), 500000);
        assertEq(usdc.balanceOf(AGENT_WALLET), 0);

        // Lower threshold to 0.25 USDC — should auto-settle the 0.5 USDC
        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(250000);

        assertEq(hook.accumulatedBalance(), 0);
        assertEq(usdc.balanceOf(AGENT_WALLET), 500000);
    }

    // ============ Hook Permissions Tests ============

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
