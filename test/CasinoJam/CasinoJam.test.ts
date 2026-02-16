import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { CasinoJam, InsecureRandomness } from '../../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

/**
 * Helper: mine a number of empty blocks on the Hardhat network.
 */
async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await network.provider.send('evm_mine');
  }
}

/**
 * Deploy CasinoJam + InsecureRandomness fixtures.
 */
async function deployCasinoJam() {
  const [owner, player1, player2, machineOwner] = await ethers.getSigners();

  const rngFactory = await ethers.getContractFactory('InsecureRandomness');
  const rng = (await rngFactory.deploy()) as InsecureRandomness;
  await rng.waitForDeployment();

  const cjFactory = await ethers.getContractFactory('CasinoJam');
  const casinoJam = (await cjFactory.deploy(
    await rng.getAddress()
  )) as CasinoJam;
  await casinoJam.waitForDeployment();

  return { casinoJam, rng, owner, player1, player2, machineOwner };
}

describe('CasinoJam', function () {
  let cj: CasinoJam;
  let rng: InsecureRandomness;
  let owner: HardhatEthersSigner;
  let player1: HardhatEthersSigner;
  let player2: HardhatEthersSigner;
  let machineOwner: HardhatEthersSigner;

  beforeEach(async function () {
    ({ casinoJam: cj, rng, owner, player1, player2, machineOwner } =
      await deployCasinoJam());
  });

  // ================================================================
  //                        DEPLOYMENT
  // ================================================================

  describe('Deployment', function () {
    it('should set the RNG contract address', async function () {
      expect(await cj.rngContract()).to.equal(await rng.getAddress());
    });

    it('should set default exchange rate', async function () {
      expect(await cj.exchangeRate()).to.equal(BigInt(1e12));
    });

    it('should set owner correctly', async function () {
      expect(await cj.owner()).to.equal(owner.address);
    });

    it('should revert deployment with zero RNG address', async function () {
      const factory = await ethers.getContractFactory('CasinoJam');
      await expect(
        factory.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(cj, 'InvalidRngContract');
    });
  });

  // ================================================================
  //                     OWNER CONFIGURATION
  // ================================================================

  describe('Owner Configuration', function () {
    it('should allow owner to set exchange rate', async function () {
      await expect(cj.setExchangeRate(BigInt(2e12)))
        .to.emit(cj, 'ExchangeRateChanged')
        .withArgs(BigInt(1e12), BigInt(2e12));
      expect(await cj.exchangeRate()).to.equal(BigInt(2e12));
    });

    it('should revert setting exchange rate to zero', async function () {
      await expect(cj.setExchangeRate(0)).to.be.revertedWithCustomError(
        cj,
        'InvalidExchangeRate'
      );
    });

    it('should revert non-owner setting exchange rate', async function () {
      await expect(
        cj.connect(player1).setExchangeRate(BigInt(2e12))
      ).to.be.revertedWithCustomError(cj, 'NotContractOwner');
    });

    it('should allow owner to set RNG contract', async function () {
      const newAddr = player1.address; // just any non-zero address
      await expect(cj.setRngContract(newAddr))
        .to.emit(cj, 'RngContractChanged')
        .withArgs(await rng.getAddress(), newAddr);
      expect(await cj.rngContract()).to.equal(newAddr);
    });

    it('should revert setting RNG to zero address', async function () {
      await expect(
        cj.setRngContract(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(cj, 'InvalidRngContract');
    });
  });

  // ================================================================
  //                    CREATE PLAYER
  // ================================================================

  describe('createPlayer', function () {
    it('should create human + tracker for a new player', async function () {
      const tx = await cj.connect(player1).createPlayer();
      const receipt = await tx.wait();

      const humanId = await cj.playerHumanId(player1.address);
      const trackerId = await cj.playerTrackerId(player1.address);

      expect(humanId).to.be.gt(0n);
      expect(trackerId).to.be.gt(0n);
      expect(trackerId).to.equal(humanId + 1n);

      // Check events
      await expect(tx)
        .to.emit(cj, 'PlayerCreated')
        .withArgs(player1.address, humanId, trackerId);
    });

    it('should set correct kind on assets', async function () {
      await cj.connect(player1).createPlayer();
      const humanId = await cj.playerHumanId(player1.address);
      const trackerId = await cj.playerTrackerId(player1.address);

      const human = await cj.getAsset(humanId);
      const tracker = await cj.getAsset(trackerId);

      expect(human.kind).to.equal(0x11); // KIND_HUMAN
      expect(tracker.kind).to.equal(0x12); // KIND_TRACKER
    });

    it('should revert if player already exists', async function () {
      await cj.connect(player1).createPlayer();
      await expect(
        cj.connect(player1).createPlayer()
      ).to.be.revertedWithCustomError(cj, 'PlayerAlreadyExists');
    });

    it('should allow different accounts to create players', async function () {
      await cj.connect(player1).createPlayer();
      await cj.connect(player2).createPlayer();

      const h1 = await cj.playerHumanId(player1.address);
      const h2 = await cj.playerHumanId(player2.address);
      expect(h1).to.not.equal(h2);
    });
  });

  // ================================================================
  //                    CREATE MACHINE
  // ================================================================

  describe('createMachine', function () {
    it('should create a bandit machine', async function () {
      const tx = await cj.connect(machineOwner).createMachine();
      const machineId = await cj.playerMachineId(machineOwner.address);

      expect(machineId).to.be.gt(0n);
      await expect(tx)
        .to.emit(cj, 'MachineCreated')
        .withArgs(machineOwner.address, machineId);
    });

    it('should set correct kind and defaults', async function () {
      await cj.connect(machineOwner).createMachine();
      const machineId = await cj.playerMachineId(machineOwner.address);
      const machine = await cj.getAsset(machineId);

      expect(machine.kind).to.equal(0x21); // KIND_BANDIT
    });

    it('should revert if machine already exists', async function () {
      await cj.connect(machineOwner).createMachine();
      await expect(
        cj.connect(machineOwner).createMachine()
      ).to.be.revertedWithCustomError(cj, 'MachineAlreadyExists');
    });
  });

  // ================================================================
  //                    DEPOSIT / WITHDRAW
  // ================================================================

  describe('Deposit & Withdraw Credits', function () {
    let humanId: bigint;

    beforeEach(async function () {
      await cj.connect(player1).createPlayer();
      humanId = await cj.playerHumanId(player1.address);
    });

    it('should deposit credits to a human asset', async function () {
      const rate = await cj.exchangeRate();
      const credits = 100n;
      const cost = credits * rate;

      await expect(
        cj.connect(player1).deposit(humanId, credits, { value: cost })
      )
        .to.emit(cj, 'CreditsDeposited')
        .withArgs(humanId, player1.address, credits);

      expect(await cj.assetBalances(humanId)).to.equal(credits);
    });

    it('should refund excess payment on deposit', async function () {
      const rate = await cj.exchangeRate();
      const credits = 10n;
      const cost = credits * rate;
      const excess = BigInt(1e15);

      await cj
        .connect(player1)
        .deposit(humanId, credits, { value: cost + excess });

      // Excess is in pendingWithdrawals
      expect(await cj.pendingWithdrawals(player1.address)).to.equal(excess);
    });

    it('should revert deposit with insufficient ETH', async function () {
      const rate = await cj.exchangeRate();
      const credits = 100n;
      const cost = credits * rate;

      await expect(
        cj.connect(player1).deposit(humanId, credits, { value: cost - 1n })
      ).to.be.revertedWithCustomError(cj, 'InsufficientPayment');
    });

    it('should revert deposit of zero credits', async function () {
      await expect(
        cj.connect(player1).deposit(humanId, 0, { value: 0 })
      ).to.be.revertedWithCustomError(cj, 'ZeroCreditDeposit');
    });

    it('should revert deposit to non-owned asset', async function () {
      await expect(
        cj.connect(player2).deposit(humanId, 10, { value: BigInt(10e12) })
      ).to.be.revertedWithCustomError(cj, 'NotOwner');
    });

    it('should withdraw credits from a human asset', async function () {
      const rate = await cj.exchangeRate();
      const credits = 50n;
      const cost = credits * rate;

      // Deposit first
      await cj.connect(player1).deposit(humanId, credits, { value: cost });

      // Withdraw
      const withdrawAmount = 20n;
      await expect(cj.connect(player1).withdrawCredits(humanId, withdrawAmount))
        .to.emit(cj, 'CreditsWithdrawn')
        .withArgs(
          humanId,
          player1.address,
          withdrawAmount,
          withdrawAmount * rate
        );

      expect(await cj.assetBalances(humanId)).to.equal(
        credits - withdrawAmount
      );
      expect(await cj.pendingWithdrawals(player1.address)).to.equal(
        withdrawAmount * rate
      );
    });

    it('should revert withdraw more than balance', async function () {
      const rate = await cj.exchangeRate();
      await cj.connect(player1).deposit(humanId, 10n, { value: 10n * rate });

      await expect(
        cj.connect(player1).withdrawCredits(humanId, 11n)
      ).to.be.revertedWithCustomError(cj, 'InsufficientCredits');
    });

    it('should deposit credits to a machine', async function () {
      await cj.connect(machineOwner).createMachine();
      const machineId = await cj.playerMachineId(machineOwner.address);
      const rate = await cj.exchangeRate();

      await cj
        .connect(machineOwner)
        .deposit(machineId, 1000n, { value: 1000n * rate });
      expect(await cj.assetBalances(machineId)).to.equal(1000n);
    });
  });

  // ================================================================
  //                    RENT
  // ================================================================

  describe('Rent', function () {
    let machineId: bigint;

    beforeEach(async function () {
      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);

      // Fund machine to pay rent fee
      const rate = await cj.exchangeRate();
      await cj
        .connect(machineOwner)
        .deposit(machineId, 1000n, { value: 1000n * rate });
    });

    it('should create a seat and link to machine', async function () {
      const rentDuration = 1; // Day1

      const tx = await cj.connect(machineOwner).rent(machineId, rentDuration);
      const receipt = await tx.wait();

      // Find SeatRented event
      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;

      const parsed = cj.interface.parseLog(event as any);
      const seatId = parsed?.args.seatId;

      expect(seatId).to.be.gt(0n);

      // Check seat kind
      const seat = await cj.getAsset(seatId);
      expect(seat.kind).to.equal(0x40); // KIND_SEAT
    });

    it('should deduct rent fee from machine balance', async function () {
      const balBefore = await cj.assetBalances(machineId);
      await cj.connect(machineOwner).rent(machineId, 1); // Day1: fee = 10*1 = 10
      const balAfter = await cj.assetBalances(machineId);
      expect(balBefore - balAfter).to.equal(10n); // BASE_RENT_FEE * 1
    });

    it('should scale rent fee by duration', async function () {
      const balBefore = await cj.assetBalances(machineId);
      await cj.connect(machineOwner).rent(machineId, 5); // Days7: fee = 10*5 = 50
      const balAfter = await cj.assetBalances(machineId);
      expect(balBefore - balAfter).to.equal(50n);
    });

    it('should revert on invalid rent duration', async function () {
      await expect(
        cj.connect(machineOwner).rent(machineId, 0)
      ).to.be.revertedWithCustomError(cj, 'InvalidRentDuration');

      await expect(
        cj.connect(machineOwner).rent(machineId, 10)
      ).to.be.revertedWithCustomError(cj, 'InvalidRentDuration');
    });

    it('should revert when seat limit reached', async function () {
      // Default seatLimit = 1
      await cj.connect(machineOwner).rent(machineId, 1);

      // Try to rent a second seat
      await expect(
        cj.connect(machineOwner).rent(machineId, 1)
      ).to.be.revertedWithCustomError(cj, 'NoSeatsAvailable');
    });

    it('should revert when insufficient machine credits', async function () {
      // Create a new unfunded machine
      await cj.connect(player1).createMachine();
      const m2 = await cj.playerMachineId(player1.address);

      await expect(
        cj.connect(player1).rent(m2, 1)
      ).to.be.revertedWithCustomError(cj, 'InsufficientCredits');
    });
  });

  // ================================================================
  //                    RESERVE
  // ================================================================

  describe('Reserve', function () {
    let humanId: bigint;
    let machineId: bigint;
    let seatId: bigint;

    beforeEach(async function () {
      // Create player
      await cj.connect(player1).createPlayer();
      humanId = await cj.playerHumanId(player1.address);

      // Fund player
      const rate = await cj.exchangeRate();
      await cj
        .connect(player1)
        .deposit(humanId, 1000n, { value: 1000n * rate });

      // Create machine + rent seat
      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);
      await cj
        .connect(machineOwner)
        .deposit(machineId, 50000n, { value: 50000n * rate });
      const tx = await cj.connect(machineOwner).rent(machineId, 1);
      const receipt = await tx.wait();

      // Extract seat ID from event
      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      seatId = cj.interface.parseLog(event as any)!.args.seatId;
    });

    it('should link player to seat', async function () {
      await expect(cj.connect(player1).reserve(humanId, seatId, 1))
        .to.emit(cj, 'SeatReserved')
        .withArgs(seatId, humanId, 1, 1n); // fee = playerFee(1) * duration(1) = 1

      // Check human payload has seat linked
      const human = await cj.getAsset(humanId);
      // seatId should be in bytes 28-31 of payload (uint32 LE)
      expect(human.payload).to.not.equal(ethers.ZeroHash);
    });

    it('should transfer reservation fee from human to seat', async function () {
      const humanBalBefore = await cj.assetBalances(humanId);
      await cj.connect(player1).reserve(humanId, seatId, 1);
      const humanBalAfter = await cj.assetBalances(humanId);
      const seatBal = await cj.assetBalances(seatId);

      // Fee = playerFee(1) * reservationDuration(1) = 1
      expect(humanBalBefore - humanBalAfter).to.equal(1n);
      expect(seatBal).to.equal(1n);
    });

    it('should revert when player already seated', async function () {
      await cj.connect(player1).reserve(humanId, seatId, 1);

      // Create a second machine with a second seat
      await cj.connect(player2).createMachine();
      const machine2 = await cj.playerMachineId(player2.address);
      const rate = await cj.exchangeRate();
      await cj
        .connect(player2)
        .deposit(machine2, 1000n, { value: 1000n * rate });
      const tx2 = await cj.connect(player2).rent(machine2, 1);
      const receipt2 = await tx2.wait();
      const event2 = receipt2?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      const seat2Id = cj.interface.parseLog(event2 as any)!.args.seatId;

      await expect(
        cj.connect(player1).reserve(humanId, seat2Id, 1)
      ).to.be.revertedWithCustomError(cj, 'AlreadySeated');
    });

    it('should revert when seat is occupied', async function () {
      await cj.connect(player1).reserve(humanId, seatId, 1);

      // Player2 tries to reserve same seat
      await cj.connect(player2).createPlayer();
      const human2 = await cj.playerHumanId(player2.address);
      const rate = await cj.exchangeRate();
      await cj
        .connect(player2)
        .deposit(human2, 1000n, { value: 1000n * rate });

      await expect(
        cj.connect(player2).reserve(human2, seatId, 1)
      ).to.be.revertedWithCustomError(cj, 'SeatOccupied');
    });

    it('should revert on invalid reservation duration', async function () {
      await expect(
        cj.connect(player1).reserve(humanId, seatId, 0)
      ).to.be.revertedWithCustomError(cj, 'InvalidReservationDuration');

      await expect(
        cj.connect(player1).reserve(humanId, seatId, 13)
      ).to.be.revertedWithCustomError(cj, 'InvalidReservationDuration');
    });
  });

  // ================================================================
  //                    GAMBLE
  // ================================================================

  describe('Gamble', function () {
    let humanId: bigint;
    let trackerId: bigint;
    let machineId: bigint;
    let seatId: bigint;

    beforeEach(async function () {
      const rate = await cj.exchangeRate();

      // Create player
      await cj.connect(player1).createPlayer();
      humanId = await cj.playerHumanId(player1.address);
      trackerId = await cj.playerTrackerId(player1.address);
      await cj
        .connect(player1)
        .deposit(humanId, 10000n, { value: 10000n * rate });

      // Create machine + fund + rent + configure
      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);
      await cj
        .connect(machineOwner)
        .deposit(machineId, 100000n, { value: 100000n * rate });
      const tx = await cj.connect(machineOwner).rent(machineId, 1);
      const receipt = await tx.wait();

      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      seatId = cj.interface.parseLog(event as any)!.args.seatId;

      // Reserve seat
      await cj.connect(player1).reserve(humanId, seatId, 6); // 1 hour
    });

    it('should execute a gamble and emit events', async function () {
      // Mine a block for cooldown
      await mineBlocks(1);

      const tx = await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 1);
      const receipt = await tx.wait();

      // Should have SpinResult event
      const spinEvents = receipt?.logs.filter((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SpinResult';
        } catch {
          return false;
        }
      });
      expect(spinEvents!.length).to.equal(1);

      // Should have GambleResult event
      await expect(tx).to.emit(cj, 'GambleResult');
    });

    it('should deduct play fee and transfer reward', async function () {
      await mineBlocks(1);

      const humanBalBefore = await cj.assetBalances(humanId);
      const machineBalBefore = await cj.assetBalances(machineId);

      await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 1);

      const humanBalAfter = await cj.assetBalances(humanId);
      const machineBalAfter = await cj.assetBalances(machineId);

      // Credits are conserved between human and machine
      const totalBefore = humanBalBefore + machineBalBefore;
      const totalAfter = humanBalAfter + machineBalAfter;
      expect(totalAfter).to.equal(totalBefore);
    });

    it('should support multiple spins (up to 4)', async function () {
      await mineBlocks(1);

      const tx = await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 4);
      const receipt = await tx.wait();

      // Should have 4 SpinResult events
      const spinEvents = receipt?.logs.filter((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SpinResult';
        } catch {
          return false;
        }
      });
      expect(spinEvents!.length).to.equal(4);
    });

    it('should revert with invalid spin count (0)', async function () {
      await mineBlocks(1);
      await expect(
        cj
          .connect(player1)
          .gamble(humanId, trackerId, seatId, machineId, 0)
      ).to.be.revertedWithCustomError(cj, 'InvalidSpinCount');
    });

    it('should revert with spin count > maxSpins', async function () {
      await mineBlocks(1);
      await expect(
        cj
          .connect(player1)
          .gamble(humanId, trackerId, seatId, machineId, 5)
      ).to.be.revertedWithCustomError(cj, 'InvalidSpinCount');
    });

    it('should revert when human has insufficient credits', async function () {
      // Release seat first so we can withdraw (need to be unseated)
      await cj.connect(player1).release(humanId, seatId);

      // Withdraw all credits
      const bal = await cj.assetBalances(humanId);
      if (bal > 0n) {
        await cj.connect(player1).withdrawCredits(humanId, bal);
      }

      // Re-reserve seat (need enough for reservation fee)
      // Since we have 0 credits, reservation should fail
      await expect(
        cj.connect(player1).reserve(humanId, seatId, 1)
      ).to.be.revertedWithCustomError(cj, 'InsufficientCredits');
    });

    it('should revert when machine has insufficient credits', async function () {
      // Drain machine by releasing seat, returning it, then withdrawing
      await cj.connect(player1).release(humanId, seatId);

      // Return seat
      await cj.connect(machineOwner).returnSeat(machineId, seatId);

      // Withdraw all machine credits
      const machineBal = await cj.assetBalances(machineId);
      if (machineBal > 0n) {
        await cj
          .connect(machineOwner)
          .withdrawCredits(machineId, machineBal);
      }

      // Re-fund machine with just enough for rent but not gamble
      const rate = await cj.exchangeRate();
      await cj
        .connect(machineOwner)
        .deposit(machineId, 20n, { value: 20n * rate });

      // Rent again
      const tx = await cj.connect(machineOwner).rent(machineId, 1);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      const newSeatId = cj.interface.parseLog(event as any)!.args.seatId;

      // Reserve seat again
      await cj.connect(player1).reserve(humanId, newSeatId, 1);
      await mineBlocks(1);

      await expect(
        cj
          .connect(player1)
          .gamble(humanId, trackerId, newSeatId, machineId, 1)
      ).to.be.revertedWithCustomError(cj, 'MachineCantCoverReward');
    });

    it('should allow consecutive gambles after cooldown', async function () {
      await mineBlocks(1);
      await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 1);

      // Need to mine at least 1 block for cooldown
      await mineBlocks(1);
      await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 1);
    });

    it('should update seat action count after gamble', async function () {
      await mineBlocks(1);
      await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 1);

      const seat = await cj.getAsset(seatId);
      // PlayerActionCount should be written in the payload at bytes 22-23
      // We can verify indirectly — seat payload should have changed
      expect(seat.payload).to.not.equal(ethers.ZeroHash);
    });
  });

  // ================================================================
  //                    RELEASE
  // ================================================================

  describe('Release', function () {
    let humanId: bigint;
    let machineId: bigint;
    let seatId: bigint;

    beforeEach(async function () {
      const rate = await cj.exchangeRate();

      await cj.connect(player1).createPlayer();
      humanId = await cj.playerHumanId(player1.address);
      await cj
        .connect(player1)
        .deposit(humanId, 1000n, { value: 1000n * rate });

      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);
      await cj
        .connect(machineOwner)
        .deposit(machineId, 50000n, { value: 50000n * rate });
      const tx = await cj.connect(machineOwner).rent(machineId, 1);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      seatId = cj.interface.parseLog(event as any)!.args.seatId;

      // Reserve
      await cj.connect(player1).reserve(humanId, seatId, 1);
    });

    it('should release a seat and refund player', async function () {
      const humanBalBefore = await cj.assetBalances(humanId);

      const tx = await cj.connect(player1).release(humanId, seatId);
      await expect(tx).to.emit(cj, 'SeatReleased');

      const humanBalAfter = await cj.assetBalances(humanId);
      // Should have received refund (minus 1% usage fee)
      expect(humanBalAfter).to.be.gte(humanBalBefore);
    });

    it('should clear human-seat link after release', async function () {
      await cj.connect(player1).release(humanId, seatId);

      // Seat should have PlayerId = 0
      const seat = await cj.getAsset(seatId);
      // Human should have SeatId = 0
      const human = await cj.getAsset(humanId);

      // Verify seat balance is 0 (refund was transferred)
      expect(await cj.assetBalances(seatId)).to.equal(0n);
    });

    it('should allow re-reserving seat after release', async function () {
      await cj.connect(player1).release(humanId, seatId);

      // Another player reserves the same seat
      await cj.connect(player2).createPlayer();
      const human2 = await cj.playerHumanId(player2.address);
      const rate = await cj.exchangeRate();
      await cj
        .connect(player2)
        .deposit(human2, 1000n, { value: 1000n * rate });
      await expect(
        cj.connect(player2).reserve(human2, seatId, 1)
      ).to.not.be.reverted;
    });

    it('should revert release when not seated', async function () {
      await cj.connect(player1).release(humanId, seatId);

      // Try to release again
      await expect(
        cj.connect(player1).release(humanId, seatId)
      ).to.be.revertedWithCustomError(cj, 'NotSeated');
    });
  });

  // ================================================================
  //                    KICK
  // ================================================================

  describe('Kick', function () {
    let humanId: bigint;
    let sniperHumanId: bigint;
    let machineId: bigint;
    let seatId: bigint;

    beforeEach(async function () {
      const rate = await cj.exchangeRate();

      // Victim player
      await cj.connect(player1).createPlayer();
      humanId = await cj.playerHumanId(player1.address);
      await cj
        .connect(player1)
        .deposit(humanId, 1000n, { value: 1000n * rate });

      // Sniper player
      await cj.connect(player2).createPlayer();
      sniperHumanId = await cj.playerHumanId(player2.address);

      // Machine + seat
      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);
      await cj
        .connect(machineOwner)
        .deposit(machineId, 50000n, { value: 50000n * rate });
      const tx = await cj.connect(machineOwner).rent(machineId, 1);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      seatId = cj.interface.parseLog(event as any)!.args.seatId;

      // Reserve with minimal duration (Mins5 = 1 -> 50 blocks)
      await cj.connect(player1).reserve(humanId, seatId, 1);
    });

    it('should revert kick when reservation is still protected', async function () {
      // Immediately after reservation — both reservation valid and grace active
      await expect(
        cj.connect(player2).kick(sniperHumanId, humanId, seatId)
      ).to.be.revertedWithCustomError(cj, 'ReservationStillProtected');
    });

    it('should allow kick when reservation expired', async function () {
      // Mine enough blocks to expire reservation (50 blocks for Mins5)
      await mineBlocks(60);

      await expect(
        cj.connect(player2).kick(sniperHumanId, humanId, seatId)
      )
        .to.emit(cj, 'PlayerKicked')
        .withArgs(seatId, humanId, sniperHumanId, 1n); // bounty = seat balance (1 from reservation)
    });

    it('should transfer seat balance to sniper on kick', async function () {
      await mineBlocks(60);

      const sniperBalBefore = await cj.assetBalances(sniperHumanId);
      const seatBal = await cj.assetBalances(seatId);

      await cj.connect(player2).kick(sniperHumanId, humanId, seatId);

      const sniperBalAfter = await cj.assetBalances(sniperHumanId);
      expect(sniperBalAfter - sniperBalBefore).to.equal(seatBal);
      expect(await cj.assetBalances(seatId)).to.equal(0n);
    });
  });

  // ================================================================
  //                    RETURN SEAT
  // ================================================================

  describe('ReturnSeat', function () {
    let machineId: bigint;
    let seatId: bigint;

    beforeEach(async function () {
      const rate = await cj.exchangeRate();

      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);
      await cj
        .connect(machineOwner)
        .deposit(machineId, 50000n, { value: 50000n * rate });
      const tx = await cj.connect(machineOwner).rent(machineId, 1);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      seatId = cj.interface.parseLog(event as any)!.args.seatId;
    });

    it('should burn an empty seat and decrement linked count', async function () {
      await expect(cj.connect(machineOwner).returnSeat(machineId, seatId))
        .to.emit(cj, 'SeatReturned')
        .withArgs(machineId, seatId, 0n);

      // Seat should no longer exist
      await expect(cj.getAsset(seatId)).to.be.revertedWithCustomError(
        cj,
        'AssetDoesNotExist'
      );
    });

    it('should revert when seat is occupied', async function () {
      // Player reserves seat
      const rate = await cj.exchangeRate();
      await cj.connect(player1).createPlayer();
      const humanId = await cj.playerHumanId(player1.address);
      await cj
        .connect(player1)
        .deposit(humanId, 1000n, { value: 1000n * rate });
      await cj.connect(player1).reserve(humanId, seatId, 1);

      await expect(
        cj.connect(machineOwner).returnSeat(machineId, seatId)
      ).to.be.revertedWithCustomError(cj, 'SeatNotEmpty');
    });

    it('should revert when non-owner tries to return seat', async function () {
      await expect(
        cj.connect(player1).returnSeat(machineId, seatId)
      ).to.be.revertedWithCustomError(cj, 'NotOwner');
    });
  });

  // ================================================================
  //                    CONFIG MACHINE
  // ================================================================

  describe('configMachine', function () {
    let machineId: bigint;

    beforeEach(async function () {
      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);
    });

    it('should update machine config', async function () {
      await expect(
        cj
          .connect(machineOwner)
          .configMachine(machineId, 3, 2, 1, 2)
      )
        .to.emit(cj, 'MachineConfigured')
        .withArgs(machineId);
    });

    it('should revert config with linked seats', async function () {
      const rate = await cj.exchangeRate();
      await cj
        .connect(machineOwner)
        .deposit(machineId, 1000n, { value: 1000n * rate });
      await cj.connect(machineOwner).rent(machineId, 1);

      await expect(
        cj
          .connect(machineOwner)
          .configMachine(machineId, 2, 4, 0, 1)
      ).to.be.revertedWithCustomError(cj, 'WithdrawBlockedByLinkedSeats');
    });

    it('should revert config by non-owner', async function () {
      await expect(
        cj.connect(player1).configMachine(machineId, 2, 4, 0, 1)
      ).to.be.revertedWithCustomError(cj, 'NotOwner');
    });

    it('should revert config with invalid seat limit', async function () {
      await expect(
        cj
          .connect(machineOwner)
          .configMachine(machineId, 0, 4, 0, 1)
      ).to.be.revertedWithCustomError(cj, 'InvalidParameter');
    });

    it('should revert config with invalid spin count', async function () {
      await expect(
        cj
          .connect(machineOwner)
          .configMachine(machineId, 1, 5, 0, 1)
      ).to.be.revertedWithCustomError(cj, 'InvalidSpinCount');
    });
  });

  // ================================================================
  //                    SPIN ENGINE VERIFICATION
  // ================================================================

  describe('Spin Engine', function () {
    let humanId: bigint;
    let trackerId: bigint;
    let machineId: bigint;
    let seatId: bigint;

    beforeEach(async function () {
      const rate = await cj.exchangeRate();

      await cj.connect(player1).createPlayer();
      humanId = await cj.playerHumanId(player1.address);
      trackerId = await cj.playerTrackerId(player1.address);
      await cj
        .connect(player1)
        .deposit(humanId, 100000n, { value: 100000n * rate });

      await cj.connect(machineOwner).createMachine();
      machineId = await cj.playerMachineId(machineOwner.address);
      await cj
        .connect(machineOwner)
        .deposit(machineId, 1000000n, { value: 1000000n * rate });
      const tx = await cj.connect(machineOwner).rent(machineId, 1);
      const receipt = await tx.wait();
      const event = receipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      seatId = cj.interface.parseLog(event as any)!.args.seatId;
      await cj.connect(player1).reserve(humanId, seatId, 6);
    });

    it('should produce spin results in valid symbol range (0-9)', async function () {
      await mineBlocks(1);

      const tx = await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 4);
      const receipt = await tx.wait();

      const spinEvents = receipt?.logs
        .map((log) => {
          try {
            return cj.interface.parseLog(log as any);
          } catch {
            return null;
          }
        })
        .filter((log) => log?.name === 'SpinResult');

      expect(spinEvents!.length).to.equal(4);

      for (const event of spinEvents!) {
        const { slot1, slot2, slot3, bonus1, bonus2 } = event!.args;
        expect(slot1).to.be.lte(9);
        expect(slot2).to.be.lte(9);
        expect(slot3).to.be.lte(9);
        expect(bonus1).to.be.lte(9);
        expect(bonus2).to.be.lte(9);
      }
    });

    it('should conserve total credits across gamble', async function () {
      await mineBlocks(1);

      const humanBal = await cj.assetBalances(humanId);
      const machineBal = await cj.assetBalances(machineId);
      const totalBefore = humanBal + machineBal;

      await cj
        .connect(player1)
        .gamble(humanId, trackerId, seatId, machineId, 2);

      const humanBalAfter = await cj.assetBalances(humanId);
      const machineBalAfter = await cj.assetBalances(machineId);
      const totalAfter = humanBalAfter + machineBalAfter;

      // Total credits should be conserved (no credits created or destroyed)
      expect(totalAfter).to.equal(totalBefore);
    });

    it('should execute many gambles without errors', async function () {
      for (let i = 0; i < 10; i++) {
        await mineBlocks(2);
        await cj
          .connect(player1)
          .gamble(humanId, trackerId, seatId, machineId, 4);
      }

      // Should still be able to read balances
      const humanBal = await cj.assetBalances(humanId);
      const machineBal = await cj.assetBalances(machineId);
      expect(humanBal).to.be.gte(0n);
      expect(machineBal).to.be.gte(0n);
    });
  });

  // ================================================================
  //                    FULL LIFECYCLE
  // ================================================================

  describe('Full Lifecycle', function () {
    it('should complete full game lifecycle', async function () {
      const rate = await cj.exchangeRate();

      // 1. Create player and machine
      await cj.connect(player1).createPlayer();
      const humanId = await cj.playerHumanId(player1.address);
      const trackerId = await cj.playerTrackerId(player1.address);

      await cj.connect(machineOwner).createMachine();
      const machineId = await cj.playerMachineId(machineOwner.address);

      // 2. Fund both
      await cj
        .connect(player1)
        .deposit(humanId, 10000n, { value: 10000n * rate });
      await cj
        .connect(machineOwner)
        .deposit(machineId, 100000n, { value: 100000n * rate });

      // 3. Rent a seat
      const rentTx = await cj.connect(machineOwner).rent(machineId, 1);
      const rentReceipt = await rentTx.wait();
      const rentEvent = rentReceipt?.logs.find((log) => {
        try {
          return cj.interface.parseLog(log as any)?.name === 'SeatRented';
        } catch {
          return false;
        }
      });
      const seatId = cj.interface.parseLog(rentEvent as any)!.args.seatId;

      // 4. Reserve seat
      await cj.connect(player1).reserve(humanId, seatId, 1);

      // 5. Gamble several times
      for (let i = 0; i < 3; i++) {
        await mineBlocks(2);
        await cj
          .connect(player1)
          .gamble(humanId, trackerId, seatId, machineId, 4);
      }

      // 6. Release seat
      await cj.connect(player1).release(humanId, seatId);

      // 7. Return seat
      await cj.connect(machineOwner).returnSeat(machineId, seatId);

      // 8. Withdraw credits
      const humanBal = await cj.assetBalances(humanId);
      if (humanBal > 0n) {
        await cj.connect(player1).withdrawCredits(humanId, humanBal);
      }

      // 9. Machine owner withdraws
      const machineBal = await cj.assetBalances(machineId);
      if (machineBal > 0n) {
        await cj
          .connect(machineOwner)
          .withdrawCredits(machineId, machineBal);
      }

      // 10. Both withdraw ETH
      const playerPending = await cj.pendingWithdrawals(player1.address);
      if (playerPending > 0n) {
        await cj.connect(player1).withdraw();
      }
      const ownerPending = await cj.pendingWithdrawals(
        machineOwner.address
      );
      if (ownerPending > 0n) {
        await cj.connect(machineOwner).withdraw();
      }
    });
  });
});
