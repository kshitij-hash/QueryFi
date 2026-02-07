// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ArcSettlementHook} from "../src/ArcSettlementHook.sol";

contract ArcSettlementHookTest is Test {
    ArcSettlementHook hook;

    address constant AGENT_WALLET = address(0x1234567890123456789012345678901234567890);
    uint256 constant SETTLEMENT_THRESHOLD = 1e6; // 1 USDC (6 decimals)
    uint256 constant MIN_DEPOSIT = 1000; // 0.001 USDC
    uint256 constant MIN_THRESHOLD = 10000; // 0.01 USDC

    MockERC20 usdc;

    // Test addresses
    address payer1 = address(0x1111111111111111111111111111111111111111);
    address payer2 = address(0x2222222222222222222222222222222222222222);
    address unauthorized = address(0xbAd0000000000000000000000000000000000000);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        hook = new ArcSettlementHook(AGENT_WALLET, address(usdc), SETTLEMENT_THRESHOLD);
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

    function test_constructor_initializesCounters() public view {
        assertEq(hook.totalSettlements(), 0);
        assertEq(hook.totalSettledAmount(), 0);
        assertEq(hook.accumulatedBalance(), 0);
    }

    function test_constructor_revertsIfZeroAgentWallet() public {
        vm.expectRevert(ArcSettlementHook.InvalidAgentWallet.selector);
        new ArcSettlementHook(address(0), address(usdc), SETTLEMENT_THRESHOLD);
    }

    function test_constructor_revertsIfZeroUsdc() public {
        vm.expectRevert(ArcSettlementHook.InvalidUsdcAddress.selector);
        new ArcSettlementHook(AGENT_WALLET, address(0), SETTLEMENT_THRESHOLD);
    }

    function test_constructor_revertsIfThresholdTooLow() public {
        vm.expectRevert(ArcSettlementHook.ThresholdTooLow.selector);
        new ArcSettlementHook(AGENT_WALLET, address(usdc), MIN_THRESHOLD - 1);
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
        emit ArcSettlementHook.PayerAuthorized(payer1);
        hook.authorizePayer(payer1);
    }

    function test_authorizePayer_revertsIfNotAgent() public {
        vm.prank(unauthorized);
        vm.expectRevert(ArcSettlementHook.OnlyAgentCanManage.selector);
        hook.authorizePayer(payer1);
    }

    function test_authorizePayer_revertsIfZeroAddress() public {
        vm.prank(AGENT_WALLET);
        vm.expectRevert(ArcSettlementHook.InvalidAgentWallet.selector);
        hook.authorizePayer(address(0));
    }

    function test_authorizePayer_revertsIfAlreadyAuthorized() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(payer1);

        vm.prank(AGENT_WALLET);
        vm.expectRevert(ArcSettlementHook.PayerAlreadyAuthorized.selector);
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
        emit ArcSettlementHook.PayerRevoked(payer1);
        hook.revokePayer(payer1);
    }

    function test_revokePayer_revertsIfNotAgent() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(payer1);

        vm.prank(unauthorized);
        vm.expectRevert(ArcSettlementHook.OnlyAgentCanManage.selector);
        hook.revokePayer(payer1);
    }

    function test_revokePayer_revertsIfNotAuthorized() public {
        vm.prank(AGENT_WALLET);
        vm.expectRevert(ArcSettlementHook.PayerNotFound.selector);
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
        emit ArcSettlementHook.MicropaymentReceived(address(this), amount, queryId);

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

        vm.expectRevert(ArcSettlementHook.PayerNotAuthorized.selector);
        hook.depositMicropayment(amount, queryId);
    }

    function test_depositMicropayment_rejectsZeroAmount() public {
        bytes32 queryId = keccak256("query_zero");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        vm.expectRevert(ArcSettlementHook.AmountTooSmall.selector);
        hook.depositMicropayment(0, queryId);
    }

    function test_depositMicropayment_rejectsBelowMinimum() public {
        bytes32 queryId = keccak256("query_dust");

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), MIN_DEPOSIT - 1);
        usdc.approve(address(hook), MIN_DEPOSIT - 1);

        vm.expectRevert(ArcSettlementHook.AmountTooSmall.selector);
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
        emit ArcSettlementHook.SettlementExecuted(AGENT_WALLET, SETTLEMENT_THRESHOLD, 1);

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

    function test_autoSettle_updatesTotalSettlements() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), SETTLEMENT_THRESHOLD);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD);
        hook.depositMicropayment(SETTLEMENT_THRESHOLD, keccak256("q1"));

        assertEq(hook.totalSettlements(), 1);
        assertEq(hook.totalSettledAmount(), SETTLEMENT_THRESHOLD);
    }

    function test_autoSettle_multipleSettlementsTrackCorrectly() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        // First settlement
        usdc.mint(address(this), SETTLEMENT_THRESHOLD);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD);
        hook.depositMicropayment(SETTLEMENT_THRESHOLD, keccak256("q1"));

        // Second settlement
        usdc.mint(address(this), SETTLEMENT_THRESHOLD * 2);
        usdc.approve(address(hook), SETTLEMENT_THRESHOLD * 2);
        hook.depositMicropayment(SETTLEMENT_THRESHOLD * 2, keccak256("q2"));

        assertEq(hook.totalSettlements(), 2);
        assertEq(hook.totalSettledAmount(), SETTLEMENT_THRESHOLD * 3);
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
        vm.expectRevert(ArcSettlementHook.OnlyAgentCanSettle.selector);
        hook.settleNow();
    }

    function test_settleNow_noBalanceDoesNothing() public {
        vm.prank(AGENT_WALLET);
        hook.settleNow();

        assertEq(usdc.balanceOf(AGENT_WALLET), 0);
        assertEq(hook.totalSettlements(), 0);
    }

    function test_settleNow_emitsEvent() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 500000);
        usdc.approve(address(hook), 500000);
        hook.depositMicropayment(500000, keccak256("query"));

        vm.prank(AGENT_WALLET);
        vm.expectEmit(true, false, false, true);
        emit ArcSettlementHook.SettlementExecuted(AGENT_WALLET, 500000, 1);
        hook.settleNow();
    }

    // ============ Policy Tests (setSettlementThreshold) ============

    function test_setThreshold_updatesThreshold() public {
        uint256 newThreshold = 2e6; // 2 USDC

        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(newThreshold);

        assertEq(hook.settlementThreshold(), newThreshold);
    }

    function test_setThreshold_emitsEvent() public {
        uint256 newThreshold = 2e6;

        vm.prank(AGENT_WALLET);
        vm.expectEmit(false, false, false, true);
        emit ArcSettlementHook.ThresholdUpdated(SETTLEMENT_THRESHOLD, newThreshold);
        hook.setSettlementThreshold(newThreshold);
    }

    function test_setThreshold_revertsIfNotAgent() public {
        vm.prank(unauthorized);
        vm.expectRevert(ArcSettlementHook.OnlyAgentCanManage.selector);
        hook.setSettlementThreshold(2e6);
    }

    function test_setThreshold_revertsIfTooLow() public {
        vm.prank(AGENT_WALLET);
        vm.expectRevert(ArcSettlementHook.ThresholdTooLow.selector);
        hook.setSettlementThreshold(MIN_THRESHOLD - 1);
    }

    function test_setThreshold_autoSettlesIfBalanceExceedsNewThreshold() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        // Deposit 0.5 USDC (below 1 USDC threshold)
        usdc.mint(address(this), 500000);
        usdc.approve(address(hook), 500000);
        hook.depositMicropayment(500000, keccak256("q1"));

        assertEq(hook.accumulatedBalance(), 500000);
        assertEq(usdc.balanceOf(AGENT_WALLET), 0);

        // Lower threshold to 0.1 USDC — triggers auto-settlement
        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(100000);

        assertEq(hook.accumulatedBalance(), 0);
        assertEq(usdc.balanceOf(AGENT_WALLET), 500000);
        assertEq(hook.totalSettlements(), 1);
    }

    function test_setThreshold_noSettleIfBalanceBelowNewThreshold() public {
        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), 100000);
        usdc.approve(address(hook), 100000);
        hook.depositMicropayment(100000, keccak256("q1"));

        // Raise threshold to 2 USDC — no settlement
        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(2e6);

        assertEq(hook.accumulatedBalance(), 100000);
        assertEq(hook.totalSettlements(), 0);
    }

    function test_setThreshold_acceptsMinThreshold() public {
        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(MIN_THRESHOLD);
        assertEq(hook.settlementThreshold(), MIN_THRESHOLD);
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

    function testFuzz_setThreshold(uint256 threshold) public {
        threshold = bound(threshold, MIN_THRESHOLD, 100e6); // up to 100 USDC

        vm.prank(AGENT_WALLET);
        hook.setSettlementThreshold(threshold);

        assertEq(hook.settlementThreshold(), threshold);
    }

    function testFuzz_depositAndAutoSettle(uint256 amount) public {
        amount = bound(amount, SETTLEMENT_THRESHOLD, 10e6);

        vm.prank(AGENT_WALLET);
        hook.authorizePayer(address(this));

        usdc.mint(address(this), amount);
        usdc.approve(address(hook), amount);

        hook.depositMicropayment(amount, keccak256("fuzz_settle"));

        assertEq(hook.accumulatedBalance(), 0);
        assertEq(usdc.balanceOf(AGENT_WALLET), amount);
        assertEq(hook.totalSettlements(), 1);
    }
}
