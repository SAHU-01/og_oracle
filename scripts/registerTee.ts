import { ethers } from "hardhat";
import "dotenv/config";

async function main() {
    const oracleAddress = "0xf25E765eF573c26d6314Fd83822564E7AF11C9Ac";
    const teeSigner = "0x4C1b546f5Fc11A9c2428eaFEd1D951Aa13C17ee8";
    
    console.log("Registering TEE Signer on Mainnet...");
    const oracle = await ethers.getContractAt("PrecisionOracleID", oracleAddress);
    
    const tx = await oracle.registerTeeSigner(teeSigner);
    console.log("Transaction hash:", tx.hash);
    
    await tx.wait();
    console.log("TEE Signer registered successfully!");
}

main().catch(console.error);
