# CasinoJam — API Reference

Complete function reference for the CasinoJam contract. Functions are
grouped by visibility and purpose.

---

## Table of Contents

1. [External — Player & Machine Creation](#external--player--machine-creation)
2. [External — Machine Configuration](#external--machine-configuration)
3. [External — Deposit & Withdraw](#external--deposit--withdraw)
4. [External — Seat Management](#external--seat-management)
5. [External — Gamble](#external--gamble)
6. [External — Owner Configuration](#external--owner-configuration)
7. [External — View Helpers](#external--view-helpers)
8. [Internal — Payload Read Helpers](#internal--payload-read-helpers)
9. [Internal — Duration & Fee Calculations](#internal--duration--fee-calculations)
10. [Internal — Spin Engine](#internal--spin-engine)
11. [Internal — Game Logic Helpers](#internal--game-logic-helpers)

---

## External — Player & Machine Creation

### `createPlayer() → (uint256 humanId, uint256 trackerId)`

Create a player's Human + Tracker asset pair. One per account.

| Returns | Type | Description |
|---------|------|-------------|
| `humanId` | `uint256` | ID of the newly minted Human asset |
| `trackerId` | `uint256` | ID of the newly minted Tracker asset |

**Reverts**: `PlayerAlreadyExists()` — caller already has a player.

**Side effects**:
- Mints two assets to `msg.sender` (Human + Tracker).
- Sets `playerHumanId[msg.sender]` and `playerTrackerId[msg.sender]`.
- Emits `PlayerCreated(address, uint256, uint256)`.

---

### `createMachine() → uint256 machineId`

Create a Bandit (slot machine) asset. One per account.

| Returns | Type | Description |
|---------|------|-------------|
| `machineId` | `uint256` | ID of the newly minted Bandit asset |

**Default configuration**: `SeatLimit=1`, `MaxSpins=4`, `Stake=1 credit`
(`Value1Factor=0`, `Value1Multiplier=1`).

**Reverts**: `MachineAlreadyExists()` — caller already has a machine.

**Side effects**:
- Mints one Bandit asset to `msg.sender`.
- Sets `playerMachineId[msg.sender]`.
- Emits `MachineCreated(address, uint256)`.

---

## External — Machine Configuration

### `configMachine(uint256 machineId, uint8 seatLimit, uint8 maxSpins, uint8 value1Factor, uint8 value1Multiplier)`

Configure a Bandit machine's parameters. Machine must have **no linked
seats** (`SeatLinked == 0`).

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `machineId` | `uint256` | — | Bandit asset ID |
| `seatLimit` | `uint8` | 1–15 | Maximum number of concurrent seats |
| `maxSpins` | `uint8` | 1–4 | Maximum spins per gamble |
| `value1Factor` | `uint8` | 0–6 | Stake factor (TokenType enum) |
| `value1Multiplier` | `uint8` | 0–9 | Stake multiplier (MultiplierType enum) |

**Stake**: $10^{\text{value1Factor}} \times \text{value1Multiplier}$ credits.

**Reverts**:
- `NotOwner()` — caller doesn't own the machine.
- `AssetTypeMismatch()` — asset is not a Bandit.
- `WithdrawBlockedByLinkedSeats()` — machine has active seats.
- `InvalidParameter()` — `seatLimit` is 0 or > 15.
- `InvalidSpinCount()` — `maxSpins` is 0 or > `BANDIT_MAX_SPINS`.

**Emits**: `MachineConfigured(uint256 machineId)`.

---

## External — Deposit & Withdraw

### `deposit(uint256 assetId, uint256 creditAmount)` **payable**

Deposit ETH to an asset's credit balance (Human or Bandit only).

| Parameter | Type | Description |
|-----------|------|-------------|
| `assetId` | `uint256` | Human or Bandit asset ID |
| `creditAmount` | `uint256` | Number of credits to purchase |

**ETH required**: `creditAmount × exchangeRate` wei.

**Reverts**:
- `ZeroCreditDeposit()` — `creditAmount == 0`.
- `NotOwner()` — caller doesn't own the asset.
- `AssetTypeMismatch()` — asset is not Human or Bandit.
- `InsufficientPayment()` — `msg.value < creditAmount × exchangeRate`.

**Side effects**:
- Increments `assetBalances[assetId]`.
- Excess ETH (above cost) credited to `pendingWithdrawals[msg.sender]`.
- Emits `CreditsDeposited(uint256, address, uint256)`.

---

### `withdrawCredits(uint256 assetId, uint256 creditAmount)`

Withdraw credits from an asset, converting back to wei via pull-payment.

| Parameter | Type | Description |
|-----------|------|-------------|
| `assetId` | `uint256` | Human or Bandit asset ID |
| `creditAmount` | `uint256` | Number of credits to withdraw |

**Reverts**:
- `ZeroCreditDeposit()` — `creditAmount == 0`.
- `NotOwner()` — caller doesn't own the asset.
- `AssetTypeMismatch()` — asset is not Human or Bandit.
- `WithdrawBlockedByLinkedSeats()` — Bandit has linked seats.
- `InsufficientCredits()` — balance too low.

**Side effects**:
- Decrements `assetBalances[assetId]`.
- Adds `creditAmount × exchangeRate` to `pendingWithdrawals[msg.sender]`.
- Emits `CreditsWithdrawn(uint256, address, uint256, uint256)`.

---

## External — Seat Management

### `rent(uint256 machineId, uint8 rentDuration) → uint256 seatId`

Create a new Seat on a machine. Caller must own the Bandit.

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `machineId` | `uint256` | — | Bandit asset ID |
| `rentDuration` | `uint8` | 1–9 | `RentDuration` enum value |

| Returns | Type | Description |
|---------|------|-------------|
| `seatId` | `uint256` | ID of the newly created Seat asset |

**Rent fee**: `BASE_RENT_FEE (10) × rentDuration` credits, deducted from the
machine's balance and sent to `collectedFees`.

**Reverts**:
- `InvalidRentDuration()` — value out of range.
- `NotOwner()` — caller doesn't own the machine.
- `AssetTypeMismatch()` — not a Bandit.
- `NoSeatsAvailable()` — `SeatLinked >= SeatLimit`.
- `InsufficientCredits()` — machine can't pay rent fee.
- `MachineCantCoverReward()` — machine can't cover max reward for all seats.

**Emits**: `SeatRented(uint256 machineId, uint256 seatId, uint8 rentDuration)`.

---

### `reserve(uint256 humanId, uint256 seatId, uint8 reservationDuration)`

Reserve a Seat — link a player to a machine for play.

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `humanId` | `uint256` | — | Player's Human asset ID |
| `seatId` | `uint256` | — | Seat to occupy |
| `reservationDuration` | `uint8` | 1–12 | `ReservationDuration` enum value |

**Reservation fee**: `PlayerFee × reservationDuration` credits, transferred
from the Human's balance to the Seat's balance.

**Reverts**:
- `InvalidReservationDuration()` — value out of range.
- `NotOwner()` — caller doesn't own the Human.
- `AssetTypeMismatch()` — wrong asset type.
- `AlreadySeated()` — Human already at a seat.
- `SeatOccupied()` — Seat already has a player.
- `SeatExpiredForReservation()` — remaining rent time < requested reservation.
- `MachineCantCoverReward()` — machine balance too low.
- `InsufficientCredits()` — Human can't pay reservation fee.

**Emits**: `SeatReserved(uint256, uint256, uint8, uint256)`.

---

### `release(uint256 humanId, uint256 seatId)`

Voluntarily leave a Seat. Refunds reservation fee minus 1% usage fee.

| Parameter | Type | Description |
|-----------|------|-------------|
| `humanId` | `uint256` | Player's Human asset ID |
| `seatId` | `uint256` | Seat to vacate |

**Refund calculation**:
```
fullFee   = PlayerFee × ReservationDuration
usageFee  = 1% of fullFee
refund    = fullFee − usageFee   (capped at seat balance)
```

**Reverts**:
- `NotOwner()` — caller doesn't own the Human.
- `AssetTypeMismatch()` — wrong asset type.
- `NotSeated()` — Human or Seat has no active link.
- `SeatPlayerMismatch()` — Human↔Seat IDs don't match.

**Emits**: `SeatReleased(uint256 seatId, uint256 humanId, uint256 refund, uint256 usageFee)`.

---

### `kick(uint256 sniperHumanId, uint256 victimHumanId, uint256 seatId)`

Kick an expired or idle player from a Seat. The kicker (sniper) receives
the entire Seat credit balance as a bounty.

| Parameter | Type | Description |
|-----------|------|-------------|
| `sniperHumanId` | `uint256` | Kicker's Human asset ID |
| `victimHumanId` | `uint256` | Victim's Human asset ID |
| `seatId` | `uint256` | Seat to kick from |

**Kick protection**: A kick is **blocked** when **both** conditions hold:
1. Reservation has not expired (`ReservationStartBlock + duration ≥ block.number`).
2. Grace period is active (`lastActionBlock + PlayerGracePeriod ≥ block.number`).

If either condition fails, the kick is allowed.

**Reverts**:
- `NotOwner()` — caller doesn't own the sniper Human.
- `AssetTypeMismatch()` — wrong asset types.
- `NotSeated()` — victim or seat has no active link.
- `SeatPlayerMismatch()` — victim↔seat IDs don't match.
- `ReservationStillProtected()` — both reservation valid and grace active.

**Emits**: `PlayerKicked(uint256 seatId, uint256 victimId, uint256 sniperId, uint256 bounty)`.

---

### `returnSeat(uint256 machineId, uint256 seatId)`

Return an empty seat to the machine and burn it. Machine owner only.

| Parameter | Type | Description |
|-----------|------|-------------|
| `machineId` | `uint256` | Bandit asset ID |
| `seatId` | `uint256` | Seat to destroy |

**Reverts**:
- `NotOwner()` — caller doesn't own the machine or seat.
- `AssetTypeMismatch()` — wrong asset types.
- `SeatNotLinkedToMachine()` — seat's `MachineId ≠ machineId`.
- `SeatNotEmpty()` — seat has a player (`PlayerId ≠ 0`).

**Side effects**:
- Remaining seat balance converted to wei → `pendingWithdrawals[owner]`.
- Decrements machine's `SeatLinked`.
- Burns the seat asset.
- Emits `SeatReturned(uint256, uint256, uint256)`.

---

## External — Gamble

### `gamble(uint256 humanId, uint256 trackerId, uint256 seatId, uint256 machineId, uint8 spinCount)`

Play the slot machine. Executes `spinCount` spins, settles credits.

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `humanId` | `uint256` | — | Player's Human asset ID |
| `trackerId` | `uint256` | — | Player's Tracker asset ID |
| `seatId` | `uint256` | — | Seat the player is sitting at |
| `machineId` | `uint256` | — | Bandit machine linked to the seat |
| `spinCount` | `uint8` | 1–`MaxSpins` | Number of spins to execute |

**Play fee**: `spinCount` credits (1 credit per spin).

**Reverts**:
- `NotOwner()` — caller doesn't own the Human or Tracker.
- `AssetTypeMismatch()` — wrong asset types.
- `NotSeated()` — Human's `SeatId ≠ seatId`.
- `SeatPlayerMismatch()` — Seat's `PlayerId ≠ humanId`.
- `SeatNotLinkedToMachine()` — Seat's `MachineId ≠ machineId`.
- `InvalidSpinCount()` — `spinCount` is 0 or exceeds machine's `MaxSpins`.
- `CooldownNotExpired()` — must wait `GAMBLE_COOLDOWN` blocks between gambles.
- `InsufficientCredits()` — Human can't afford play fee.
- `MachineCantCoverReward()` — Machine can't cover max potential payout.

**Side effects**:
- Deducts play fee from Human, adds to Machine.
- Transfers reward from Machine to Human.
- Updates Tracker payload with spin results.
- Updates Seat's `LastActionBlockOffset` and `PlayerActionCount`.
- Emits `SpinResult(...)` for each spin.
- Emits `GambleResult(uint256, uint256, uint8, uint256, uint256)`.

---

## External — Owner Configuration

### `setExchangeRate(uint256 newRate)`

Update the ETH↔credit exchange rate. **Owner only.**

| Parameter | Type | Description |
|-----------|------|-------------|
| `newRate` | `uint256` | New wei-per-credit rate (must be > 0) |

**Reverts**: `InvalidExchangeRate()`, `NotContractOwner()`.

**Emits**: `ExchangeRateChanged(uint256, uint256)`.

---

### `setRngContract(address newAddr)`

Update the InsecureRandomness contract address. **Owner only.**

| Parameter | Type | Description |
|-----------|------|-------------|
| `newAddr` | `address` | New RNG contract (must not be zero) |

**Reverts**: `InvalidRngContract()`, `NotContractOwner()`.

**Emits**: `RngContractChanged(address, address)`.

---

## External — View Helpers

### `getAssetBalance(uint256 assetId) → uint256`

Return the credit balance of an asset.

---

## Internal — Payload Read Helpers

These functions read packed fields from `bytes32` payloads using
`PayloadLib`.

### Bandit payload readers

| Function | Returns | Description |
|----------|---------|-------------|
| `_banditSeatLinked(bytes32)` | `uint8` | High nibble of byte 7 — linked seat count |
| `_banditSeatLimit(bytes32)` | `uint8` | Low nibble of byte 7 — seat capacity |
| `_banditMaxSpins(bytes32)` | `uint8` | Low nibble of byte 15 — max spins |
| `_banditValue1Factor(bytes32)` | `uint8` | High nibble of byte 8 — stake factor |
| `_banditValue1Multiplier(bytes32)` | `uint8` | Low nibble of byte 8 — stake multiplier |
| `_banditStake(bytes32)` | `uint256` | Computed: `10^factor × multiplier` |

### Seat payload readers

| Function | Returns | Description |
|----------|---------|-------------|
| `_seatCreationBlock(bytes32)` | `uint32` | LE uint32 at bytes 1–4 |
| `_seatRentDuration(bytes32)` | `uint8` | Byte 7 |
| `_seatPlayerFee(bytes32)` | `uint16` | LE uint16 at bytes 8–9 |
| `_seatPlayerGracePeriod(bytes32)` | `uint8` | Byte 11 |
| `_seatReservationStartBlock(bytes32)` | `uint32` | LE uint32 at bytes 12–15 |
| `_seatReservationDuration(bytes32)` | `uint8` | Byte 16 |
| `_seatLastActionBlockOffset(bytes32)` | `uint16` | LE uint16 at bytes 20–21 |
| `_seatPlayerActionCount(bytes32)` | `uint16` | LE uint16 at bytes 22–23 |
| `_seatPlayerId(bytes32)` | `uint32` | LE uint32 at bytes 24–27 |
| `_seatMachineId(bytes32)` | `uint32` | LE uint32 at bytes 28–31 |

### Human payload reader

| Function | Returns | Description |
|----------|---------|-------------|
| `_humanSeatId(bytes32)` | `uint32` | LE uint32 at bytes 28–31 |

---

## Internal — Duration & Fee Calculations

| Function | Signature | Description |
|----------|-----------|-------------|
| `_rentDurationDays` | `(uint8) → uint256` | Maps enum (1–9) → days (1–112) |
| `_rentDurationBlocks` | `(uint8) → uint256` | Days × `BLOCKS_PER_DAY` |
| `_rentFee` | `(uint8) → uint256` | `BASE_RENT_FEE × enum_value` |
| `_reservationDurationMultiplier` | `(uint8) → uint256` | Maps enum (1–12) → 5-min-increments |
| `_reservationDurationBlocks` | `(uint8) → uint256` | Multiplier × `BASE_RESERVATION_TIME` |
| `_reservationFee` | `(uint16, uint8) → uint256` | `playerFee × reservationDuration` |

---

## Internal — Spin Engine

| Function | Signature | Description |
|----------|-----------|-------------|
| `_getSlot` | `(uint8) → uint8` | Weighted symbol selection (0–9) |
| `_slotRewardFactor` | `(uint8) → uint256` | Three-of-a-kind payout multiplier |
| `_bonusRewardFactor` | `(uint8) → uint256` | Bonus pair payout multiplier |
| `_singleSpinReward` | `(uint256, uint8×5) → uint256` | Full spin reward computation |
| `_packSpinResult` | `(uint8×5) → bytes3` | Pack 5 reel values into 3 bytes |
| `_writeTrackerSlot` | `(bytes32, uint8, bytes3) → bytes32` | Write packed spin to tracker |
| `_maxMachineReward` | `(uint256, uint8) → uint256` | `stake × 8192 × spinCount` |

See [SPIN-ENGINE.md](SPIN-ENGINE.md) for detailed mechanics.

---

## Internal — Game Logic Helpers

| Function | Signature | Description |
|----------|-----------|-------------|
| `_validateGamble` | `(uint256×4, uint8) → void` | Pre-gamble validation (all checks) |
| `_executeSpins` | `(uint256×2, bytes32, uint256, uint8) → uint256` | Run spins, update tracker |
| `_settleCredits` | `(uint256×2, uint256×2) → void` | Pay fee & reward between human/machine |
| `_updateSeatAfterGamble` | `(uint256) → void` | Update seat action tracking |
| `_releaseSeat` | `(bytes32) → bytes32` | Clear reservation fields on seat payload |
| `_checkKickAllowed` | `(bytes32) → void` | Validate kick based on expiry + grace |
