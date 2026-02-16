// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import '../SageCore/SageCore.sol';
import './PayloadLib.sol';

/// @notice Minimal interface for the InsecureRandomness contract.
interface IInsecureRandomness {
  function randomValue(bytes memory subject) external view returns (bytes32);
}

/**
 * @title CasinoJam
 * @author Ajuna Network
 * @notice One-arm bandit (slot machine) game built on SageCore.
 *
 * @dev Ported from the C# reference implementation of SAGE CasinoJam.
 *
 *      Asset types (encoded in `kind`):
 *        KIND_HUMAN   = 0x11  — the player avatar
 *        KIND_TRACKER = 0x12  — stores last spin results
 *        KIND_BANDIT  = 0x21  — the slot machine
 *        KIND_SEAT    = 0x40  — links a player to a machine
 *
 *      Economy: internal credit system.  Users deposit/withdraw ETH which is
 *      converted to credits at `exchangeRate` (wei-per-credit).
 *
 *      Randomness is sourced from the InsecureRandomness contract.
 */
contract CasinoJam is SageCore {
  using PayloadLib for bytes32;

  // ================================================================
  //                        CONSTANTS
  // ================================================================

  // Asset kind values (matches C# MatchType encoding)
  uint16 public constant KIND_HUMAN = 0x11; // Player + Human
  uint16 public constant KIND_TRACKER = 0x12; // Player + Tracker
  uint16 public constant KIND_BANDIT = 0x21; // Machine + Bandit
  uint16 public constant KIND_SEAT = 0x40; // Seat + None

  // Time constants (6-second block time)
  uint256 public constant BLOCKS_PER_MINUTE = 10;
  uint256 public constant BLOCKS_PER_HOUR = 600;
  uint256 public constant BLOCKS_PER_DAY = 14400;
  uint256 public constant BASE_RESERVATION_TIME = 5 * BLOCKS_PER_MINUTE; // 50 blocks = 5 min

  // Fee constants
  uint256 public constant BASE_RENT_FEE = 10; // base rent fee in credits
  uint256 public constant SEAT_USAGE_FEE_PERC = 1; // 1% usage fee on release

  // Spin engine
  uint8 public constant BANDIT_MAX_SPINS = 4;
  uint256 public constant SINGLE_SPIN_MAX_REWARD = 8192; // per C# reference

  // Gamble cooldown
  uint256 public constant GAMBLE_COOLDOWN = 1; // 1 block between gambles

  // ================================================================
  //                     STATE VARIABLES
  // ================================================================

  /// @notice Address of the InsecureRandomness contract.
  address public rngContract;

  /// @notice Wei per credit. Default: 1e12 (1 szabo = 0.000001 ETH per credit).
  uint256 public exchangeRate;

  /// @notice Per-asset credit balances (internal game currency).
  mapping(uint256 => uint256) public assetBalances;

  // One-per-account tracking
  mapping(address => uint256) public playerHumanId;
  mapping(address => uint256) public playerTrackerId;
  mapping(address => uint256) public playerMachineId;

  // ================================================================
  //                          EVENTS
  // ================================================================

  event PlayerCreated(
    address indexed player,
    uint256 humanId,
    uint256 trackerId
  );
  event MachineCreated(address indexed machineOwner, uint256 machineId);
  event CreditsDeposited(
    uint256 indexed assetId,
    address indexed depositor,
    uint256 credits
  );
  event CreditsWithdrawn(
    uint256 indexed assetId,
    address indexed withdrawer,
    uint256 credits,
    uint256 weiAmount
  );
  event SeatRented(
    uint256 indexed machineId,
    uint256 seatId,
    uint8 rentDuration
  );
  event SeatReserved(
    uint256 indexed seatId,
    uint256 humanId,
    uint8 reservationDuration,
    uint256 reservationFee
  );
  event GambleResult(
    uint256 indexed humanId,
    uint256 indexed machineId,
    uint8 spinCount,
    uint256 totalReward,
    uint256 playFee
  );
  event SpinResult(
    uint256 indexed humanId,
    uint8 spinIndex,
    uint8 slot1,
    uint8 slot2,
    uint8 slot3,
    uint8 bonus1,
    uint8 bonus2,
    uint256 reward
  );
  event SeatReleased(
    uint256 indexed seatId,
    uint256 humanId,
    uint256 refund,
    uint256 usageFee
  );
  event PlayerKicked(
    uint256 indexed seatId,
    uint256 victimId,
    uint256 sniperId,
    uint256 bounty
  );
  event SeatReturned(
    uint256 indexed machineId,
    uint256 seatId,
    uint256 remainingBalance
  );
  event ExchangeRateChanged(uint256 oldRate, uint256 newRate);
  event RngContractChanged(address oldAddr, address newAddr);
  event MachineConfigured(uint256 indexed machineId);

  // ================================================================
  //                       CUSTOM ERRORS
  // ================================================================

  error PlayerAlreadyExists();
  error MachineAlreadyExists();
  error InvalidExchangeRate();
  error ZeroCreditDeposit();
  error InsufficientCredits();
  error MachineCantCoverReward();
  error WithdrawBlockedByLinkedSeats();
  error NoSeatsAvailable();
  error SeatOccupied();
  error AlreadySeated();
  error SeatNotLinkedToMachine();
  error SeatExpiredForReservation();
  error NotSeated();
  error SeatPlayerMismatch();
  error CooldownNotExpired();
  error InvalidSpinCount();
  error ReservationStillProtected();
  error SeatNotEmpty();
  error InvalidRentDuration();
  error InvalidReservationDuration();
  error AssetTypeMismatch();
  error InvalidParameter();
  error InvalidRngContract();

  // ================================================================
  //                       CONSTRUCTOR
  // ================================================================

  /**
   * @notice Deploy a CasinoJam game.
   * @param _rngContract Address of the InsecureRandomness contract.
   */
  constructor(address _rngContract) SageCore() {
    if (_rngContract == address(0)) revert InvalidRngContract();
    rngContract = _rngContract;
    exchangeRate = 1e12; // 1 credit = 1 szabo = 0.000001 ETH
  }

  // ================================================================
  //                    OWNER CONFIGURATION
  // ================================================================

  /**
   * @notice Update the exchange rate (wei per credit).
   * @param newRate New exchange rate (must be > 0).
   */
  function setExchangeRate(uint256 newRate) external onlyOwner {
    if (newRate == 0) revert InvalidExchangeRate();
    uint256 oldRate = exchangeRate;
    exchangeRate = newRate;
    emit ExchangeRateChanged(oldRate, newRate);
  }

  /**
   * @notice Update the InsecureRandomness contract address.
   * @param newAddr New RNG contract address.
   */
  function setRngContract(address newAddr) external onlyOwner {
    if (newAddr == address(0)) revert InvalidRngContract();
    address oldAddr = rngContract;
    rngContract = newAddr;
    emit RngContractChanged(oldAddr, newAddr);
  }

  // ================================================================
  //                      VIEW HELPERS
  // ================================================================

  /**
   * @notice Get the credit balance of an asset.
   */
  function getAssetBalance(uint256 assetId) external view returns (uint256) {
    return assetBalances[assetId];
  }

  // ================================================================
  //               PAYLOAD READ HELPERS (INTERNAL)
  // ================================================================

  // ── Bandit payload reads ─────────────────────────────────────

  function _banditSeatLinked(bytes32 p) internal pure returns (uint8) {
    return p.readHighNibble(7);
  }

  function _banditSeatLimit(bytes32 p) internal pure returns (uint8) {
    return p.readLowNibble(7);
  }

  function _banditMaxSpins(bytes32 p) internal pure returns (uint8) {
    return p.readLowNibble(15);
  }

  function _banditValue1Factor(bytes32 p) internal pure returns (uint8) {
    return p.readHighNibble(8);
  }

  function _banditValue1Multiplier(bytes32 p) internal pure returns (uint8) {
    return p.readLowNibble(8);
  }

  /// @dev SingleSpinStake = 10^factor * multiplier
  function _banditStake(bytes32 p) internal pure returns (uint256) {
    uint256 factor = uint256(_banditValue1Factor(p));
    uint256 multiplier = uint256(_banditValue1Multiplier(p));
    return (10 ** factor) * multiplier;
  }

  // ── Seat payload reads ───────────────────────────────────────

  function _seatCreationBlock(bytes32 p) internal pure returns (uint32) {
    return p.readUint32LE(1);
  }

  function _seatRentDuration(bytes32 p) internal pure returns (uint8) {
    return p.readByte(7);
  }

  function _seatPlayerFee(bytes32 p) internal pure returns (uint16) {
    return p.readUint16LE(8);
  }

  function _seatPlayerGracePeriod(bytes32 p) internal pure returns (uint8) {
    return p.readByte(11);
  }

  function _seatReservationStartBlock(bytes32 p) internal pure returns (uint32) {
    return p.readUint32LE(12);
  }

  function _seatReservationDuration(bytes32 p) internal pure returns (uint8) {
    return p.readByte(16);
  }

  function _seatLastActionBlockOffset(bytes32 p) internal pure returns (uint16) {
    return p.readUint16LE(20);
  }

  function _seatPlayerActionCount(bytes32 p) internal pure returns (uint16) {
    return p.readUint16LE(22);
  }

  function _seatPlayerId(bytes32 p) internal pure returns (uint32) {
    return p.readUint32LE(24);
  }

  function _seatMachineId(bytes32 p) internal pure returns (uint32) {
    return p.readUint32LE(28);
  }

  // ── Human payload reads ──────────────────────────────────────

  function _humanSeatId(bytes32 p) internal pure returns (uint32) {
    return p.readUint32LE(28);
  }

  // ================================================================
  //             DURATION / FEE CALCULATION HELPERS
  // ================================================================

  /**
   * @dev Returns number of days for a RentDuration enum value.
   */
  function _rentDurationDays(uint8 rd) internal pure returns (uint256) {
    if (rd == 1) return 1;
    if (rd == 2) return 2;
    if (rd == 3) return 3;
    if (rd == 4) return 5;
    if (rd == 5) return 7;
    if (rd == 6) return 14;
    if (rd == 7) return 28;
    if (rd == 8) return 56;
    if (rd == 9) return 112;
    return 0;
  }

  /**
   * @dev Returns rent duration in blocks.
   */
  function _rentDurationBlocks(uint8 rd) internal pure returns (uint256) {
    return _rentDurationDays(rd) * BLOCKS_PER_DAY;
  }

  /**
   * @dev Returns rent fee in credits. Fixed: BASE_RENT_FEE * enum_value.
   *      (C# had a bug: BASE_RENT_FEE * BASE_RENT_FEE.)
   */
  function _rentFee(uint8 rd) internal pure returns (uint256) {
    return BASE_RENT_FEE * uint256(rd);
  }

  /**
   * @dev Reservation duration multiplier: enum value maps to 5-min increments.
   *      Mins5=1, Mins10=2, Mins15=3, Mins30=6, Mins45=9,
   *      Hour1=12, Hours2=24, Hours3=36, Hours4=48,
   *      Hours6=72, Hours8=96, Hours12=144.
   */
  function _reservationDurationMultiplier(
    uint8 rd
  ) internal pure returns (uint256) {
    if (rd == 1) return 1; // 5 min
    if (rd == 2) return 2; // 10 min
    if (rd == 3) return 3; // 15 min
    if (rd == 4) return 6; // 30 min
    if (rd == 5) return 9; // 45 min
    if (rd == 6) return 12; // 1 hour
    if (rd == 7) return 24; // 2 hours
    if (rd == 8) return 36; // 3 hours
    if (rd == 9) return 48; // 4 hours
    if (rd == 10) return 72; // 6 hours
    if (rd == 11) return 96; // 8 hours
    if (rd == 12) return 144; // 12 hours
    return 0;
  }

  /**
   * @dev Reservation duration in blocks.
   */
  function _reservationDurationBlocks(uint8 rd) internal pure returns (uint256) {
    return _reservationDurationMultiplier(rd) * BASE_RESERVATION_TIME;
  }

  /**
   * @dev Reservation fee = playerFee * enum_value.
   */
  function _reservationFee(
    uint16 playerFee,
    uint8 reservationDuration
  ) internal pure returns (uint256) {
    return uint256(playerFee) * uint256(reservationDuration);
  }

  // ================================================================
  //                   SPIN ENGINE (INTERNAL)
  // ================================================================

  /**
   * @dev Weighted symbol selection matching C# GetSlot distribution.
   *      Weights: BLANK=52*, CHERRY=43, LEMON=38, ORANGE=34, PLUM=28,
   *      WATERMELON=23, GRAPE=17, BELL=12, BAR=6, DIAMOND=3.
   *      (*BLANK gets 52 due to <= comparison on cumulative sum.)
   */
  function _getSlot(uint8 v) internal pure returns (uint8) {
    if (v <= 51) return 0; // BLANK
    if (v <= 94) return 1; // CHERRY
    if (v <= 132) return 2; // LEMON
    if (v <= 166) return 3; // ORANGE
    if (v <= 194) return 4; // PLUM
    if (v <= 217) return 5; // WATERMELON
    if (v <= 234) return 6; // GRAPE
    if (v <= 246) return 7; // BELL
    if (v <= 252) return 8; // BAR
    return 9; // DIAMOND (253-255)
  }

  /**
   * @dev Three-of-a-kind reward factor (× stake).
   */
  function _slotRewardFactor(uint8 symbol) internal pure returns (uint256) {
    if (symbol == 1) return 5;
    if (symbol == 2) return 10;
    if (symbol == 3) return 25;
    if (symbol == 4) return 50;
    if (symbol == 5) return 100;
    if (symbol == 6) return 200;
    if (symbol == 7) return 500;
    if (symbol == 8) return 750;
    if (symbol == 9) return 1500;
    return 0; // BLANK
  }

  /**
   * @dev Bonus pair reward factor (× stake).
   */
  function _bonusRewardFactor(uint8 symbol) internal pure returns (uint256) {
    if (symbol == 1) return 1;
    if (symbol >= 2 && symbol <= 5) return 2;
    if (symbol >= 6 && symbol <= 8) return 4;
    if (symbol == 9) return 8;
    return 0; // BLANK
  }

  /**
   * @dev Calculate reward for a single spin. Matches C# SingleSpinReward.
   * @param stake The machine's SingleSpinStake (m).
   */
  function _singleSpinReward(
    uint256 stake,
    uint8 slot1,
    uint8 slot2,
    uint8 slot3,
    uint8 bonus1,
    uint8 bonus2
  ) internal pure returns (uint256) {
    // Three-of-a-kind
    uint256 sFactor = 0;
    if (slot1 == slot2 && slot1 == slot3 && slot1 != 0) {
      sFactor = _slotRewardFactor(slot1) * stake;
    }

    // Bonus pair
    uint256 bFactor = 0;
    if (bonus1 == bonus2 && bonus1 != 0) {
      bFactor = _bonusRewardFactor(bonus1) * stake;
    }

    // Full line: all 5 reels same symbol
    bool isFullLine = (slot1 == bonus1) && sFactor > 0 && bFactor > 0;

    uint256 reward = sFactor;

    if (sFactor > 0) {
      if (isFullLine) {
        // bFactor is guaranteed > 0 here
        reward = sFactor * (128 / bFactor);
      } else if (bFactor > 0) {
        reward = sFactor + (32 * bFactor);
      }
    }

    // Bonus-only (no three-of-a-kind)
    if (reward == 0 && stake > 0) {
      reward = bFactor / stake;
    }

    return reward;
  }

  /**
   * @dev Pack a spin result into 3 bytes (matches C# PackSlotResult).
   *      Byte 0: [slot1:4 | slot2:4]
   *      Byte 1: [slot3:4 | 0:4]
   *      Byte 2: [bonus1:4 | bonus2:4]
   */
  function _packSpinResult(
    uint8 slot1,
    uint8 slot2,
    uint8 slot3,
    uint8 bonus1,
    uint8 bonus2
  ) internal pure returns (bytes3) {
    uint8 b0 = (slot1 << 4) | (slot2 & 0x0F);
    uint8 b1 = (slot3 << 4); // low nibble = 0
    uint8 b2 = (bonus1 << 4) | (bonus2 & 0x0F);
    return bytes3(abi.encodePacked(b0, b1, b2));
  }

  /**
   * @dev Write a 3-byte packed spin result to tracker payload at slot index.
   *      Slots stored at bytes 16..27 (4 slots × 3 bytes each).
   */
  function _writeTrackerSlot(
    bytes32 payload,
    uint8 slotIndex,
    bytes3 packed
  ) internal pure returns (bytes32) {
    uint8 offset = 16 + slotIndex * 3;
    payload = payload.writeByte(offset, uint8(packed[0]));
    payload = payload.writeByte(offset + 1, uint8(packed[1]));
    payload = payload.writeByte(offset + 2, uint8(packed[2]));
    return payload;
  }

  /**
   * @dev Calculate max machine payout for a given spin count.
   *      Uses C# constant SINGLE_SPIN_MAX_REWARD × stake × spinCount.
   */
  function _maxMachineReward(
    uint256 stake,
    uint8 spinCount
  ) internal pure returns (uint256) {
    return stake * SINGLE_SPIN_MAX_REWARD * uint256(spinCount);
  }

  // ================================================================
  //             GAME ACTIONS — PLAYER & MACHINE CREATION
  // ================================================================

  /**
   * @notice Create a player (Human + Tracker pair). One per account.
   * @return humanId The ID of the Human asset.
   * @return trackerId The ID of the Tracker asset.
   */
  function createPlayer()
    external
    returns (uint256 humanId, uint256 trackerId)
  {
    if (playerHumanId[msg.sender] != 0) revert PlayerAlreadyExists();

    // Mint Human — payload byte 0 = matchType 0x11
    bytes32 humanPayload = bytes32(0).writeByte(0, 0x11);
    humanId = _mintAsset(msg.sender, KIND_HUMAN, 0, 0, humanPayload);

    // Mint Tracker — payload byte 0 = matchType 0x12
    bytes32 trackerPayload = bytes32(0).writeByte(0, 0x12);
    trackerId = _mintAsset(msg.sender, KIND_TRACKER, 0, 0, trackerPayload);

    playerHumanId[msg.sender] = humanId;
    playerTrackerId[msg.sender] = trackerId;

    emit PlayerCreated(msg.sender, humanId, trackerId);
  }

  /**
   * @notice Create a slot machine (Bandit). One per account.
   * @return machineId The ID of the Bandit asset.
   */
  function createMachine() external returns (uint256 machineId) {
    if (playerMachineId[msg.sender] != 0) revert MachineAlreadyExists();

    // Build default Bandit payload
    bytes32 p = bytes32(0);
    p = p.writeByte(0, 0x21); // matchType: Machine + Bandit
    // byte 7: [SeatLinked=0 : SeatLimit=1]
    p = p.writeHighNibble(7, 0); // SeatLinked
    p = p.writeLowNibble(7, 1); // SeatLimit
    // byte 8: [Value1Factor=T_1(0) : Value1Multiplier=V1(1)]
    p = p.writeHighNibble(8, 0); // T_1 = 10^0 = 1
    p = p.writeLowNibble(8, 1); // V1 = multiplier 1
    // byte 9: [Value2Factor=T_1(0) : Value2Multiplier=V0(0)] — jackpot (disabled)
    p = p.writeHighNibble(9, 0);
    p = p.writeLowNibble(9, 0);
    // byte 10: [Value3Factor=T_1(0) : Value3Multiplier=V0(0)] — special (disabled)
    p = p.writeHighNibble(10, 0);
    p = p.writeLowNibble(10, 0);
    // byte 15 low nibble: MaxSpins = 4
    p = p.writeLowNibble(15, BANDIT_MAX_SPINS);

    machineId = _mintAsset(msg.sender, KIND_BANDIT, 0, 0, p);
    playerMachineId[msg.sender] = machineId;

    emit MachineCreated(msg.sender, machineId);
  }

  /**
   * @notice Configure machine parameters. Owner of the machine only.
   *         Machine must have no linked seats (SeatLinked == 0).
   * @param machineId The Bandit asset ID.
   * @param seatLimit Maximum seats (1-15).
   * @param maxSpins  Maximum spins per gamble (1-4).
   * @param value1Factor  Stake factor (TokenType enum, 0-6).
   * @param value1Multiplier Stake multiplier (MultiplierType, 0-9).
   */
  function configMachine(
    uint256 machineId,
    uint8 seatLimit,
    uint8 maxSpins,
    uint8 value1Factor,
    uint8 value1Multiplier
  ) external {
    Asset storage a = _getExistingAsset(machineId);
    if (a.owner != msg.sender) revert NotOwner();
    if (a.kind != KIND_BANDIT) revert AssetTypeMismatch();

    bytes32 p = a.payload;
    if (_banditSeatLinked(p) > 0) revert WithdrawBlockedByLinkedSeats();

    // Validate ranges
    if (seatLimit == 0 || seatLimit > 15) revert InvalidParameter();
    if (maxSpins == 0 || maxSpins > BANDIT_MAX_SPINS) revert InvalidSpinCount();

    // Update payload
    p = p.writeLowNibble(7, seatLimit);
    p = p.writeLowNibble(15, maxSpins);
    p = p.writeHighNibble(8, value1Factor);
    p = p.writeLowNibble(8, value1Multiplier);

    a.payload = p;
    emit MachineConfigured(machineId);
  }

  // ================================================================
  //               GAME ACTIONS — DEPOSIT / WITHDRAW
  // ================================================================

  /**
   * @notice Deposit ETH to an asset's credit balance.
   * @param assetId The Human or Machine asset to fund.
   * @param creditAmount Number of credits to deposit.
   * @dev msg.value must be >= creditAmount * exchangeRate.
   *      Excess is refunded via pull-payment.
   */
  function deposit(uint256 assetId, uint256 creditAmount) external payable {
    if (creditAmount == 0) revert ZeroCreditDeposit();

    Asset storage a = _getExistingAsset(assetId);
    if (a.owner != msg.sender) revert NotOwner();

    // Only Human or Machine assets can hold credits
    uint16 k = a.kind;
    if (k != KIND_HUMAN && k != KIND_BANDIT) revert AssetTypeMismatch();

    uint256 cost = creditAmount * exchangeRate;
    if (msg.value < cost) revert InsufficientPayment();

    assetBalances[assetId] += creditAmount;

    // Refund excess
    if (msg.value > cost) {
      uint256 refund = msg.value - cost;
      pendingWithdrawals[msg.sender] += refund;
      emit WithdrawalDeposited(msg.sender, refund);
    }

    emit CreditsDeposited(assetId, msg.sender, creditAmount);
  }

  /**
   * @notice Withdraw credits from an asset back to ETH (pull-payment).
   * @param assetId The Human or Machine asset.
   * @param creditAmount Number of credits to withdraw.
   * @dev For machines: blocked while any seat is linked.
   */
  function withdrawCredits(uint256 assetId, uint256 creditAmount) external {
    if (creditAmount == 0) revert ZeroCreditDeposit();

    Asset storage a = _getExistingAsset(assetId);
    if (a.owner != msg.sender) revert NotOwner();

    uint16 k = a.kind;
    if (k != KIND_HUMAN && k != KIND_BANDIT) revert AssetTypeMismatch();

    // Machine: block withdraw while seats linked
    if (k == KIND_BANDIT) {
      bytes32 p = a.payload;
      if (_banditSeatLinked(p) > 0) revert WithdrawBlockedByLinkedSeats();
    }

    if (assetBalances[assetId] < creditAmount) revert InsufficientCredits();

    assetBalances[assetId] -= creditAmount;

    uint256 weiAmount = creditAmount * exchangeRate;
    pendingWithdrawals[msg.sender] += weiAmount;
    emit WithdrawalDeposited(msg.sender, weiAmount);

    emit CreditsWithdrawn(assetId, msg.sender, creditAmount, weiAmount);
  }

  // ================================================================
  //               GAME ACTIONS — SEAT MANAGEMENT
  // ================================================================

  /**
   * @notice Rent a seat on a machine. Creates a new Seat asset.
   * @param machineId The Bandit asset to attach the seat to.
   * @param rentDuration RentDuration enum value (1-9).
   * @return seatId The newly created Seat asset ID.
   * @dev Caller must own the machine. Rent fee is deducted in credits
   *      from the machine's balance.
   */
  function rent(
    uint256 machineId,
    uint8 rentDuration
  ) external returns (uint256 seatId) {
    if (rentDuration == 0 || rentDuration > 9) revert InvalidRentDuration();

    Asset storage machine = _getExistingAsset(machineId);
    if (machine.owner != msg.sender) revert NotOwner();
    if (machine.kind != KIND_BANDIT) revert AssetTypeMismatch();

    bytes32 mp = machine.payload;
    uint8 linked = _banditSeatLinked(mp);
    uint8 limit = _banditSeatLimit(mp);
    if (linked >= limit) revert NoSeatsAvailable();

    // Deduct rent fee from machine balance (fixed: base * enum_value)
    uint256 fee = _rentFee(rentDuration);
    if (assetBalances[machineId] < fee) revert InsufficientCredits();
    assetBalances[machineId] -= fee;
    // Fee goes to collectedFees (owner can withdraw)
    collectedFees += fee * exchangeRate;

    // Ensure machine can cover max reward per seat after rent fee deduction.
    // Each seat could produce a max payout, so check against (linked+1) seats.
    uint256 stake = _banditStake(mp);
    uint8 maxSpins = _banditMaxSpins(mp);
    uint256 maxRewardPerSeat = _maxMachineReward(stake, maxSpins);
    uint256 totalMaxReward = maxRewardPerSeat * uint256(linked + 1);
    if (assetBalances[machineId] < totalMaxReward)
      revert MachineCantCoverReward();

    // Increment SeatLinked on machine
    mp = mp.writeHighNibble(7, linked + 1);
    machine.payload = mp;

    // Build Seat payload
    bytes32 sp = bytes32(0);
    sp = sp.writeByte(0, 0x40); // matchType: Seat
    sp = sp.writeUint32LE(1, uint32(block.number)); // SeatCreationBlock
    sp = sp.writeByte(7, rentDuration); // RentDuration
    sp = sp.writeUint16LE(8, 1); // PlayerFee = 1
    sp = sp.writeByte(11, 30); // PlayerGracePeriod = 30 blocks
    sp = sp.writeUint32LE(28, uint32(machineId)); // MachineId

    seatId = _mintAsset(msg.sender, KIND_SEAT, 0, 0, sp);

    emit SeatRented(machineId, seatId, rentDuration);
  }

  /**
   * @notice Reserve a seat (link player to seat). Pays reservation fee.
   * @param humanId The Human asset of the player.
   * @param seatId The Seat to reserve.
   * @param reservationDuration ReservationDuration enum value (1-12).
   */
  function reserve(
    uint256 humanId,
    uint256 seatId,
    uint8 reservationDuration
  ) external {
    if (reservationDuration == 0 || reservationDuration > 12)
      revert InvalidReservationDuration();

    // Validate Human
    Asset storage human = _getExistingAsset(humanId);
    if (human.owner != msg.sender) revert NotOwner();
    if (human.kind != KIND_HUMAN) revert AssetTypeMismatch();

    bytes32 hp = human.payload;
    if (_humanSeatId(hp) != 0) revert AlreadySeated();

    // Validate Seat
    Asset storage seat = _getExistingAsset(seatId);
    if (seat.kind != KIND_SEAT) revert AssetTypeMismatch();

    bytes32 sp = seat.payload;
    if (_seatPlayerId(sp) != 0) revert SeatOccupied();

    // Verify seat rent hasn't expired for this reservation
    uint256 seatCreation = uint256(_seatCreationBlock(sp));
    uint256 seatEnd = seatCreation +
      _rentDurationBlocks(_seatRentDuration(sp));
    uint256 reservBlocks = _reservationDurationBlocks(reservationDuration);
    if (block.number > seatEnd - reservBlocks) revert SeatExpiredForReservation();

    // Verify the machine backing this seat can cover max reward
    {
      uint32 machId = _seatMachineId(sp);
      Asset storage machine = _getExistingAsset(uint256(machId));
      bytes32 mp = machine.payload;
      uint256 maxReward = _maxMachineReward(_banditStake(mp), _banditMaxSpins(mp));
      if (assetBalances[uint256(machId)] < maxReward)
        revert MachineCantCoverReward();
    }

    // Calculate and pay reservation fee
    uint16 playerFee = _seatPlayerFee(sp);
    uint256 fee = _reservationFee(playerFee, reservationDuration);

    if (assetBalances[humanId] < fee) revert InsufficientCredits();

    // Transfer credits: human → seat
    assetBalances[humanId] -= fee;
    assetBalances[seatId] += fee;

    // Update Human payload: SeatId = seatId
    hp = hp.writeUint32LE(28, uint32(seatId));
    human.payload = hp;

    // Update Seat payload
    sp = sp.writeUint32LE(24, uint32(humanId)); // PlayerId
    sp = sp.writeUint32LE(12, uint32(block.number)); // ReservationStartBlock
    sp = sp.writeByte(16, reservationDuration); // ReservationDuration
    sp = sp.writeUint16LE(20, 0); // LastActionBlockOffset
    sp = sp.writeUint16LE(22, 0); // PlayerActionCount
    seat.payload = sp;

    emit SeatReserved(seatId, humanId, reservationDuration, fee);
  }

  /**
   * @notice Release a seat (voluntary exit). Refunds reservation fee minus usage.
   * @param humanId The Human asset of the player.
   * @param seatId The Seat to release.
   */
  function release(uint256 humanId, uint256 seatId) external {
    Asset storage human = _getExistingAsset(humanId);
    if (human.owner != msg.sender) revert NotOwner();
    if (human.kind != KIND_HUMAN) revert AssetTypeMismatch();

    Asset storage seat = _getExistingAsset(seatId);
    if (seat.kind != KIND_SEAT) revert AssetTypeMismatch();

    // Validate links + calculate refund in scoped block
    uint256 refund;
    uint256 usageFee;
    {
      bytes32 hp = human.payload;
      bytes32 sp = seat.payload;

      uint32 hSeatId = _humanSeatId(hp);
      uint32 sPlayerId = _seatPlayerId(sp);
      if (hSeatId == 0 || sPlayerId == 0) revert NotSeated();
      if (hSeatId != uint32(seatId) || sPlayerId != uint32(humanId))
        revert SeatPlayerMismatch();

      // Calculate refund (original reservation fee minus 1% usage)
      uint256 fullFee = _reservationFee(
        _seatPlayerFee(sp),
        _seatReservationDuration(sp)
      );
      usageFee = (SEAT_USAGE_FEE_PERC * fullFee) / 100;
      refund = fullFee - usageFee;

      // Cap refund at seat balance
      uint256 seatBal = assetBalances[seatId];
      if (refund > seatBal) refund = seatBal;

      // Clear human seat link
      human.payload = hp.writeUint32LE(28, 0);
      // Clear seat reservation
      seat.payload = _releaseSeat(sp);
    }

    // Transfer refund from seat to human
    assetBalances[seatId] -= refund;
    assetBalances[humanId] += refund;

    emit SeatReleased(seatId, humanId, refund, usageFee);
  }

  /**
   * @notice Kick an expired player from a seat. Kicker receives seat balance.
   * @param sniperHumanId The kicker's Human asset.
   * @param victimHumanId The victim's Human asset.
   * @param seatId The Seat to kick from.
   */
  function kick(
    uint256 sniperHumanId,
    uint256 victimHumanId,
    uint256 seatId
  ) external {
    // Validate sniper
    Asset storage sniper = _getExistingAsset(sniperHumanId);
    if (sniper.owner != msg.sender) revert NotOwner();
    if (sniper.kind != KIND_HUMAN) revert AssetTypeMismatch();

    // Validate victim & seat, check protection
    {
      Asset storage victim = _getExistingAsset(victimHumanId);
      if (victim.kind != KIND_HUMAN) revert AssetTypeMismatch();

      Asset storage seat = _getExistingAsset(seatId);
      if (seat.kind != KIND_SEAT) revert AssetTypeMismatch();

      bytes32 vp = victim.payload;
      bytes32 sp = seat.payload;

      // Validate victim ↔ seat link
      uint32 sPlayerId = _seatPlayerId(sp);
      uint32 vSeatId = _humanSeatId(vp);
      if (sPlayerId == 0 || vSeatId == 0) revert NotSeated();
      if (sPlayerId != uint32(victimHumanId) || vSeatId != uint32(seatId))
        revert SeatPlayerMismatch();

      // Check protection: block kick only when BOTH conditions hold
      _checkKickAllowed(sp);

      // Clear victim's seat link
      victim.payload = vp.writeUint32LE(28, 0);
      // Clear seat reservation
      seat.payload = _releaseSeat(sp);
    }

    // Transfer entire seat balance to sniper
    uint256 bounty = assetBalances[seatId];
    if (bounty > 0) {
      assetBalances[seatId] = 0;
      assetBalances[sniperHumanId] += bounty;
    }

    emit PlayerKicked(seatId, victimHumanId, sniperHumanId, bounty);
  }

  /**
   * @dev Check if a kick is allowed based on reservation expiry and grace period.
   */
  function _checkKickAllowed(bytes32 sp) internal view {
    uint256 resStart = uint256(_seatReservationStartBlock(sp));
    uint256 resEnd = resStart +
      _reservationDurationBlocks(_seatReservationDuration(sp));
    bool isReservationValid = resEnd >= block.number;

    uint256 lastActionBlock = resStart +
      uint256(_seatLastActionBlockOffset(sp));
    uint256 graceEnd = lastActionBlock +
      uint256(_seatPlayerGracePeriod(sp));
    bool isGracePeriod = graceEnd >= block.number;

    // Per C#: block kick only when BOTH reservation valid AND grace active
    if (isReservationValid && isGracePeriod) revert ReservationStillProtected();
  }

  /**
   * @notice Return an empty seat to the machine, destroy it.
   * @param machineId The Bandit asset.
   * @param seatId The Seat to return and burn.
   */
  function returnSeat(uint256 machineId, uint256 seatId) external {
    // Validate machine
    Asset storage machine = _getExistingAsset(machineId);
    if (machine.owner != msg.sender) revert NotOwner();
    if (machine.kind != KIND_BANDIT) revert AssetTypeMismatch();

    // Validate seat
    Asset storage seat = _getExistingAsset(seatId);
    if (seat.owner != msg.sender) revert NotOwner();
    if (seat.kind != KIND_SEAT) revert AssetTypeMismatch();

    bytes32 sp = seat.payload;
    bytes32 mp = machine.payload;

    // Seat must be linked to this machine
    if (_seatMachineId(sp) != uint32(machineId))
      revert SeatNotLinkedToMachine();

    // Seat must be empty
    if (_seatPlayerId(sp) != 0) revert SeatNotEmpty();

    // Machine must have at least 1 seat linked
    uint8 linked = _banditSeatLinked(mp);
    if (linked == 0) revert SeatNotLinkedToMachine();

    // Transfer remaining seat balance to owner's pending withdrawals
    uint256 remaining = assetBalances[seatId];
    if (remaining > 0) {
      assetBalances[seatId] = 0;
      uint256 weiAmount = remaining * exchangeRate;
      pendingWithdrawals[msg.sender] += weiAmount;
      emit WithdrawalDeposited(msg.sender, weiAmount);
    }

    // Decrement SeatLinked
    mp = mp.writeHighNibble(7, linked - 1);
    machine.payload = mp;

    // Burn the seat
    _burnAsset(seatId);

    emit SeatReturned(machineId, seatId, remaining);
  }

  // ================================================================
  //                    GAME ACTIONS — GAMBLE
  // ================================================================

  /**
   * @notice Play the slot machine.
   * @param humanId   The player's Human asset.
   * @param trackerId The player's Tracker asset.
   * @param seatId    The Seat the player is sitting at.
   * @param machineId The Bandit machine linked to the seat.
   * @param spinCount Number of spins (1-4).
   */
  function gamble(
    uint256 humanId,
    uint256 trackerId,
    uint256 seatId,
    uint256 machineId,
    uint8 spinCount
  ) external {
    _validateGamble(humanId, trackerId, seatId, machineId, spinCount);

    uint256 playFee = uint256(spinCount);
    uint256 stake = _banditStake(assets[machineId].payload);

    // Get randomness
    bytes32 randomSeed = IInsecureRandomness(rngContract).randomValue(
      abi.encodePacked('gamble', msg.sender, humanId, block.number)
    );

    // Execute spins and update tracker
    uint256 totalReward = _executeSpins(
      humanId,
      trackerId,
      randomSeed,
      stake,
      spinCount
    );

    // Transfer credits: play fee human → machine, reward machine → human
    _settleCredits(humanId, machineId, playFee, totalReward);

    // Update seat action tracking
    _updateSeatAfterGamble(seatId);

    emit GambleResult(humanId, machineId, spinCount, totalReward, playFee);
  }

  /**
   * @dev Validate all preconditions for a gamble transaction.
   */
  function _validateGamble(
    uint256 humanId,
    uint256 trackerId,
    uint256 seatId,
    uint256 machineId,
    uint8 spinCount
  ) internal view {
    // Validate assets & ownership
    {
      Asset storage human = _getExistingAsset(humanId);
      if (human.owner != msg.sender) revert NotOwner();
      if (human.kind != KIND_HUMAN) revert AssetTypeMismatch();

      Asset storage tracker = _getExistingAsset(trackerId);
      if (tracker.owner != msg.sender) revert NotOwner();
      if (tracker.kind != KIND_TRACKER) revert AssetTypeMismatch();
    }

    bytes32 sp;
    bytes32 mp;
    {
      Asset storage seat = _getExistingAsset(seatId);
      if (seat.kind != KIND_SEAT) revert AssetTypeMismatch();

      Asset storage machine = _getExistingAsset(machineId);
      if (machine.kind != KIND_BANDIT) revert AssetTypeMismatch();

      sp = seat.payload;
      mp = machine.payload;
    }

    // Validate links
    if (_humanSeatId(assets[humanId].payload) != uint32(seatId))
      revert NotSeated();
    if (_seatPlayerId(sp) != uint32(humanId)) revert SeatPlayerMismatch();
    if (_seatMachineId(sp) != uint32(machineId))
      revert SeatNotLinkedToMachine();

    // Validate spin count
    if (spinCount == 0 || spinCount > _banditMaxSpins(mp))
      revert InvalidSpinCount();

    // Validate cooldown
    {
      uint256 resStart = uint256(_seatReservationStartBlock(sp));
      uint256 lastAction = resStart +
        uint256(_seatLastActionBlockOffset(sp));
      if (
        lastAction + GAMBLE_COOLDOWN > block.number &&
        _seatPlayerActionCount(sp) > 0
      ) revert CooldownNotExpired();
    }

    // Check balances
    {
      uint256 playFee = uint256(spinCount);
      uint256 maxReward = _maxMachineReward(_banditStake(mp), spinCount);
      if (assetBalances[humanId] < playFee) revert InsufficientCredits();
      if (assetBalances[machineId] < maxReward)
        revert MachineCantCoverReward();
    }
  }

  /**
   * @dev Execute spins and update tracker payload.
   * @return totalReward Total credits won across all spins.
   */
  function _executeSpins(
    uint256 humanId,
    uint256 trackerId,
    bytes32 randomSeed,
    uint256 stake,
    uint8 spinCount
  ) internal returns (uint256 totalReward) {
    bytes32 tp = assets[trackerId].payload;

    // Clear all tracker slots
    tp = tp.writeUint32LE(12, 0); // LastReward = 0
    for (uint8 i = 0; i < BANDIT_MAX_SPINS; i++) {
      tp = _writeTrackerSlot(tp, i, bytes3(0));
    }

    for (uint8 i = 0; i < spinCount; i++) {
      uint8 offset = i * 5;
      uint8 s1 = _getSlot(uint8(randomSeed[offset]));
      uint8 s2 = _getSlot(uint8(randomSeed[offset + 1]));
      uint8 s3 = _getSlot(uint8(randomSeed[offset + 2]));
      uint8 b1 = _getSlot(uint8(randomSeed[offset + 3]));
      uint8 b2 = _getSlot(uint8(randomSeed[offset + 4]));

      uint256 reward = _singleSpinReward(stake, s1, s2, s3, b1, b2);
      totalReward += reward;

      tp = _writeTrackerSlot(tp, i, _packSpinResult(s1, s2, s3, b1, b2));

      emit SpinResult(humanId, i, s1, s2, s3, b1, b2, reward);
    }

    // Write LastReward and persist
    tp = tp.writeUint32LE(12, uint32(totalReward));
    assets[trackerId].payload = tp;
  }

  /**
   * @dev Transfer play fee and reward between human and machine.
   */
  function _settleCredits(
    uint256 humanId,
    uint256 machineId,
    uint256 playFee,
    uint256 totalReward
  ) internal {
    // Pay play fee: human → machine
    assetBalances[humanId] -= playFee;
    assetBalances[machineId] += playFee;

    // Pay reward: machine → human
    if (totalReward > 0) {
      uint256 machineBal = assetBalances[machineId];
      uint256 payout = totalReward > machineBal ? machineBal : totalReward;
      assetBalances[machineId] -= payout;
      assetBalances[humanId] += payout;
    }
  }

  /**
   * @dev Update seat's action tracking after a gamble.
   */
  function _updateSeatAfterGamble(uint256 seatId) internal {
    bytes32 sp = assets[seatId].payload;
    uint256 resStart = uint256(_seatReservationStartBlock(sp));

    uint16 actionCount = _seatPlayerActionCount(sp);
    sp = sp.writeUint16LE(22, actionCount + 1);

    uint256 blockOffset = block.number - resStart;
    sp = sp.writeUint16LE(
      20,
      blockOffset > type(uint16).max ? type(uint16).max : uint16(blockOffset)
    );
    assets[seatId].payload = sp;
  }

  // ================================================================
  //                     INTERNAL HELPERS
  // ================================================================

  /**
   * @dev Clear seat reservation fields (release / kick shared logic).
   */
  function _releaseSeat(bytes32 sp) internal pure returns (bytes32) {
    sp = sp.writeUint32LE(24, 0); // PlayerId = 0
    sp = sp.writeUint32LE(12, 0); // ReservationStartBlock = 0
    sp = sp.writeByte(16, 0); // ReservationDuration = None
    sp = sp.writeUint16LE(20, 0); // LastActionBlockOffset = 0
    sp = sp.writeUint16LE(22, 0); // PlayerActionCount = 0
    return sp;
  }
}
