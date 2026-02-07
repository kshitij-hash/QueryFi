// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MicropaymentSettlementHook
/// @notice A Uniswap v4 hook for accumulating micropayments and settling to agent wallet
/// @dev Inherits BaseHook for v4 integration, tracks swaps via afterSwap
contract MicropaymentSettlementHook is BaseHook, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    // Custom errors for gas efficiency
    error InvalidAgentWallet();
    error InvalidUsdcAddress();
    error OnlyAgentCanSettle();
    error OnlyAgentCanManage();
    error AmountTooSmall();
    error PayerNotAuthorized();
    error PayerAlreadyAuthorized();
    error PayerNotFound();

    // Settlement threshold: 1 USDC (6 decimals)
    uint256 public constant SETTLEMENT_THRESHOLD = 1e6;

    // Minimum deposit amount: 0.001 USDC (1000 units with 6 decimals)
    uint256 public constant MIN_DEPOSIT = 1000;

    // Agent wallet that receives settlements
    address public immutable agentWallet;

    // USDC token address
    address public immutable usdc;

    // Accumulated balance pending settlement
    uint256 public accumulatedBalance;

    // Authorized payers mapping
    mapping(address => bool) public authorizedPayers;

    // Hook swap tracking state
    uint256 public totalSwapsTracked;
    mapping(PoolId => uint256) public poolSwapCount;

    // Events
    event MicropaymentReceived(address indexed payer, uint256 amount, bytes32 indexed queryId);
    event SettlementExecuted(address indexed agent, uint256 amount);
    event PayerAuthorized(address indexed payer);
    event PayerRevoked(address indexed payer);
    event SwapTracked(PoolId indexed poolId, address indexed sender, uint256 totalSwaps);

    /// @notice Restricts function access to the agent wallet
    modifier onlyAgent() {
        if (msg.sender != agentWallet) revert OnlyAgentCanManage();
        _;
    }

    constructor(IPoolManager _poolManager, address _agentWallet, address _usdc) BaseHook(_poolManager) {
        if (_agentWallet == address(0)) revert InvalidAgentWallet();
        if (_usdc == address(0)) revert InvalidUsdcAddress();
        agentWallet = _agentWallet;
        usdc = _usdc;

        // Agent is authorized by default
        authorizedPayers[_agentWallet] = true;
        emit PayerAuthorized(_agentWallet);
    }

    // ============ BaseHook Overrides ============

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _afterSwap(
        address sender,
        PoolKey calldata poolKey,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        PoolId poolId = poolKey.toId();
        totalSwapsTracked++;
        poolSwapCount[poolId]++;

        emit SwapTracked(poolId, sender, totalSwapsTracked);

        return (this.afterSwap.selector, 0);
    }

    // ============ Micropayment Functions ============

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

    /// @notice Deposit a micropayment for accumulation
    /// @param amount The amount of USDC to deposit (6 decimals)
    /// @param queryId A unique identifier for the query this payment is for
    /// @dev Uses nonReentrant modifier and follows checks-effects-interactions pattern
    function depositMicropayment(uint256 amount, bytes32 queryId) external nonReentrant {
        // Checks
        if (!authorizedPayers[msg.sender]) revert PayerNotAuthorized();
        if (amount < MIN_DEPOSIT) revert AmountTooSmall();

        // Effects - update state before external call
        uint256 newBalance = accumulatedBalance + amount;
        accumulatedBalance = newBalance;

        emit MicropaymentReceived(msg.sender, amount, queryId);

        // Interactions - external call last
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);

        // Auto-settle if threshold reached
        if (newBalance >= SETTLEMENT_THRESHOLD) {
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

    /// @notice Get the current accumulated balance
    function getAgentBalance() external view returns (uint256) {
        return accumulatedBalance;
    }

    /// @notice Internal settlement function
    function _settle() internal {
        uint256 amount = accumulatedBalance;
        accumulatedBalance = 0;

        // Transfer to agent wallet
        IERC20(usdc).safeTransfer(agentWallet, amount);

        emit SettlementExecuted(agentWallet, amount);
    }
}
