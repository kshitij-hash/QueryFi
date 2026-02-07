// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcSettlementHook
/// @notice Standalone micropayment settlement contract for Arc testnet
/// @dev Accumulates USDC micropayments and auto-settles to the agent wallet
///      when a configurable threshold is reached. Designed for Circle Track B:
///      "Build Global Payouts and Treasury Systems with USDC on Arc"
///
///      Key Track B features demonstrated:
///      - Automated agent-driven payout logic (threshold-based auto-settlement)
///      - Fund settlements (micropayment accumulation → on-chain USDC payout)
///      - Policy-based payouts (configurable threshold, agent can adjust policy)
contract ArcSettlementHook is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Custom errors for gas efficiency
    error InvalidAgentWallet();
    error InvalidUsdcAddress();
    error OnlyAgentCanSettle();
    error OnlyAgentCanManage();
    error AmountTooSmall();
    error PayerNotAuthorized();
    error PayerAlreadyAuthorized();
    error PayerNotFound();
    error ThresholdTooLow();

    // Minimum deposit amount: 0.001 USDC (1000 units with 6 decimals)
    uint256 public constant MIN_DEPOSIT = 1000;

    // Minimum allowed threshold: 0.01 USDC
    uint256 public constant MIN_THRESHOLD = 10000;

    // Agent wallet that receives settlements
    address public immutable agentWallet;

    // USDC token address (Arc native: 0x3600...0000)
    address public immutable usdc;

    // Settlement threshold — configurable policy (default 1 USDC)
    uint256 public settlementThreshold;

    // Accumulated balance pending settlement
    uint256 public accumulatedBalance;

    // Total settlements executed
    uint256 public totalSettlements;

    // Total USDC settled across all settlements
    uint256 public totalSettledAmount;

    // Authorized payers mapping
    mapping(address => bool) public authorizedPayers;

    // Events
    event MicropaymentReceived(address indexed payer, uint256 amount, bytes32 indexed queryId);
    event SettlementExecuted(address indexed agent, uint256 amount, uint256 settlementId);
    event PayerAuthorized(address indexed payer);
    event PayerRevoked(address indexed payer);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    /// @notice Restricts function access to the agent wallet
    modifier onlyAgent() {
        if (msg.sender != agentWallet) revert OnlyAgentCanManage();
        _;
    }

    /// @param _agentWallet Address that receives settled USDC and manages the contract
    /// @param _usdc USDC token address on Arc testnet
    /// @param _threshold Initial settlement threshold in USDC units (6 decimals)
    constructor(address _agentWallet, address _usdc, uint256 _threshold) {
        if (_agentWallet == address(0)) revert InvalidAgentWallet();
        if (_usdc == address(0)) revert InvalidUsdcAddress();
        if (_threshold < MIN_THRESHOLD) revert ThresholdTooLow();

        agentWallet = _agentWallet;
        usdc = _usdc;
        settlementThreshold = _threshold;

        // Agent is authorized by default
        authorizedPayers[_agentWallet] = true;
        emit PayerAuthorized(_agentWallet);
    }

    // ============ Policy Management ============

    /// @notice Update the settlement threshold (policy-based payout control)
    /// @param newThreshold New threshold in USDC units (6 decimals)
    function setSettlementThreshold(uint256 newThreshold) external onlyAgent {
        if (newThreshold < MIN_THRESHOLD) revert ThresholdTooLow();

        uint256 oldThreshold = settlementThreshold;
        settlementThreshold = newThreshold;

        emit ThresholdUpdated(oldThreshold, newThreshold);

        // If accumulated balance now exceeds new (lower) threshold, auto-settle
        if (accumulatedBalance >= newThreshold) {
            _settle();
        }
    }

    // ============ Payer Authorization ============

    /// @notice Authorize a payer to deposit micropayments
    /// @param payer The address to authorize
    function authorizePayer(address payer) external onlyAgent {
        if (payer == address(0)) revert InvalidAgentWallet();
        if (authorizedPayers[payer]) revert PayerAlreadyAuthorized();

        authorizedPayers[payer] = true;
        emit PayerAuthorized(payer);
    }

    /// @notice Revoke authorization from a payer
    /// @param payer The address to revoke
    function revokePayer(address payer) external onlyAgent {
        if (!authorizedPayers[payer]) revert PayerNotFound();

        authorizedPayers[payer] = false;
        emit PayerRevoked(payer);
    }

    /// @notice Check if an address is authorized to deposit
    /// @param payer The address to check
    /// @return True if authorized
    function isAuthorizedPayer(address payer) external view returns (bool) {
        return authorizedPayers[payer];
    }

    // ============ Micropayment Functions ============

    /// @notice Deposit a micropayment for accumulation
    /// @param amount The amount of USDC to deposit (6 decimals)
    /// @param queryId A unique identifier for the query this payment is for
    /// @dev Uses nonReentrant modifier and follows checks-effects-interactions pattern
    function depositMicropayment(uint256 amount, bytes32 queryId) external nonReentrant {
        // Checks
        if (!authorizedPayers[msg.sender]) revert PayerNotAuthorized();
        if (amount < MIN_DEPOSIT) revert AmountTooSmall();

        // Effects — update state before external call
        uint256 newBalance = accumulatedBalance + amount;
        accumulatedBalance = newBalance;

        emit MicropaymentReceived(msg.sender, amount, queryId);

        // Interactions — external call last
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);

        // Auto-settle if threshold reached (policy-based payout)
        if (newBalance >= settlementThreshold) {
            _settle();
        }
    }

    /// @notice Manual settlement trigger (only agent can call)
    function settleNow() external nonReentrant {
        if (msg.sender != agentWallet) revert OnlyAgentCanSettle();
        if (accumulatedBalance > 0) {
            _settle();
        }
    }

    // ============ View Functions ============

    /// @notice Get the current accumulated balance
    function getAgentBalance() external view returns (uint256) {
        return accumulatedBalance;
    }

    // ============ Internal ============

    /// @notice Internal settlement function — transfers accumulated USDC to agent
    function _settle() internal {
        uint256 amount = accumulatedBalance;
        accumulatedBalance = 0;
        totalSettlements++;
        totalSettledAmount += amount;

        // Transfer to agent wallet
        IERC20(usdc).safeTransfer(agentWallet, amount);

        emit SettlementExecuted(agentWallet, amount, totalSettlements);
    }
}
