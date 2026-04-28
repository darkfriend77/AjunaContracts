# CasinoJam — Spin Engine

Detailed specification of the slot machine mechanics: symbol distribution,
reward calculation, and payout tables.

---

## Table of Contents

1. [Overview](#overview)
2. [Symbol Table](#symbol-table)
3. [Weighted Distribution](#weighted-distribution)
4. [Reel Layout](#reel-layout)
5. [Reward Calculation](#reward-calculation)
6. [Three-of-a-Kind Rewards](#three-of-a-kind-rewards)
7. [Bonus Pair Rewards](#bonus-pair-rewards)
8. [Combined Reward Logic](#combined-reward-logic)
9. [Full-Line Bonus](#full-line-bonus)
10. [Maximum Payout](#maximum-payout)
11. [Randomness Source](#randomness-source)
12. [Tracker Storage](#tracker-storage)
13. [Examples](#examples)

---

## Overview

Each gamble executes 1–4 **spins**. Each spin produces 5 reel symbols:
3 main slots + 2 bonus reels. Rewards are calculated per spin, then
summed.

```
┌─────────────────────────┐
│  Slot1  Slot2  Slot3    │  ← 3 main reels (three-of-a-kind check)
│  Bonus1       Bonus2    │  ← 2 bonus reels (pair check)
└─────────────────────────┘
```

---

## Symbol Table

| ID | Symbol | Description |
|----|--------|-------------|
| 0 | BLANK | No symbol — no payout |
| 1 | CHERRY | Lowest-value fruit |
| 2 | LEMON | Common fruit |
| 3 | ORANGE | Common fruit |
| 4 | PLUM | Mid-tier fruit |
| 5 | WATERMELON | Mid-tier fruit |
| 6 | GRAPE | High-value fruit |
| 7 | BELL | Classic high-value |
| 8 | BAR | Premium symbol |
| 9 | DIAMOND | Jackpot symbol — rarest |

---

## Weighted Distribution

Symbols are selected via a weighted random lookup from a single byte
(0–255). The function `_getSlot(uint8 v)` maps the byte to a symbol:

| Symbol | Range | Weight | Probability |
|--------|-------|--------|-------------|
| BLANK | 0–51 | 52 | 20.31% |
| CHERRY | 52–94 | 43 | 16.80% |
| LEMON | 95–132 | 38 | 14.84% |
| ORANGE | 133–166 | 34 | 13.28% |
| PLUM | 167–194 | 28 | 10.94% |
| WATERMELON | 195–217 | 23 | 8.98% |
| GRAPE | 218–234 | 17 | 6.64% |
| BELL | 235–246 | 12 | 4.69% |
| BAR | 247–252 | 6 | 2.34% |
| DIAMOND | 253–255 | 3 | 1.17% |
| **Total** | | **256** | **100.00%** |

> The distribution creates a natural house edge — valuable symbols appear
> far less frequently than blanks and common fruits.

---

## Reel Layout

Each spin consumes **5 random bytes** from the seed. For spin `i`, bytes
at offsets `i*5` through `i*5+4` are used:

| Random byte offset | Reel |
|--------------------|------|
| `i*5 + 0` | Slot 1 |
| `i*5 + 1` | Slot 2 |
| `i*5 + 2` | Slot 3 |
| `i*5 + 3` | Bonus 1 |
| `i*5 + 4` | Bonus 2 |

With up to 4 spins, a total of 20 bytes from the 32-byte random seed
are consumed.

---

## Reward Calculation

Reward for a single spin is computed by `_singleSpinReward()`. The
algorithm has four cases evaluated in priority order:

### Case 1: Full Line

When **all 5 reels show the same non-blank symbol**
(`slot1 == slot2 == slot3 == bonus1 == bonus2`, and `slot1 ≠ 0`):

$$\text{reward} = \text{slotFactor}(s) \times \text{stake} \times \frac{128}{\text{bonusFactor}(s) \times \text{stake}}$$

### Case 2: Three-of-a-Kind + Bonus Pair (Different Symbols)

When main reels match (three-of-a-kind) and bonus reels match (pair),
but they are different symbols:

$$\text{reward} = (\text{slotFactor}(s_{\text{main}}) \times \text{stake}) + 32 \times (\text{bonusFactor}(s_{\text{bonus}}) \times \text{stake})$$

### Case 3: Three-of-a-Kind Only

When main reels match but bonus reels don't:

$$\text{reward} = \text{slotFactor}(s) \times \text{stake}$$

### Case 4: Bonus Pair Only

When only bonus reels match (no three-of-a-kind):

$$\text{reward} = \frac{\text{bonusFactor}(s) \times \text{stake}}{\text{stake}} = \text{bonusFactor}(s)$$

### Case 5: Nothing

No matches → reward = 0.

---

## Three-of-a-Kind Rewards

The `_slotRewardFactor()` function returns the payout multiplier when
all 3 main reels show the same symbol:

| Symbol | Factor | Stake=1 | Stake=10 | Stake=100 |
|--------|--------|---------|----------|-----------|
| BLANK | 0 | 0 | 0 | 0 |
| CHERRY | 5 | 5 | 50 | 500 |
| LEMON | 10 | 10 | 100 | 1,000 |
| ORANGE | 25 | 25 | 250 | 2,500 |
| PLUM | 50 | 50 | 500 | 5,000 |
| WATERMELON | 100 | 100 | 1,000 | 10,000 |
| GRAPE | 200 | 200 | 2,000 | 20,000 |
| BELL | 500 | 500 | 5,000 | 50,000 |
| BAR | 750 | 750 | 7,500 | 75,000 |
| DIAMOND | 1,500 | 1,500 | 15,000 | 150,000 |

$$\text{Three-of-a-kind payout} = \text{factor} \times \text{stake}$$

---

## Bonus Pair Rewards

The `_bonusRewardFactor()` function returns the payout multiplier when
both bonus reels show the same symbol:

| Symbol | Factor | Category |
|--------|--------|----------|
| BLANK | 0 | No payout |
| CHERRY | 1 | Low |
| LEMON | 2 | Medium |
| ORANGE | 2 | Medium |
| PLUM | 2 | Medium |
| WATERMELON | 2 | Medium |
| GRAPE | 4 | High |
| BELL | 4 | High |
| BAR | 4 | High |
| DIAMOND | 8 | Jackpot |

$$\text{Bonus-only payout} = \frac{\text{factor} \times \text{stake}}{\text{stake}} = \text{factor}$$

> When a bonus pair occurs **without** a three-of-a-kind, the reward
> is just the factor value (independent of stake). This is intentional —
> bonus-only payouts are small consolation prizes.

---

## Combined Reward Logic

The full reward logic in pseudocode:

```
function singleSpinReward(stake, slot1, slot2, slot3, bonus1, bonus2):
    sFactor = 0
    bFactor = 0

    // Three-of-a-kind?
    if slot1 == slot2 == slot3 and slot1 != BLANK:
        sFactor = slotRewardFactor(slot1) × stake

    // Bonus pair?
    if bonus1 == bonus2 and bonus1 != BLANK:
        bFactor = bonusRewardFactor(bonus1) × stake

    // Full line (all 5 same)?
    isFullLine = (slot1 == bonus1) and sFactor > 0 and bFactor > 0

    reward = sFactor

    if sFactor > 0:
        if isFullLine:
            reward = sFactor × (128 / bFactor)
        else if bFactor > 0:
            reward = sFactor + (32 × bFactor)

    // Bonus-only (no three-of-a-kind)
    if reward == 0 and stake > 0:
        reward = bFactor / stake

    return reward
```

---

## Full-Line Bonus

A full line occurs when all 5 reels show the same non-blank symbol.
This is the rarest and highest-paying outcome.

**Probability**: For DIAMOND, approximately $(0.0117)^5 \approx 2.2 \times 10^{-10}$ — essentially astronomical.

The formula `sFactor × (128 / bFactor)` creates a massive multiplier:

| Symbol | sFactor (s=1) | bFactor (s=1) | Full-line reward |
|--------|---------------|---------------|------------------|
| CHERRY | 5 | 1 | 5 × 128 = 640 |
| LEMON | 10 | 2 | 10 × 64 = 640 |
| ORANGE | 25 | 2 | 25 × 64 = 1,600 |
| PLUM | 50 | 2 | 50 × 64 = 3,200 |
| WATERMELON | 100 | 2 | 100 × 64 = 6,400 |
| GRAPE | 200 | 4 | 200 × 32 = 6,400 |
| BELL | 500 | 4 | 500 × 32 = 16,000 (capped at 8,192) |
| BAR | 750 | 4 | 750 × 32 = 24,000 (capped at 8,192) |
| DIAMOND | 1,500 | 8 | 1500 × 16 = 24,000 (capped at 8,192) |

> Note: The constant `SINGLE_SPIN_MAX_REWARD = 8192` is used only for
> machine solvency checks, not as a hard cap on actual payouts. The reward
> calculation itself has no cap.

---

## Maximum Payout

The worst-case payout per gamble (used for machine solvency checks):

$$\text{maxMachineReward} = \text{stake} \times 8192 \times \text{spinCount}$$

For default configuration (stake=1, maxSpins=4):

$$\text{max} = 1 \times 8192 \times 4 = 32{,}768 \text{ credits}$$

The machine must always hold at least this amount for each linked seat.
Total required balance:

$$\text{required} = \text{maxMachineReward} \times \text{SeatLinked}$$

---

## Randomness Source

Random values come from the `InsecureRandomness` contract via:

```solidity
bytes32 randomSeed = IInsecureRandomness(rngContract).randomValue(
    abi.encodePacked("gamble", msg.sender, humanId, block.number)
);
```

The seed is deterministic based on the caller, their Human ID, and the
current block number. This means:
- Same block + same caller = same results (hence the 1-block cooldown).
- The randomness is **insecure** (predictable by miners/validators).

> ⚠️ The `InsecureRandomness` contract is for prototyping only. Production
> deployments should use a VRF (Verifiable Random Function) like Chainlink
> VRF.

---

## Tracker Storage

After each gamble, the Tracker asset's payload is updated:

1. All 4 spin slots (bytes 16–27) are **cleared**.
2. For each executed spin (up to `spinCount`), the packed result is written
   at its slot offset:
   - Slot 0: bytes 16–18
   - Slot 1: bytes 19–21
   - Slot 2: bytes 22–24
   - Slot 3: bytes 25–27
3. `LastReward` (bytes 12–15) is set to the total reward.

### Packed format per spin (3 bytes)

```
Byte 0: [Slot1:4][Slot2:4]
Byte 1: [Slot3:4][0000:4]
Byte 2: [Bonus1:4][Bonus2:4]
```

Front-ends can read the tracker payload to reconstruct the last gamble's
results without relying on event logs.

---

## Examples

### Example 1: Three Cherries

```
Slot1=1(CHERRY)  Slot2=1(CHERRY)  Slot3=1(CHERRY)  Bonus1=3  Bonus2=7
Stake = 1

Three-of-a-kind: sFactor = 5 × 1 = 5
Bonus pair: none (3 ≠ 7)
Full line: no

Reward = 5 credits
```

### Example 2: Three Bells + Bonus Diamond Pair

```
Slot1=7(BELL)  Slot2=7(BELL)  Slot3=7(BELL)  Bonus1=9(DIAMOND)  Bonus2=9(DIAMOND)
Stake = 10

Three-of-a-kind: sFactor = 500 × 10 = 5,000
Bonus pair: bFactor = 8 × 10 = 80
Full line: no (7 ≠ 9)

Reward = 5,000 + (32 × 80) = 5,000 + 2,560 = 7,560 credits
```

### Example 3: Five Diamonds (Full Line)

```
Slot1=9  Slot2=9  Slot3=9  Bonus1=9  Bonus2=9
Stake = 1

Three-of-a-kind: sFactor = 1,500 × 1 = 1,500
Bonus pair: bFactor = 8 × 1 = 8
Full line: yes (slot1 == bonus1)

Reward = 1,500 × (128 / 8) = 1,500 × 16 = 24,000 credits
```

### Example 4: Bonus Only

```
Slot1=2  Slot2=5  Slot3=8  Bonus1=6(GRAPE)  Bonus2=6(GRAPE)
Stake = 10

Three-of-a-kind: none (2 ≠ 5 ≠ 8)
Bonus pair: bFactor = 4 × 10 = 40
Full line: no

sFactor = 0, so reward = bFactor / stake = 40 / 10 = 4 credits
```

### Example 5: All Blanks

```
Slot1=0  Slot2=0  Slot3=0  Bonus1=0  Bonus2=0
Stake = 100

Three-of-a-kind: blanks don't count (slot1 == 0)
Bonus pair: blanks don't count (bonus1 == 0)

Reward = 0 credits
```
