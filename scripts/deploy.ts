import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const factory = await ethers.getContractFactory("InsecureRandomness");
  const randomness = await factory.deploy();
  await randomness.waitForDeployment();

  const address = await randomness.getAddress();
  console.log("InsecureRandomness deployed to:", address);

  // Verify it works
  const matLen = await randomness.RANDOM_MATERIAL_LEN();
  console.log("RANDOM_MATERIAL_LEN:", matLen.toString());

  const seed = await randomness.randomValue(ethers.toUtf8Bytes("deploy-test"));
  console.log("Sample randomValue:", seed);

  const roll = await randomness.randomInRange(
    ethers.toUtf8Bytes("dice-roll"),
    6n
  );
  console.log("Sample dice roll [0-5]:", roll.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
