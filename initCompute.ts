import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import "dotenv/config";

const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";

async function main() {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not set");

    const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log("RPC URL:", OG_RPC_URL);
    console.log("Initializing 0G Compute Account for:", wallet.address);
    const broker = await createZGComputeNetworkBroker(wallet);

    // 1. Deposit funds to the central ledger (units in 0G)
    // The SDK expects a number for amount.
    console.log("[1/2] Depositing 5.0 0G to ledger...");
    try {
        await broker.ledger.depositFund(5.0);
        console.log("Deposit successful!");
    } catch (err: any) {
        console.log("Deposit might have failed or already exists:", err.message.slice(0, 100));
    }

    // 2. Discover a provider and transfer funds to initialize the sub-account (units in neuron)
    // 1 0G = 10^18 neurons.
    console.log("[2/2] Discovering provider to initialize sub-account...");
    const services = await broker.inference.listService();
    const service = services.find((s: any) => s.verifiability === "TeeML" || s.verifiability === "TeeTLS");
    
    if (service) {
        console.log(`Found provider: ${service.provider}. Transferring 1 0G to initialize...`);
        try {
            // transferFund(provider, serviceType, amountInNeurons)
            const one0GInNeurons = BigInt(10) ** BigInt(18);
            await broker.ledger.transferFund(service.provider, "inference", one0GInNeurons);
            console.log("Transfer successful! Account initialized.");
        } catch (err: any) {
            console.log("Transfer failed (maybe already initialized):", err.message.slice(0, 100));
        }
    } else {
        console.log("No TEE provider found to transfer funds to.");
    }

    console.log("\nInitialization check complete.");
}

main().catch(console.error);
