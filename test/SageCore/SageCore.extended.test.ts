import { expect } from "chai";
import { ethers } from "hardhat";
import { TestGame } from "../../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Extended SageCore tests – covers scenarios identified from the spec test
 * suite that were not present in the core SageCore.test.ts file.
 *
 * Categories:
 *  1. Event Emission Verification
 *  2. Ownership & Access Control
 *  3. Transition Configuration & Lock Requirements
 *  4. Burned Asset Operations
 *  5. Marketplace Edge Cases
 *  6. Batch Operation Edge Cases
 *  7. Storage Tier Details
 *  8. Inventory Behavior
 *  9. Complex Integration Scenarios
 * 10. Initial Configuration Defaults
 */
describe("SageCore Extended (via TestGame)", function () {
  let game: TestGame;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  const ZERO_BYTES32 = ethers.ZeroHash;
  const PAYLOAD_A = ethers.id("payload-a");

  // Helper: mint one asset to a signer and return its ID
  async function mintTo(
    signer: HardhatEthersSigner,
    kind = 1,
    flags = 0,
    level = 0,
    payload = ZERO_BYTES32
  ): Promise<bigint> {
    const tx = await game
      .connect(signer)
      .mintAsset(kind, flags, level, payload);
    const receipt = await tx.wait();
    const log = receipt!.logs.find((l) => {
      try {
        return game.interface.parseLog(l as any)?.name === "AssetMinted";
      } catch {
        return false;
      }
    });
    return game.interface.parseLog(log as any)!.args.assetId;
  }

  // Helper: mint N assets to a signer sequentially
  async function mintMany(
    signer: HardhatEthersSigner,
    count: number,
    kind = 1
  ): Promise<bigint[]> {
    const ids: bigint[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(await mintTo(signer, kind));
    }
    return ids;
  }

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("TestGame");
    game = (await factory.deploy()) as TestGame;
    await game.waitForDeployment();
  });

  // ═══════════════════════════════════════════
  // 1. Event Emission Verification
  // ═══════════════════════════════════════════
  describe("Event Emissions", function () {
    it("should emit OwnershipTransferred on transferOwnership", async function () {
      await expect(game.connect(owner).transferOwnership(alice.address))
        .to.emit(game, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);
    });

    it("should emit AssetTransferred on transfer", async function () {
      const id = await mintTo(alice);
      await expect(game.connect(alice).transferAsset(id, bob.address))
        .to.emit(game, "AssetTransferred")
        .withArgs(id, alice.address, bob.address);
    });

    it("should emit AssetLocked when listing", async function () {
      const id = await mintTo(alice);
      await expect(
        game.connect(alice).listAsset(id, ethers.parseEther("1"))
      ).to.emit(game, "AssetLocked").withArgs(id, alice.address);
    });

    it("should emit AssetUnlocked when canceling listing", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).listAsset(id, ethers.parseEther("1"));
      await expect(game.connect(alice).cancelListing(id))
        .to.emit(game, "AssetUnlocked")
        .withArgs(id, alice.address);
    });

    it("should emit AssetUnlocked during buyAsset", async function () {
      const id = await mintTo(alice);
      const price = ethers.parseEther("0.5");
      await game.connect(alice).listAsset(id, price);
      await expect(
        game.connect(bob).buyAsset(id, { value: price })
      ).to.emit(game, "AssetUnlocked").withArgs(id, alice.address);
    });

    it("should emit TransitionExecuted on executeTransition", async function () {
      const id = await mintTo(alice);
      await expect(
        game.connect(alice).executeTransition(1, [id], "0x")
      )
        .to.emit(game, "TransitionExecuted")
        .withArgs(1, alice.address, [id]);
    });

    it("should emit TransitionConfigured on configureTransition", async function () {
      await expect(
        game.connect(owner).configureTransition(10, true, false, false, 3)
      )
        .to.emit(game, "TransitionConfigured")
        .withArgs(10, true, false, false, 3);
    });

    it("should emit StorageTierUpgraded on upgradeStorageTier", async function () {
      const cost = await game.getUpgradeCost(alice.address);
      await expect(
        game.connect(alice).upgradeStorageTier({ value: cost })
      ).to.emit(game, "StorageTierUpgraded");
    });

    it("should emit individual AssetBurned events for each asset in batch burn", async function () {
      const ids = await mintMany(alice, 3);
      const tx = game.connect(alice).batchBurn(ids);
      for (const id of ids) {
        await expect(tx)
          .to.emit(game, "AssetBurned")
          .withArgs(id, alice.address);
      }
      await expect(tx).to.emit(game, "BatchBurn");
    });
  });

  // ═══════════════════════════════════════════
  // 2. Ownership & Access Control
  // ═══════════════════════════════════════════
  describe("Ownership – post-renounce lockout", function () {
    it("should prevent all onlyOwner functions after renouncing", async function () {
      await game.connect(owner).renounceOwnership();

      await expect(
        game.connect(owner).configureTransition(1, true, false, false, 5)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");

      await expect(
        game
          .connect(owner)
          .mintTo(alice.address, 1, 0, 0, ZERO_BYTES32)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");

      await expect(
        game.connect(owner).setMarketplaceEnabled(false)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");

      await expect(
        game.connect(owner).setMinListingPrice(1000)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");

      await expect(
        game.connect(owner).setMintFee(1000)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");

      await expect(
        game.connect(owner).setMaxAssetsPerTransitionGlobal(3)
      ).to.be.revertedWithCustomError(game, "NotContractOwner");
    });
  });

  // ═══════════════════════════════════════════
  // 3. Transition Config & Lock Requirements
  // ═══════════════════════════════════════════
  describe("Transition – advanced config", function () {
    it("should have correct default built-in transition configs", async function () {
      // NOOP: enabled, any lock, max 5
      const noop = await game.transitionConfigs(1);
      expect(noop.enabled).to.equal(true);
      expect(noop.requireAllUnlocked).to.equal(false);
      expect(noop.requireAllLocked).to.equal(false);
      expect(noop.maxAssets).to.equal(5);

      // INCREMENT_LEVEL: enabled, unlocked, max 5
      const incr = await game.transitionConfigs(2);
      expect(incr.enabled).to.equal(true);
      expect(incr.requireAllUnlocked).to.equal(true);
      expect(incr.requireAllLocked).to.equal(false);
      expect(incr.maxAssets).to.equal(5);

      // SET_FLAGS: enabled, unlocked, max 5
      const setF = await game.transitionConfigs(3);
      expect(setF.enabled).to.equal(true);
      expect(setF.requireAllUnlocked).to.equal(true);
      expect(setF.requireAllLocked).to.equal(false);
      expect(setF.maxAssets).to.equal(5);
    });

    it("should enforce requireAllLocked (locked passes, unlocked fails)", async function () {
      // Configure transition 20 as requireAllLocked
      await game
        .connect(owner)
        .configureTransition(20, true, false, true, 5);

      const id = await mintTo(alice);

      // Unlocked asset → should fail with AssetNotLocked
      await expect(
        game.connect(alice).executeTransition(20, [id], "0x")
      ).to.be.revertedWithCustomError(game, "AssetNotLocked");

      // Lock asset via TestGame helper
      await game.connect(alice).lockAsset(id);

      // Now should succeed
      await game.connect(alice).executeTransition(20, [id], "0x");
    });

    it("should reject locked asset when requireAllUnlocked", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).lockAsset(id);

      // INCREMENT_LEVEL has requireAllUnlocked = true
      await expect(
        game.connect(alice).executeTransition(2, [id], "0x")
      ).to.be.revertedWithCustomError(game, "AssetIsLocked");
    });

    it("should allow custom transition IDs if configured", async function () {
      // Configure non-built-in transition ID 50
      await game.connect(owner).configureTransition(50, true, false, false, 3);
      const id = await mintTo(alice);

      // Should succeed — _applyTransition does nothing for unknown IDs
      await game.connect(alice).executeTransition(50, [id], "0x");
    });

    it("should respect both per-transition and global max limits", async function () {
      // Config transition with maxAssets=5, but global max=2
      await game.connect(owner).setMaxAssetsPerTransitionGlobal(2);
      const ids = await mintMany(alice, 3);

      // 3 assets > global max 2
      await expect(
        game.connect(alice).executeTransition(1, ids, "0x")
      ).to.be.revertedWithCustomError(game, "TooManyAssets");

      // 2 assets should succeed
      await game
        .connect(alice)
        .executeTransition(1, ids.slice(0, 2), "0x");
    });

    it("should enforce per-transition maxAssets (not just global)", async function () {
      // Configure transition 1 (NOOP) with maxAssets=2
      await game.connect(owner).configureTransition(1, true, false, false, 2);
      const ids = await mintMany(alice, 3);

      await expect(
        game.connect(alice).executeTransition(1, ids, "0x")
      ).to.be.revertedWithCustomError(game, "TooManyAssets");

      // 2 should succeed
      await game
        .connect(alice)
        .executeTransition(1, ids.slice(0, 2), "0x");
    });
  });

  // ═══════════════════════════════════════════
  // 4. Burned Asset Operations
  // ═══════════════════════════════════════════
  describe("Burned asset edge cases", function () {
    it("isLocked on burned asset should revert AssetDoesNotExist", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).burnAsset(id);
      await expect(game.isLocked(id)).to.be.revertedWithCustomError(
        game,
        "AssetDoesNotExist"
      );
    });

    it("locking a burned asset should revert AssetDoesNotExist", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).burnAsset(id);
      await expect(
        game.connect(alice).lockAsset(id)
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("unlocking a burned asset should revert AssetDoesNotExist", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).burnAsset(id);
      await expect(
        game.connect(alice).unlockAsset(id)
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("transition on burned asset should revert AssetDoesNotExist", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).burnAsset(id);
      await expect(
        game.connect(alice).executeTransition(1, [id], "0x")
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("double burn should revert AssetDoesNotExist", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).burnAsset(id);
      await expect(
        game.connect(alice).burnAsset(id)
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("transfer of burned asset should revert AssetDoesNotExist", async function () {
      const id = await mintTo(alice);
      await game.connect(alice).burnAsset(id);
      await expect(
        game.connect(alice).transferAsset(id, bob.address)
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("batch transfer including burned asset should revert", async function () {
      const ids = await mintMany(alice, 3);
      await game.connect(alice).burnAsset(ids[1]);
      await expect(
        game.connect(alice).batchTransfer(ids, bob.address)
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("batch burn including already-burned asset should revert", async function () {
      const ids = await mintMany(alice, 3);
      await game.connect(alice).burnAsset(ids[1]);
      await expect(
        game.connect(alice).batchBurn(ids)
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });
  });

  // ═══════════════════════════════════════════
  // 5. Marketplace Edge Cases
  // ═══════════════════════════════════════════
  describe("Marketplace – edge cases", function () {
    it("listing a non-existent asset should revert AssetDoesNotExist", async function () {
      await expect(
        game.connect(alice).listAsset(999, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(game, "AssetDoesNotExist");
    });

    it("buyAsset should fail with ReceiverInventoryFull when buyer is full", async function () {
      // Fill bob's inventory to 25 (Tier25)
      for (let i = 0; i < 25; i++) {
        await mintTo(bob);
      }

      // Alice lists an asset
      const id = await mintTo(alice);
      const price = ethers.parseEther("0.1");
      await game.connect(alice).listAsset(id, price);

      // Bob's inventory is full → buy should fail
      await expect(
        game.connect(bob).buyAsset(id, { value: price })
      ).to.be.revertedWithCustomError(game, "ReceiverInventoryFull");
    });

    it("should support full list → cancel → re-list → buy cycle", async function () {
      const id = await mintTo(alice);
      const price = ethers.parseEther("0.5");

      // List and cancel
      await game.connect(alice).listAsset(id, price);
      await game.connect(alice).cancelListing(id);

      // Verify unlocked
      expect(await game.isLocked(id)).to.equal(false);

      // Re-list
      await game.connect(alice).listAsset(id, price);
      expect(await game.isLocked(id)).to.equal(true);

      // Buy
      await game.connect(bob).buyAsset(id, { value: price });
      const asset = await game.getAsset(id);
      expect(asset.owner).to.equal(bob.address);
      expect(await game.isLocked(id)).to.equal(false);
    });

    it("buyAsset should unlock before transfer (lock enforcement)", async function () {
      const id = await mintTo(alice);
      const price = ethers.parseEther("0.1");
      await game.connect(alice).listAsset(id, price);

      // The internal flow is: unlock → transfer → pull payment
      // If unlock didn't happen, _transferAssetFrom would revert AssetIsLocked
      const tx = game.connect(bob).buyAsset(id, { value: price });
      await expect(tx).to.emit(game, "AssetUnlocked");
      await expect(tx).to.emit(game, "AssetTransferred");
      await expect(tx).to.emit(game, "AssetSold");
    });
  });

  // ═══════════════════════════════════════════
  // 6. Batch Operation Edge Cases
  // ═══════════════════════════════════════════
  describe("Batch – edge cases", function () {
    it("batch transfer with one locked asset should revert", async function () {
      const ids = await mintMany(alice, 2);
      // Lock first asset via listing
      await game
        .connect(alice)
        .listAsset(ids[0], ethers.parseEther("0.1"));

      await expect(
        game.connect(alice).batchTransfer(ids, bob.address)
      ).to.be.revertedWithCustomError(game, "AssetIsLocked");
    });

    it("batchBurn should revert when exceeding MAX_BATCH_SIZE", async function () {
      // Create 21 asset IDs (we don't actually need to mint all)
      const fakeIds = Array.from({ length: 21 }, (_, i) => BigInt(i + 1));
      await expect(
        game.connect(alice).batchBurn(fakeIds)
      ).to.be.revertedWithCustomError(game, "BatchTooLarge");
    });

    it("batch burn with mixed ownership should revert atomically", async function () {
      const aliceIds = await mintMany(alice, 2);
      const bobId = await mintTo(bob);

      // Alice tries to batch burn including bob's asset
      await expect(
        game.connect(alice).batchBurn([...aliceIds, bobId])
      ).to.be.revertedWithCustomError(game, "NotOwner");

      // Verify ALL assets still exist (atomic — nothing was burned)
      for (const id of [...aliceIds, bobId]) {
        const a = await game.getAsset(id);
        expect(a.owner).to.not.equal(ethers.ZeroAddress);
      }
    });

    it("BatchBurn event should contain all asset IDs", async function () {
      const ids = await mintMany(alice, 3);
      await expect(game.connect(alice).batchBurn(ids))
        .to.emit(game, "BatchBurn")
        .withArgs(ids);
    });

    it("transition with all duplicate IDs [1,1,1,1,1] should revert", async function () {
      const id = await mintTo(alice);
      await expect(
        game
          .connect(alice)
          .executeTransition(1, [id, id, id, id, id], "0x")
      ).to.be.revertedWithCustomError(game, "DuplicateAssetId");
    });
  });

  // ═══════════════════════════════════════════
  // 7. Storage Tier Details
  // ═══════════════════════════════════════════
  describe("Storage Tiers – extended", function () {
    it("should have correct default upgrade costs (0.01, 0.025, 0.05 ETH)", async function () {
      expect(await game.getUpgradeCost(alice.address)).to.equal(
        ethers.parseEther("0.01")
      );

      // Upgrade to Tier50
      await game
        .connect(alice)
        .upgradeStorageTier({ value: ethers.parseEther("0.01") });
      expect(await game.getUpgradeCost(alice.address)).to.equal(
        ethers.parseEther("0.025")
      );

      // Upgrade to Tier75
      await game
        .connect(alice)
        .upgradeStorageTier({ value: ethers.parseEther("0.025") });
      expect(await game.getUpgradeCost(alice.address)).to.equal(
        ethers.parseEther("0.05")
      );

      // Upgrade to Tier100
      await game
        .connect(alice)
        .upgradeStorageTier({ value: ethers.parseEther("0.05") });
      expect(await game.getUpgradeCost(alice.address)).to.equal(0);
    });

    it("userContext should return current tier", async function () {
      // Default tier is 0 (Tier25)
      const ctx = await game.userContext(alice.address);
      expect(ctx.tier).to.equal(0);

      await game
        .connect(alice)
        .upgradeStorageTier({ value: ethers.parseEther("0.01") });
      const ctx2 = await game.userContext(alice.address);
      expect(ctx2.tier).to.equal(1); // Tier50
    });

    it("should allow minting up to Tier75 capacity (75 items)", async function () {
      // Upgrade to Tier75
      await game
        .connect(alice)
        .upgradeStorageTier({ value: ethers.parseEther("0.01") });
      await game
        .connect(alice)
        .upgradeStorageTier({ value: ethers.parseEther("0.025") });

      // Mint 75 assets
      for (let i = 0; i < 75; i++) {
        await mintTo(alice);
      }
      expect(await game.getInventoryCount(alice.address)).to.equal(75);

      // 76th should fail
      await expect(mintTo(alice)).to.be.revertedWithCustomError(
        game,
        "InventoryFull"
      );
    });

    it("should allow minting more after tier upgrade (fill→fail→upgrade→continue)", async function () {
      // Fill Tier25 (25 slots)
      for (let i = 0; i < 25; i++) {
        await mintTo(alice);
      }

      // 26th should fail
      await expect(mintTo(alice)).to.be.revertedWithCustomError(
        game,
        "InventoryFull"
      );

      // Upgrade to Tier50
      await game
        .connect(alice)
        .upgradeStorageTier({ value: ethers.parseEther("0.01") });

      // Now can mint 25 more
      for (let i = 0; i < 25; i++) {
        await mintTo(alice);
      }
      expect(await game.getInventoryCount(alice.address)).to.equal(50);

      // 51st should fail
      await expect(mintTo(alice)).to.be.revertedWithCustomError(
        game,
        "InventoryFull"
      );
    });
  });

  // ═══════════════════════════════════════════
  // 8. Inventory Behavior
  // ═══════════════════════════════════════════
  describe("Inventory – swap-and-pop behavior", function () {
    it("should reflect swap-and-pop ordering after transfer", async function () {
      // Mint [1, 2, 3]
      const id1 = await mintTo(alice);
      const id2 = await mintTo(alice);
      const id3 = await mintTo(alice);

      // Transfer id2 → bob (swap id3 into position of id2)
      await game.connect(alice).transferAsset(id2, bob.address);

      const inv = await game.getInventory(alice.address);
      expect(inv.length).to.equal(2);
      // After swap-and-pop: [id1, id3] (id3 moved into id2's slot)
      const invBigInts = inv.map((x) => BigInt(x));
      expect(invBigInts).to.include(id1);
      expect(invBigInts).to.include(id3);
      expect(invBigInts).to.not.include(id2);
    });

    it("should maintain consistency after multiple non-sequential burns", async function () {
      // Mint 10 assets
      const ids = await mintMany(alice, 10);

      // Burn #3, #7, #1 (0-indexed: ids[2], ids[6], ids[0])
      await game.connect(alice).burnAsset(ids[2]);
      await game.connect(alice).burnAsset(ids[6]);
      await game.connect(alice).burnAsset(ids[0]);

      // Remaining 7 assets should be accessible
      const remaining = [ids[1], ids[3], ids[4], ids[5], ids[7], ids[8], ids[9]];
      for (const id of remaining) {
        const a = await game.getAsset(id);
        expect(a.owner).to.equal(alice.address);
      }

      // Burned ones should revert
      for (const id of [ids[0], ids[2], ids[6]]) {
        await expect(game.getAsset(id)).to.be.revertedWithCustomError(
          game,
          "AssetDoesNotExist"
        );
      }

      expect(await game.getInventoryCount(alice.address)).to.equal(7);

      // Consistency check
      expect(await game.checkInventoryConsistency(alice.address)).to.equal(
        true
      );
    });
  });

  // ═══════════════════════════════════════════
  // 9. Complex Integration Scenarios
  // ═══════════════════════════════════════════
  describe("Integration – complex scenarios", function () {
    it("5-into-1 unification: burn 5, mint 1 new", async function () {
      // Mint 5 assets
      const ids = await mintMany(alice, 5);

      // Burn all 5
      await game.connect(alice).batchBurn(ids);
      expect(await game.getInventoryCount(alice.address)).to.equal(0);

      // All 5 should be gone
      for (const id of ids) {
        await expect(game.getAsset(id)).to.be.revertedWithCustomError(
          game,
          "AssetDoesNotExist"
        );
      }

      // Mint 1 new "unified" asset
      const newId = await mintTo(alice, 42, 0, 10, PAYLOAD_A);
      const asset = await game.getAsset(newId);
      expect(asset.owner).to.equal(alice.address);
      expect(asset.kind).to.equal(42);
      expect(asset.level).to.equal(10);
      expect(await game.getInventoryCount(alice.address)).to.equal(1);

      // New asset should be transferable and usable in transitions
      await game.connect(alice).transferAsset(newId, bob.address);
      expect((await game.getAsset(newId)).owner).to.equal(bob.address);
    });

    it("multiple burn-and-remint cycles", async function () {
      for (let cycle = 0; cycle < 3; cycle++) {
        const id = await mintTo(alice);
        const asset = await game.getAsset(id);
        expect(asset.owner).to.equal(alice.address);

        await game.connect(alice).burnAsset(id);

        await expect(game.getAsset(id)).to.be.revertedWithCustomError(
          game,
          "AssetDoesNotExist"
        );
        expect(await game.getInventoryCount(alice.address)).to.equal(0);
      }
    });

    it("INCREMENT_LEVEL should only change level, not other fields", async function () {
      const id = await mintTo(alice, 7, 0x04, 5, PAYLOAD_A);
      const before = await game.getAsset(id);

      await game.connect(alice).executeTransition(2, [id], "0x");

      const after = await game.getAsset(id);
      expect(after.level).to.equal(before.level + 1n);
      // Everything else should remain unchanged
      expect(after.owner).to.equal(before.owner);
      expect(after.kind).to.equal(before.kind);
      expect(after.flags).to.equal(before.flags);
      expect(after.payload).to.equal(before.payload);
    });
  });

  // ═══════════════════════════════════════════
  // 10. Initial Configuration Defaults
  // ═══════════════════════════════════════════
  describe("Initial configuration defaults", function () {
    it("should have correct initial config values", async function () {
      expect(await game.maxAssetsPerTransitionGlobal()).to.equal(5);
      expect(await game.marketplaceEnabled()).to.equal(true);
      expect(await game.minListingPrice()).to.equal(0);
      expect(await game.mintFee()).to.equal(0);
      expect(await game.owner()).to.equal(owner.address);
    });
  });
});
