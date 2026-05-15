import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import "dotenv/config";

const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";

async function main() {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not set");

    const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log("=== 0G BALANCE REPORT ===");
    console.log("Wallet Address:", wallet.address);

    // 1. Native 0G Balance
    const balance = await provider.getBalance(wallet.address);
    console.log("Native 0G Balance:", ethers.formatEther(balance), "0G");

    // 2. Compute Broker Initialization
    const broker = await createZGComputeNetworkBroker(wallet);

    // 3. Central Ledger Balance
    try {
        const ledger: any = await broker.ledger.getLedger();
        console.log("\n--- Compute Ledger ---");
        console.log("Available Balance:", ledger.availableBalance.toString(), "neurons");
        console.log("Available Balance (0G):", ethers.formatUnits(ledger.availableBalance, 18), "0G");
        console.log("Total Balance (0G):    ", ethers.formatUnits(ledger.totalBalance, 18), "0G");
    } catch (err: any) {
        console.log("No Central Ledger found for this user.");
    }

    // 4. Inference Sub-accounts (Check the specific provider used in oracle)
    console.log("\n--- Inference Sub-accounts (Checking active providers) ---");
    const providers = await broker.inference.listService();
    let accountsFound = 0;
    
    for (const p of providers) {
        try {
            const acc: any = await broker.inference.getAccount(p.provider);
            if (acc && acc.balance > 0n) {
                console.log(`Provider: ${p.provider} (${p.model})`);
                console.log(`  Balance (0G): ${ethers.formatUnits(acc.balance, 18)} 0G`);
                console.log(`  Pending Refund: ${ethers.formatUnits(acc.pendingRefund, 18)} 0G`);
                accountsFound++;
            }
        } catch (err) {
            // Likely no account for this provider
        }
    }

    if (accountsFound === 0) {
        console.log("No active inference sub-accounts with balances found.");
    }
    
    console.log("\n" + "=".repeat(25));
}

main().catch(console.error);
