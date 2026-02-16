import { expect } from "chai";
import { ethers } from "hardhat";
import { TestGame } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SageCore (via TestGame)", function () {
  let game: TestGame;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  const ZERO_BYTES32 = ethers.ZeroHash;
  const PAYLOAD_A = ethers.id("payload-a");
  const PAYLOAD_B = ethers.id("payload-b");

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("TestGame");
    game = (await factory.deploy()) as TestGame;
    await game.waitForDeployment();
  });

  // ═══════════════════════════════════════════
  // Constants
  // ═══════════════════════════════════════════
  describe("Constants", function () {
    it("DEFAULT_MAX_ITEMS should be 25", async function () {
      expect(await game.DEFAULT_MAX_ITEMS()).to.equal(25);
    });

    it("MAX_BATCH_SIZE should be 20", async function () {
      expect(await game.MAX_BATCH_SIZE()).to.equal(20);
    });

    it("MAX_ASSETS_PER_TRANSITION should be 5", async function () {
      expect(await game.MAX_ASSETS_PER_TRANSITION()).to.equal(5);
    });

    it("TRANSITION_NOOP should be 1", async function () {
      expect(await game.TRANSITION_NOOP()).to.equal(1);
    });

    it("TRANSITION_INCREMENT_LEVEL should be 2", async function () {
      expect(await game.TRANSITION_INCREMENT_LEVEL()).to.equal(2);
    });

    it("TRANSITION_SET_FLAGS should be 3", async function () {
      expect(await game.TRANSITION_SET_FLAGS()).to.equal(3);
    });
  });

  // ═══════════════════════════════════════════
  // Ownership
  // ═══════════════════════════════════════════
  describe("Ownership", function () {
    it("should set deployer as owner", async function () {
      expect(await game.owner()).to.equal(owner.address);
    });

    it("should transfer ownership", async function () {
      await game.transferOwnership(alice.address);
      expect(await game.owner()).to.equal(alice.address);
    });

    it("should revert transferOwnership to zero address", async function () {
      await expect(game.transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(game, "InvalidRecipient");
    });

    it("should revert transferOwnership from non-owner", async function () {
      await expect(game.connect(alice).transferOwnership(bob.address))
        .to.be.revertedWithCustomError(game, "NotContractOwner");
    });

    it("should renounce ownership", async function () {
      await game.renounceOwnership();
      expect(await game.owner()).to.equal(ethers.ZeroAddress);
    });
  });

  // ═══════════════════════════════════════════
  // Minting
  // ═══════════════════════════════════════════
  describe("Minting", function () {
    it("should mint an asset to caller (no fee)", async function () {
      const tx = await game.connect(alice).mintAsset(1, 0, 0, PAYLOAD_A);
      await expect(tx)
        .to.emit(game, "AssetMinted")
        .withArgs(1, alice.address, 1);

      const asset = await game.getAsset(1);
      expect(asset.owner).to.equal(alice.address);
      expect(asset.kind).to.equal(1);
      expect(asset.level).to.equal(0);
      expect(asset.payload).to.equal(PAYLOAD_A);
    });

    it("should mint with uint16 kind (value > 255)", async function () {
      await game.connect(alice).mintAsset(500, 0, 0, PAYLOAD_A);
      const asset = await game.getAsset(1);
      expect(asset.kind).to.equal(500);
    });

    it("should strip lock bit from flags on mint", async function () {
      // FLAG_LOCKED = 1, pass flags=1 -> should be stripped to 0
      await game.connect(alice).mintAsset(1, 1, 0, PAYLOAD_A);
      const asset = await game.getAsset(1);
      expect(asset.flags).to.equal(0);
    });

    it("should preserve non-lock flags on mint", async function () {
      // flags = 0b00000110 = 6 (bits 1 and 2 set, not lock bit)
      await game.connect(alice).mintAsset(1, 6, 0, PAYLOAD_A);
      const asset = await game.getAsset(1);
      expect(asset.flags).to.equal(6);
    });

    it("should revert mintAsset with insufficient fee", async function () {
      // Set a mint fee
      await game.setMintFee(ethers.parseEther("0.01"));
      await expect(
        game.connect(alice).mintAsset(1, 0, 0, PAYLOAD_A)
      ).to.be.revertedWithCustomError(game, "InsufficientPayment");
    });

    it("should accept exact mint fee", async function () {
      await game.setMintFee(ethers.parseEther("0.01"));
      await game.connect(alice).mintAsset(1, 0, 0, PAYLOAD_A, {
        value: ethers.parseEther("0.01"),
      });
      const asset = await game.getAsset(1);
      expect(asset.owner).to.equal(alice.address);
      expect(await game.collectedFees()).to.equal(ethers.parseEther("0.01"));
    });

    it("should refund excess mint fee via pull pattern", async function () {
      await game.setMintFee(ethers.parseEther("0.01"));
      await game.connect(alice).mintAsset(1, 0, 0, PAYLOAD_A, {
        value: ethers.parseEther("0.05"),
      });
      expect(await game.pendingWithdrawals(alice.address)).to.equal(
        ethers.parseEther("0.04")
      );
    });

    it("should mint to arbitrary address via owner's mintTo", async function () {
      await game.mintTo(alice.address, 1, 0, 0, PAYLOAD_A);
      const asset = await game.getAsset(1);
      expect(asset.owner).to.equal(alice.address);
    });

    it("should revert mintTo from non-owner", async function () {
      await expect(
        game.connect(alice).mintTo(bob.address, 1, 0, 0, PAYLOAD_A)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");
    });

    it("should revert mint to zero address", async function () {
      await expect(
        game.mintTo(ethers.ZeroAddress, 1, 0, 0, PAYLOAD_A)
      ).to.be.revertedWithCustomError(game, "InvalidRecipient");
    });

    it("should revert when inventory is full (Tier25 = 25 slots)", async function () {
      for (let i = 0; i < 25; i++) {
        await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      }
      await expect(
        game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32)
      ).to.be.revertedWithCustomError(game, "InventoryFull");
    });

    it("should mint via gameMintTo (internal _mintAssetTo)", async function () {
      await game.gameMintTo(bob.address, 42, 0, 5, PAYLOAD_B);
      const asset = await game.getAsset(1);
      expect(asset.owner).to.equal(bob.address);
      expect(asset.kind).to.equal(42);
      expect(asset.level).to.equal(5);
    });

    it("should assign incremental asset IDs", async function () {
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      await game.mintTo(bob.address, 1, 0, 0, ZERO_BYTES32);

      expect((await game.getAsset(1)).owner).to.equal(alice.address);
      expect((await game.getAsset(2)).owner).to.equal(alice.address);
      expect((await game.getAsset(3)).owner).to.equal(bob.address);
    });
  });

  // ═══════════════════════════════════════════
  // Transfers
  // ═══════════════════════════════════════════
  describe("Transfers", function () {
    beforeEach(async function () {
      await game.mintTo(alice.address, 1, 0, 0, PAYLOAD_A);
    });

    it("should transfer asset to another user", async function () {
      await game.connect(alice).transferAsset(1, bob.address);
      const asset = await game.getAsset(1);
      expect(asset.owner).to.equal(bob.address);

      const aliceInv = await game.getInventory(alice.address);
      const bobInv = await game.getInventory(bob.address);
      expect(aliceInv.length).to.equal(0);
      expect(bobInv.length).to.equal(1);
    });

    it("should revert transfer of non-owned asset", async function () {
      await expect(
        game.connect(bob).transferAsset(1, carol.address)
      ).to.be.revertedWithCustomError(game, "NotOwner");
    });

    it("should revert transfer to zero address", async function () {
      await expect(
        game.connect(alice).transferAsset(1, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(game, "InvalidRecipient");
    });

    it("should revert transfer of locked asset", async function () {
      await game.connect(alice).lockAsset(1);
      await expect(
        game.connect(alice).transferAsset(1, bob.address)
      ).to.be.revertedWithCustomError(game, "AssetIsLocked");
    });

    it("should revert transfer when receiver inventory is full", async function () {
      for (let i = 0; i < 25; i++) {
        await game.mintTo(bob.address, 1, 0, 0, ZERO_BYTES32);
      }
      await expect(
        game.connect(alice).transferAsset(1, bob.address)
      ).to.be.revertedWithCustomError(game, "ReceiverInventoryFull");
    });
  });

  // ═══════════════════════════════════════════
  // Batch Transfer
  // ═══════════════════════════════════════════
  describe("Batch Transfer", function () {
    beforeEach(async function () {
      for (let i = 0; i < 5; i++) {
        await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      }
    });

    it("should batch transfer multiple assets", async function () {
      await game.connect(alice).batchTransfer([1, 2, 3], bob.address);
      expect((await game.getInventory(alice.address)).length).to.equal(2);
      expect((await game.getInventory(bob.address)).length).to.equal(3);
    });

    it("should revert batch transfer with empty array", async function () {
      await expect(
        game.connect(alice).batchTransfer([], bob.address)
      ).to.be.revertedWithCustomError(game, "EmptyBatch");
    });

    it("should revert batch transfer exceeding MAX_BATCH_SIZE", async function () {
      // Create 21 assets
      for (let i = 0; i < 16; i++) {
        await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      }
      const ids = Array.from({ length: 21 }, (_, i) => i + 1);
      await expect(
        game.connect(alice).batchTransfer(ids, bob.address)
      ).to.be.revertedWithCustomError(game, "BatchTooLarge");
    });

    it("should revert batch transfer to zero address", async function () {
      await expect(
        game.connect(alice).batchTransfer([1], ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(game, "InvalidRecipient");
    });

    it("should revert batch transfer with duplicate asset IDs", async function () {
      await expect(
        game.connect(alice).batchTransfer([1, 1], bob.address)
      ).to.be.revertedWithCustomError(game, "DuplicateAssetId");
    });
  });

  // ═══════════════════════════════════════════
  // Burning
  // ═══════════════════════════════════════════
  describe("Burning", function () {
    beforeEach(async function () {
      await game.mintTo(alice.address, 1, 0, 0, PAYLOAD_A);
    });

    it("should burn own asset", async function () {
      await expect(game.connect(alice).burnAsset(1))
        .to.emit(game, "AssetBurned")
        .withArgs(1, alice.address);

      await expect(game.getAsset(1)).to.be.revertedWithCustomError(
        game,
        "AssetDoesNotExist"
      );
      expect((await game.getInventory(alice.address)).length).to.equal(0);
    });

    it("should revert burn of non-owned asset", async function () {
      await expect(
        game.connect(bob).burnAsset(1)
      ).to.be.revertedWithCustomError(game, "NotOwner");
    });

    it("should revert burn of locked asset", async function () {
      await game.connect(alice).lockAsset(1);
      await expect(
        game.connect(alice).burnAsset(1)
      ).to.be.revertedWithCustomError(game, "AssetIsLocked");
    });

    it("should revert burn of non-existent asset", async function () {
      await expect(game.connect(alice).burnAsset(999))
        .to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("should batch burn multiple assets", async function () {
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      // alice now has asset 1 and 2
      await expect(game.connect(alice).batchBurn([1, 2]))
        .to.emit(game, "BatchBurn");
      expect((await game.getInventory(alice.address)).length).to.equal(0);
    });

    it("should revert batch burn with empty array", async function () {
      await expect(
        game.connect(alice).batchBurn([])
      ).to.be.revertedWithCustomError(game, "EmptyBatch");
    });

    it("should revert batch burn with duplicate asset IDs", async function () {
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      await expect(
        game.connect(alice).batchBurn([1, 1])
      ).to.be.revertedWithCustomError(game, "DuplicateAssetId");
    });

    it("should game burn via internal _burnAsset (owner only)", async function () {
      await game.gameBurn(1);
      await expect(game.getAsset(1)).to.be.revertedWithCustomError(
        game,
        "AssetDoesNotExist"
      );
    });
  });

  // ═══════════════════════════════════════════
  // Locking
  // ═══════════════════════════════════════════
  describe("Locking", function () {
    beforeEach(async function () {
      await game.mintTo(alice.address, 1, 0, 0, PAYLOAD_A);
    });

    it("should lock and unlock an asset", async function () {
      await game.connect(alice).lockAsset(1);
      expect(await game.isLocked(1)).to.be.true;

      await game.connect(alice).unlockAsset(1);
      expect(await game.isLocked(1)).to.be.false;
    });

    it("should revert locking an already locked asset", async function () {
      await game.connect(alice).lockAsset(1);
      await expect(
        game.connect(alice).lockAsset(1)
      ).to.be.revertedWithCustomError(game, "AssetAlreadyLocked");
    });

    it("should revert unlocking an already unlocked asset", async function () {
      await expect(
        game.connect(alice).unlockAsset(1)
      ).to.be.revertedWithCustomError(game, "AssetNotLocked");
    });

    it("should revert locking by non-owner of asset", async function () {
      await expect(
        game.connect(bob).lockAsset(1)
      ).to.be.revertedWithCustomError(game, "NotOwner");
    });
  });

  // ═══════════════════════════════════════════
  // Inventory
  // ═══════════════════════════════════════════
  describe("Inventory", function () {
    it("should return empty inventory initially", async function () {
      const inv = await game.getInventory(alice.address);
      expect(inv.length).to.equal(0);
    });

    it("should track inventory count", async function () {
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      await game.mintTo(alice.address, 2, 0, 0, ZERO_BYTES32);
      expect(await game.getInventoryCount(alice.address)).to.equal(2);
    });

    it("should maintain consistency after transfers", async function () {
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      await game.mintTo(alice.address, 2, 0, 0, ZERO_BYTES32);
      await game.connect(alice).transferAsset(1, bob.address);

      expect(await game.checkInventoryConsistency(alice.address)).to.be.true;
      expect(await game.checkInventoryConsistency(bob.address)).to.be.true;
      expect(await game.checkAssetConsistency(1)).to.be.true;
      expect(await game.checkAssetConsistency(2)).to.be.true;
    });
  });

  // ═══════════════════════════════════════════
  // Storage Tiers
  // ═══════════════════════════════════════════
  describe("Storage Tiers", function () {
    it("should start at Tier25", async function () {
      expect(await game.getStorageTierCapacity(0)).to.equal(25);
    });

    it("should report correct capacity for all tiers", async function () {
      expect(await game.getStorageTierCapacity(0)).to.equal(25);
      expect(await game.getStorageTierCapacity(1)).to.equal(50);
      expect(await game.getStorageTierCapacity(2)).to.equal(75);
      expect(await game.getStorageTierCapacity(3)).to.equal(100);
    });

    it("should upgrade from Tier25 to Tier50", async function () {
      const cost = await game.getUpgradeCost(alice.address);
      await game.connect(alice).upgradeStorageTier({ value: cost });

      // Should now be able to hold 50 items
      for (let i = 0; i < 50; i++) {
        await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      }
      expect(await game.getInventoryCount(alice.address)).to.equal(50);
    });

    it("should upgrade through all tiers", async function () {
      let cost = await game.getUpgradeCost(alice.address);
      await game.connect(alice).upgradeStorageTier({ value: cost });

      cost = await game.getUpgradeCost(alice.address);
      await game.connect(alice).upgradeStorageTier({ value: cost });

      cost = await game.getUpgradeCost(alice.address);
      await game.connect(alice).upgradeStorageTier({ value: cost });

      // At Tier100, cost should be 0
      expect(await game.getUpgradeCost(alice.address)).to.equal(0);
    });

    it("should revert upgrade when already at max tier", async function () {
      // Upgrade to Tier100
      for (let i = 0; i < 3; i++) {
        const cost = await game.getUpgradeCost(alice.address);
        await game.connect(alice).upgradeStorageTier({ value: cost });
      }
      await expect(
        game.connect(alice).upgradeStorageTier({ value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(game, "AlreadyAtMaxTier");
    });

    it("should revert upgrade with insufficient payment", async function () {
      await expect(
        game.connect(alice).upgradeStorageTier({ value: 1 })
      ).to.be.revertedWithCustomError(game, "InsufficientPayment");
    });

    it("should collect fees on tier upgrade", async function () {
      const cost = await game.getUpgradeCost(alice.address);
      await game.connect(alice).upgradeStorageTier({ value: cost });
      expect(await game.collectedFees()).to.equal(cost);
    });

    it("should refund excess payment via pull pattern", async function () {
      const cost = await game.getUpgradeCost(alice.address);
      const excess = ethers.parseEther("0.1");
      await game.connect(alice).upgradeStorageTier({ value: cost + excess });
      expect(await game.pendingWithdrawals(alice.address)).to.equal(excess);
    });
  });

  // ═══════════════════════════════════════════
  // Fee Configuration & Collection
  // ═══════════════════════════════════════════
  describe("Fee Configuration & Collection", function () {
    it("should set and get mint fee", async function () {
      await game.setMintFee(ethers.parseEther("0.05"));
      expect(await game.mintFee()).to.equal(ethers.parseEther("0.05"));
    });

    it("should set tier upgrade fees", async function () {
      const newFees: [bigint, bigint, bigint] = [
        ethers.parseEther("0.1"),
        ethers.parseEther("0.2"),
        ethers.parseEther("0.3"),
      ];
      await game.setTierUpgradeFees(newFees);

      expect(await game.getUpgradeCost(alice.address)).to.equal(newFees[0]);
    });

    it("should collect fees as owner", async function () {
      // Generate some fees via tier upgrade
      const cost = await game.getUpgradeCost(alice.address);
      await game.connect(alice).upgradeStorageTier({ value: cost });

      const ownerBalBefore = await ethers.provider.getBalance(owner.address);
      const tx = await game.collectFees();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const ownerBalAfter = await ethers.provider.getBalance(owner.address);

      expect(ownerBalAfter - ownerBalBefore + gasUsed).to.equal(cost);
      expect(await game.collectedFees()).to.equal(0);
    });

    it("should revert collectFees if no fees", async function () {
      await expect(game.collectFees()).to.be.revertedWithCustomError(
        game,
        "NoFeesToCollect"
      );
    });

    it("should revert collectFees from non-owner", async function () {
      await expect(
        game.connect(alice).collectFees()
      ).to.be.revertedWithCustomError(game, "NotContractOwner");
    });

    it("should revert setMintFee from non-owner", async function () {
      await expect(
        game.connect(alice).setMintFee(1)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");
    });

    it("should revert setTierUpgradeFees from non-owner", async function () {
      await expect(
        game.connect(alice).setTierUpgradeFees([1n, 2n, 3n])
      ).to.be.revertedWithCustomError(game, "NotContractOwner");
    });
  });

  // ═══════════════════════════════════════════
  // Transitions
  // ═══════════════════════════════════════════
  describe("Transitions", function () {
    beforeEach(async function () {
      await game.mintTo(alice.address, 1, 0, 0, PAYLOAD_A);
      await game.mintTo(alice.address, 2, 0, 0, PAYLOAD_B);
    });

    describe("NOOP", function () {
      it("should execute without changing assets", async function () {
        await game.connect(alice).executeTransition(1, [1], "0x");
        const asset = await game.getAsset(1);
        expect(asset.level).to.equal(0);
        expect(asset.payload).to.equal(PAYLOAD_A);
      });
    });

    describe("INCREMENT_LEVEL", function () {
      it("should increment level of assets", async function () {
        await game.connect(alice).executeTransition(2, [1, 2], "0x");
        expect((await game.getAsset(1)).level).to.equal(1);
        expect((await game.getAsset(2)).level).to.equal(1);
      });

      it("should increment level multiple times", async function () {
        for (let i = 0; i < 5; i++) {
          await game.connect(alice).executeTransition(2, [1], "0x");
        }
        expect((await game.getAsset(1)).level).to.equal(5);
      });

      it("should revert on locked asset", async function () {
        await game.connect(alice).lockAsset(1);
        await expect(
          game.connect(alice).executeTransition(2, [1], "0x")
        ).to.be.revertedWithCustomError(game, "AssetIsLocked");
      });
    });

    describe("SET_FLAGS", function () {
      it("should set flags from data byte", async function () {
        // Set bit 1 (0x02)
        await game.connect(alice).executeTransition(3, [1], "0x02");
        const asset = await game.getAsset(1);
        expect(Number(asset.flags) & 0x02).to.equal(0x02);
      });

      it("should strip lock bit from flags mask", async function () {
        // Try setting lock bit (0x01) — should be stripped
        await game.connect(alice).executeTransition(3, [1], "0x01");
        expect(await game.isLocked(1)).to.be.false;
      });

      it("should revert with empty data", async function () {
        await expect(
          game.connect(alice).executeTransition(3, [1], "0x")
        ).to.be.revertedWithCustomError(game, "DataTooShort");
      });

      it("should clear flags using second data byte", async function () {
        // First set bit 1 (0x02) and bit 2 (0x04)
        await game.connect(alice).executeTransition(3, [1], "0x06");
        let asset = await game.getAsset(1);
        expect(Number(asset.flags) & 0x06).to.equal(0x06);

        // Now clear bit 1 (0x02): setBits=0x00, clearBits=0x02
        await game.connect(alice).executeTransition(3, [1], "0x0002");
        asset = await game.getAsset(1);
        expect(Number(asset.flags) & 0x02).to.equal(0);
        expect(Number(asset.flags) & 0x04).to.equal(0x04); // bit 2 still set
      });

      it("should strip lock bit from clear mask too", async function () {
        // Lock the asset via lockAsset, then try clearing lock via SET_FLAGS
        await game.connect(alice).lockAsset(1);
        // Need to use a transition that allows locked assets — configure NOOP-like
        await game.configureTransition(3, true, false, true, 5);
        // clearBits=0x01 (lock bit) should be stripped
        await game.connect(alice).executeTransition(3, [1], "0x0001");
        // Asset should still be locked
        expect(await game.isLocked(1)).to.be.true;
      });
    });

    describe("Common validation", function () {
      it("should revert on disabled transition", async function () {
        // Disable NOOP
        await game.configureTransition(1, false, false, false, 5);
        await expect(
          game.connect(alice).executeTransition(1, [1], "0x")
        ).to.be.revertedWithCustomError(game, "TransitionDisabled");
      });

      it("should revert with empty assetIds", async function () {
        await expect(
          game.connect(alice).executeTransition(1, [], "0x")
        ).to.be.revertedWithCustomError(game, "NoAssets");
      });

      it("should revert with too many assets", async function () {
        // Mint more assets
        for (let i = 0; i < 4; i++) {
          await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
        }
        // 6 assets > MAX_ASSETS_PER_TRANSITION (5)
        await expect(
          game.connect(alice).executeTransition(1, [1, 2, 3, 4, 5, 6], "0x")
        ).to.be.revertedWithCustomError(game, "TooManyAssets");
      });

      it("should revert on duplicate asset IDs", async function () {
        await expect(
          game.connect(alice).executeTransition(1, [1, 1], "0x")
        ).to.be.revertedWithCustomError(game, "DuplicateAssetId");
      });

      it("should revert on non-owned assets", async function () {
        await expect(
          game.connect(bob).executeTransition(1, [1], "0x")
        ).to.be.revertedWithCustomError(game, "NotOwner");
      });
    });

    describe("Configuration", function () {
      it("should configure transition", async function () {
        await game.configureTransition(1, true, true, false, 3);
        const cfg = await game.transitionConfigs(1);
        expect(cfg.enabled).to.be.true;
        expect(cfg.requireAllUnlocked).to.be.true;
        expect(cfg.requireAllLocked).to.be.false;
        expect(cfg.maxAssets).to.equal(3);
      });

      it("should revert on conflicting lock requirements", async function () {
        await expect(
          game.configureTransition(1, true, true, true, 5)
        ).to.be.revertedWithCustomError(game, "InvalidLockConfig");
      });

      it("should revert on zero maxAssets", async function () {
        await expect(
          game.configureTransition(1, true, false, false, 0)
        ).to.be.revertedWithCustomError(game, "MaxAssetsMustBePositive");
      });

      it("should revert on maxAssets > MAX_ASSETS_PER_TRANSITION", async function () {
        await expect(
          game.configureTransition(1, true, false, false, 10)
        ).to.be.revertedWithCustomError(game, "MaxAssetsTooLarge");
      });

      it("should revert configureTransition from non-owner", async function () {
        await expect(
          game.connect(alice).configureTransition(1, true, false, false, 5)
        ).to.be.revertedWithCustomError(game, "NotContractOwner");
      });
    });
  });

  // ═══════════════════════════════════════════
  // Asset Data Update (Game Internal API)
  // ═══════════════════════════════════════════
  describe("Asset Data Update", function () {
    beforeEach(async function () {
      await game.mintTo(alice.address, 1, 0, 0, PAYLOAD_A);
    });

    it("should update asset payload and level", async function () {
      await game.updateAssetData(1, PAYLOAD_B, 10);
      const asset = await game.getAsset(1);
      expect(asset.payload).to.equal(PAYLOAD_B);
      expect(asset.level).to.equal(10);
    });

    it("should emit AssetDataUpdated event", async function () {
      await expect(game.updateAssetData(1, PAYLOAD_B, 10))
        .to.emit(game, "AssetDataUpdated")
        .withArgs(1, PAYLOAD_B, 10);
    });

    it("should revert on non-existent asset", async function () {
      await expect(
        game.updateAssetData(999, PAYLOAD_B, 10)
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });
  });

  // ═══════════════════════════════════════════
  // Marketplace
  // ═══════════════════════════════════════════
  describe("Marketplace", function () {
    const PRICE = ethers.parseEther("1");

    beforeEach(async function () {
      await game.mintTo(alice.address, 1, 0, 0, PAYLOAD_A);
    });

    describe("Listing", function () {
      it("should list an asset", async function () {
        await expect(game.connect(alice).listAsset(1, PRICE))
          .to.emit(game, "AssetListed")
          .withArgs(1, alice.address, PRICE);

        const listing = await game.listings(1);
        expect(listing.seller).to.equal(alice.address);
        expect(listing.price).to.equal(PRICE);
        expect(await game.isLocked(1)).to.be.true;
      });

      it("should revert listing with zero price", async function () {
        await expect(
          game.connect(alice).listAsset(1, 0)
        ).to.be.revertedWithCustomError(game, "InvalidPrice");
      });

      it("should revert listing of non-owned asset", async function () {
        await expect(
          game.connect(bob).listAsset(1, PRICE)
        ).to.be.revertedWithCustomError(game, "NotOwner");
      });

      it("should revert listing of already listed asset", async function () {
        await game.connect(alice).listAsset(1, PRICE);
        await expect(
          game.connect(alice).listAsset(1, PRICE)
        ).to.be.revertedWithCustomError(game, "AssetAlreadyListed");
      });

      it("should revert listing of locked asset", async function () {
        await game.connect(alice).lockAsset(1);
        await expect(
          game.connect(alice).listAsset(1, PRICE)
        ).to.be.revertedWithCustomError(game, "AssetIsLocked");
      });

      it("should revert listing below minimum price", async function () {
        await game.setMinListingPrice(ethers.parseEther("2"));
        await expect(
          game.connect(alice).listAsset(1, PRICE)
        ).to.be.revertedWithCustomError(game, "PriceBelowMinimum");
      });

      it("should revert listing when marketplace is disabled", async function () {
        await game.setMarketplaceEnabled(false);
        await expect(
          game.connect(alice).listAsset(1, PRICE)
        ).to.be.revertedWithCustomError(game, "MarketplaceDisabled");
      });
    });

    describe("Cancel Listing", function () {
      beforeEach(async function () {
        await game.connect(alice).listAsset(1, PRICE);
      });

      it("should cancel listing and unlock asset", async function () {
        await expect(game.connect(alice).cancelListing(1))
          .to.emit(game, "AssetDelisted")
          .withArgs(1, alice.address);

        const listing = await game.listings(1);
        expect(listing.seller).to.equal(ethers.ZeroAddress);
        expect(await game.isLocked(1)).to.be.false;
      });

      it("should revert cancel by non-seller", async function () {
        await expect(
          game.connect(bob).cancelListing(1)
        ).to.be.revertedWithCustomError(game, "NotSeller");
      });

      it("should revert cancel of unlisted asset", async function () {
        await game.connect(alice).cancelListing(1);
        await expect(
          game.connect(alice).cancelListing(1)
        ).to.be.revertedWithCustomError(game, "AssetNotListed");
      });

      it("should allow cancel when marketplace is disabled", async function () {
        await game.setMarketplaceEnabled(false);
        // Should still be able to cancel (unlock assets)
        await game.connect(alice).cancelListing(1);
        expect(await game.isLocked(1)).to.be.false;
      });
    });

    describe("Buying", function () {
      beforeEach(async function () {
        await game.connect(alice).listAsset(1, PRICE);
      });

      it("should buy a listed asset", async function () {
        await expect(game.connect(bob).buyAsset(1, { value: PRICE }))
          .to.emit(game, "AssetSold")
          .withArgs(1, alice.address, bob.address, PRICE);

        const asset = await game.getAsset(1);
        expect(asset.owner).to.equal(bob.address);
        expect(await game.isLocked(1)).to.be.false;

        // Seller should have pending withdrawal
        expect(await game.pendingWithdrawals(alice.address)).to.equal(PRICE);
      });

      it("should handle overpayment via pull pattern", async function () {
        const overpay = ethers.parseEther("2");
        await game.connect(bob).buyAsset(1, { value: overpay });
        expect(await game.pendingWithdrawals(bob.address)).to.equal(
          overpay - PRICE
        );
      });

      it("should revert buying own asset", async function () {
        await expect(
          game.connect(alice).buyAsset(1, { value: PRICE })
        ).to.be.revertedWithCustomError(game, "CannotBuyOwnAsset");
      });

      it("should revert with insufficient payment", async function () {
        await expect(
          game.connect(bob).buyAsset(1, { value: 1 })
        ).to.be.revertedWithCustomError(game, "InsufficientPayment");
      });

      it("should revert buying unlisted asset", async function () {
        await expect(
          game.connect(bob).buyAsset(999, { value: PRICE })
        ).to.be.revertedWithCustomError(game, "AssetNotListed");
      });

      it("should revert buying when marketplace is disabled", async function () {
        await game.setMarketplaceEnabled(false);
        await expect(
          game.connect(bob).buyAsset(1, { value: PRICE })
        ).to.be.revertedWithCustomError(game, "MarketplaceDisabled");
      });
    });

    describe("Withdraw", function () {
      it("should withdraw pending funds", async function () {
        await game.connect(alice).listAsset(1, PRICE);
        await game.connect(bob).buyAsset(1, { value: PRICE });

        const balBefore = await ethers.provider.getBalance(alice.address);
        const tx = await game.connect(alice).withdraw();
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const balAfter = await ethers.provider.getBalance(alice.address);

        expect(balAfter - balBefore + gasUsed).to.equal(PRICE);
        expect(await game.pendingWithdrawals(alice.address)).to.equal(0);
      });

      it("should revert withdraw with no funds", async function () {
        await expect(
          game.connect(alice).withdraw()
        ).to.be.revertedWithCustomError(game, "NoWithdrawableFunds");
      });
    });
  });

  // ═══════════════════════════════════════════
  // Configuration Management
  // ═══════════════════════════════════════════
  describe("Configuration Management", function () {
    it("should set maxAssetsPerTransitionGlobal", async function () {
      await game.setMaxAssetsPerTransitionGlobal(3);
      expect(await game.maxAssetsPerTransitionGlobal()).to.equal(3);
    });

    it("should revert setMaxAssetsPerTransitionGlobal with 0", async function () {
      await expect(
        game.setMaxAssetsPerTransitionGlobal(0)
      ).to.be.revertedWithCustomError(game, "InvalidMaxAssetsPerTransition");
    });

    it("should revert setMaxAssetsPerTransitionGlobal above max", async function () {
      await expect(
        game.setMaxAssetsPerTransitionGlobal(10)
      ).to.be.revertedWithCustomError(game, "InvalidMaxAssetsPerTransition");
    });

    it("should set marketplace enabled", async function () {
      await game.setMarketplaceEnabled(false);
      expect(await game.marketplaceEnabled()).to.be.false;
    });

    it("should set min listing price", async function () {
      await game.setMinListingPrice(ethers.parseEther("0.5"));
      expect(await game.minListingPrice()).to.equal(ethers.parseEther("0.5"));
    });
  });

  // ═══════════════════════════════════════════
  // Consistency Checks
  // ═══════════════════════════════════════════
  describe("Consistency Checks", function () {
    it("should report consistent state for empty inventory", async function () {
      expect(await game.checkInventoryConsistency(alice.address)).to.be.true;
    });

    it("should report consistent state after minting", async function () {
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      expect(await game.checkInventoryConsistency(alice.address)).to.be.true;
      expect(await game.checkAssetConsistency(1)).to.be.true;
    });

    it("should report consistent after burn (non-existent asset)", async function () {
      await game.mintTo(alice.address, 1, 0, 0, ZERO_BYTES32);
      await game.connect(alice).burnAsset(1);
      // Burned asset should be consistent (owner = 0)
      expect(await game.checkAssetConsistency(1)).to.be.true;
    });
  });
});
