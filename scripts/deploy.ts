import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // ── Step 1: Deploy InsecureRandomness ──
  console.log("\n── Deploying InsecureRandomness ──");
  const rngFactory = await ethers.getContractFactory("InsecureRandomness");
  const randomness = await rngFactory.deploy();
  await randomness.waitForDeployment();

  const rngAddress = await randomness.getAddress();
  console.log("InsecureRandomness deployed to:", rngAddress);

  // Verify RNG works
  const matLen = await randomness.RANDOM_MATERIAL_LEN();
  console.log("RANDOM_MATERIAL_LEN:", matLen.toString());

  const seed = await randomness.randomValue(ethers.toUtf8Bytes("deploy-test"));
  console.log("Sample randomValue:", seed);

  const roll = await randomness.randomInRange(
    ethers.toUtf8Bytes("dice-roll"),
    6n
  );
  console.log("Sample dice roll [0-5]:", roll.toString());

  // ── Step 2: Deploy CasinoJam ──
  console.log("\n── Deploying CasinoJam ──");
  const cjFactory = await ethers.getContractFactory("CasinoJam");
  const casinoJam = await cjFactory.deploy(rngAddress);
  await casinoJam.waitForDeployment();

  const cjAddress = await casinoJam.getAddress();
  console.log("CasinoJam deployed to:", cjAddress);

  // Verify CasinoJam
  const rate = await casinoJam.exchangeRate();
  console.log("Exchange rate:", rate.toString(), "wei/credit");

  const rng = await casinoJam.rngContract();
  console.log("RNG contract:", rng);

  console.log("\n── Deployment Complete ──");
  console.log("InsecureRandomness:", rngAddress);
  console.log("CasinoJam:         ", cjAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
