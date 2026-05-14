import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "0G\n");

  // 1. Deploy the DataVerifier (validates ECDSA signatures in transfer proofs)
  console.log("Deploying OracleDataVerifier...");
  const Verifier = await ethers.getContractFactory("OracleDataVerifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log("OracleDataVerifier deployed to:", verifierAddress);

  // 2. Deploy the Oracle ID contract with verifier address
  console.log("\nDeploying PrecisionOracleID...");
  const PrecisionOracleID = await ethers.getContractFactory("PrecisionOracleID");
  const oracle = await PrecisionOracleID.deploy(verifierAddress);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("PrecisionOracleID deployed to:", oracleAddress);

  // 3. Mint the first Oracle agent identity to the deployer
  const mintTx = await oracle.mint(deployer.address);
  await mintTx.wait();
  console.log("Minted Oracle Agent Token #1 to:", deployer.address);

  // 4. Summary
  console.log("\n" + "=".repeat(50));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("=".repeat(50));
  console.log("\nContracts:");
  console.log("  Verifier:", verifierAddress);
  console.log("  Oracle:  ", oracleAddress);
  console.log("\nNetwork: 0G Galileo Testnet (Chain ID 16601)");
  console.log("Explorer:", "https://chainscan-galileo.0g.ai/address/" + oracleAddress);
  console.log("\nAdd to your .env:");
  console.log(`  ORACLE_CONTRACT_ADDRESS=${oracleAddress}`);
  console.log("\nTo register a TEE signer (after discovering one via the oracle):");
  console.log("  npx hardhat console --network og_galileo");
  console.log('  > const oracle = await ethers.getContractAt("PrecisionOracleID", "' + oracleAddress + '")');
  console.log('  > await oracle.registerTeeSigner("0xTEE_SIGNER_ADDRESS")');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
