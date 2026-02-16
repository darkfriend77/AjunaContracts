import { HardhatUserConfig, vars } from "hardhat/config";
import "@parity/hardhat-polkadot";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";

const PRIVATE_KEY = vars.has("PRIVATE_KEY")
  ? vars.get("PRIVATE_KEY")
  : "0x0000000000000000000000000000000000000000000000000000000000000000";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 50,
      },
    },
  },
  networks: {
    hardhatNode: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    local: {
      url: "http://127.0.0.1:8545",
      chainId: 420420420,
      // Alith — pre-funded dev account on revive-dev-node
      accounts: [
        "0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133",
      ],
      gasPrice: 50000000000,
      gas: 6000000,
      timeout: 60000,
    },
    polkadotTestnet: {
      url: "https://eth-rpc-testnet.polkadot.io/",
      chainId: 420420417,
      accounts: [PRIVATE_KEY],
    },
    polkadotMainnet: {
      url: "https://eth-rpc.polkadot.io/",
      chainId: 420420419,
      accounts: [PRIVATE_KEY],
    },
  },
};

export default config;
