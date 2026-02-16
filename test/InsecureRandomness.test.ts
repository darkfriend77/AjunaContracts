import { expect } from "chai";
import { ethers, network } from "hardhat";
import { InsecureRandomness } from "../typechain-types";

/**
 * Helper: mine a given number of empty blocks on the Hardhat network.
 */
async function mineBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await network.provider.send("evm_mine");
  }
}

describe("InsecureRandomness", function () {
  let randomness: InsecureRandomness;

  beforeEach(async function () {
    const factory = await ethers.getContractFactory("InsecureRandomness");
    randomness = (await factory.deploy()) as InsecureRandomness;
    await randomness.waitForDeployment();
  });

  // ─────────────────────────────────────────────
  // Constants
  // ─────────────────────────────────────────────
  describe("RANDOM_MATERIAL_LEN", function () {
    it("should be 81", async function () {
      expect(await randomness.RANDOM_MATERIAL_LEN()).to.equal(81n);
    });
  });

  // ─────────────────────────────────────────────
  // random()
  // ─────────────────────────────────────────────
  describe("random()", function () {
    it("should return a non-zero seed with a subject", async function () {
      const [seed, blockOffset] = await randomness.random(
        ethers.toUtf8Bytes("test-context")
      );
      expect(seed).to.not.equal(ethers.ZeroHash);
      expect(blockOffset).to.be.a("bigint");
    });

    it("should return different seeds for different subjects", async function () {
      const [seed1] = await randomness.random(ethers.toUtf8Bytes("subject-a"));
      const [seed2] = await randomness.random(ethers.toUtf8Bytes("subject-b"));
      expect(seed1).to.not.equal(seed2);
    });

    it("should return identical seeds for the same subject in the same block", async function () {
      const [seed1] = await randomness.random(
        ethers.toUtf8Bytes("same-subject")
      );
      const [seed2] = await randomness.random(
        ethers.toUtf8Bytes("same-subject")
      );
      expect(seed1).to.equal(seed2);
    });

    it("should work with an empty subject", async function () {
      const [seed] = await randomness.random(new Uint8Array(0));
      // Even with empty subject, seed should be non-zero (block hashes still mix)
      expect(seed).to.not.equal(ethers.ZeroHash);
    });

    it("should produce different seeds across blocks", async function () {
      const [seed1] = await randomness.random(
        ethers.toUtf8Bytes("cross-block")
      );

      // Mine a block so the set of block hashes changes
      await mineBlocks(1);

      const [seed2] = await randomness.random(
        ethers.toUtf8Bytes("cross-block")
      );

      expect(seed1).to.not.equal(seed2);
    });

    it("should produce distinct seeds over several consecutive blocks", async function () {
      const seeds = new Set<string>();

      for (let i = 0; i < 5; i++) {
        const [seed] = await randomness.random(
          ethers.toUtf8Bytes("evolving")
        );
        seeds.add(seed);
        await mineBlocks(1);
      }

      // All 5 seeds should be unique
      expect(seeds.size).to.equal(5);
    });

    it("should handle a large subject payload", async function () {
      // 1 KB of subject data
      const largeSubject = new Uint8Array(1024).fill(0xab);
      const [seed] = await randomness.random(largeSubject);
      expect(seed).to.not.equal(ethers.ZeroHash);
    });

    it("should differentiate subjects that are prefixes of each other", async function () {
      const [seed1] = await randomness.random(ethers.toUtf8Bytes("abc"));
      const [seed2] = await randomness.random(ethers.toUtf8Bytes("abcdef"));
      expect(seed1).to.not.equal(seed2);
    });
  });

  // ─────────────────────────────────────────────
  // Block offset correctness
  // ─────────────────────────────────────────────
  describe("blockOffset", function () {
    it("should return 0 when chain is shorter than RANDOM_MATERIAL_LEN", async function () {
      // In early blocks (< 81), the offset should be 0
      const currentBlock = await ethers.provider.getBlockNumber();
      if (currentBlock < 81) {
        const [, offset] = await randomness.random(
          ethers.toUtf8Bytes("offset-test")
        );
        expect(offset).to.equal(0n);
      }
    });

    it("should equal currentBlock - 81 when chain is long enough", async function () {
      // Mine enough blocks to exceed RANDOM_MATERIAL_LEN
      const currentBlock = await ethers.provider.getBlockNumber();
      const blocksNeeded = 82 - currentBlock;
      if (blocksNeeded > 0) {
        await mineBlocks(blocksNeeded);
      }

      const blockAtCall = await ethers.provider.getBlockNumber();
      const [, offset] = await randomness.random(
        ethers.toUtf8Bytes("offset-long")
      );

      // blockOffset = currentBlock - 81
      // Note: view calls execute in the context of the latest block
      expect(offset).to.equal(BigInt(blockAtCall) - 81n);
    });
  });

  // ─────────────────────────────────────────────
  // randomValue()
  // ─────────────────────────────────────────────
  describe("randomValue()", function () {
    it("should return a bytes32 value", async function () {
      const value = await randomness.randomValue(
        ethers.toUtf8Bytes("my-context")
      );
      expect(value).to.have.length(66); // "0x" + 64 hex chars
      expect(value).to.not.equal(ethers.ZeroHash);
    });

    it("should match the seed from random() for the same subject and block", async function () {
      const subject = ethers.toUtf8Bytes("consistency-check");
      const value = await randomness.randomValue(subject);
      const [seed] = await randomness.random(subject);
      expect(value).to.equal(seed);
    });

    it("should work with empty subject", async function () {
      const value = await randomness.randomValue(new Uint8Array(0));
      expect(value).to.not.equal(ethers.ZeroHash);
    });
  });

  // ─────────────────────────────────────────────
  // randomInRange()
  // ─────────────────────────────────────────────
  describe("randomInRange()", function () {
    it("should return a value in [0, max)", async function () {
      const max = 100n;
      const result = await randomness.randomInRange(
        ethers.toUtf8Bytes("range-test"),
        max
      );
      expect(result).to.be.gte(0n);
      expect(result).to.be.lt(max);
    });

    it("should revert when max is 0", async function () {
      await expect(
        randomness.randomInRange(ethers.toUtf8Bytes("bad"), 0n)
      ).to.be.revertedWith("max must be > 0");
    });

    it("should always return 0 when max is 1", async function () {
      // With max=1, the only valid result is 0
      for (let i = 0; i < 3; i++) {
        const r = await randomness.randomInRange(
          ethers.toUtf8Bytes(`max1-${i}`),
          1n
        );
        expect(r).to.equal(0n);
      }
    });

    it("should return a value in range for max = 2 (coin flip)", async function () {
      const result = await randomness.randomInRange(
        ethers.toUtf8Bytes("coin-flip"),
        2n
      );
      expect(result).to.be.oneOf([0n, 1n]);
    });

    it("should return different values for different subjects", async function () {
      const results = new Set<bigint>();
      for (let i = 0; i < 5; i++) {
        const r = await randomness.randomInRange(
          ethers.toUtf8Bytes(`subj-${i}`),
          1_000_000n
        );
        results.add(r);
      }
      // At least 2 distinct values out of 5 (overwhelmingly likely)
      expect(results.size).to.be.gte(2);
    });

    it("should handle very large max values", async function () {
      const largeMax = 2n ** 128n;
      const result = await randomness.randomInRange(
        ethers.toUtf8Bytes("large-max"),
        largeMax
      );
      expect(result).to.be.gte(0n);
      expect(result).to.be.lt(largeMax);
    });

    it("should handle max = type(uint256).max", async function () {
      const maxUint = 2n ** 256n - 1n;
      const result = await randomness.randomInRange(
        ethers.toUtf8Bytes("uint-max"),
        maxUint
      );
      expect(result).to.be.gte(0n);
      expect(result).to.be.lt(maxUint);
    });

    it("should produce different results across blocks", async function () {
      const subject = ethers.toUtf8Bytes("range-cross-block");
      const r1 = await randomness.randomInRange(subject, 1_000_000n);

      await mineBlocks(1);

      const r2 = await randomness.randomInRange(subject, 1_000_000n);

      // Same subject, different block → different result (with overwhelming probability)
      expect(r1).to.not.equal(r2);
    });

    it("should be consistent with randomValue modulo max", async function () {
      const subject = ethers.toUtf8Bytes("modulo-check");
      const max = 997n; // prime number

      const rangeResult = await randomness.randomInRange(subject, max);
      const rawValue = await randomness.randomValue(subject);

      // randomInRange = uint256(randomValue) % max
      const expected = BigInt(rawValue) % max;
      expect(rangeResult).to.equal(expected);
    });
  });

  // ─────────────────────────────────────────────
  // Domain separation & mixing properties
  // ─────────────────────────────────────────────
  describe("mixing properties", function () {
    it("should be sensitive to single-byte subject differences", async function () {
      const [seed1] = await randomness.random(new Uint8Array([0x00]));
      const [seed2] = await randomness.random(new Uint8Array([0x01]));
      expect(seed1).to.not.equal(seed2);
    });

    it("should be sensitive to subject length (padding attack resistance)", async function () {
      // "\x01" vs "\x01\x00" — different lengths, starts with same byte
      const [seed1] = await randomness.random(new Uint8Array([0x01]));
      const [seed2] = await randomness.random(new Uint8Array([0x01, 0x00]));
      expect(seed1).to.not.equal(seed2);
    });

    it("should produce uniform-looking output (basic entropy check)", async function () {
      // Generate several random values and check they have good bit distribution
      // This is a basic sanity check, not a statistical test
      const values: bigint[] = [];
      for (let i = 0; i < 10; i++) {
        const v = await randomness.randomValue(
          ethers.toUtf8Bytes(`entropy-${i}`)
        );
        values.push(BigInt(v));
      }

      // All values should be unique
      const unique = new Set(values.map((v) => v.toString()));
      expect(unique.size).to.equal(10);

      // No value should be zero
      for (const v of values) {
        expect(v).to.not.equal(0n);
      }
    });
  });
});
