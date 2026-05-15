import express from "express";
import cors from "cors";
import "dotenv/config";
import { ethers } from "ethers";
import { fetchMarketData, formatMarketDataForPrompt } from "./fetchMarketData";
import { teeInference, type TeeInferenceResult } from "./teeInference";
import { uploadReceipt } from "./uploadReceipt";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Main Resolution Endpoint
app.post("/api/resolve", async (req, res) => {
  const { marketQuestion } = req.body;

  if (!marketQuestion) {
    return res.status(400).json({ error: "marketQuestion is required" });
  }

  console.log(`\n--- New Resolution Request: "${marketQuestion}" ---`);

  try {
    // 1. Fetch Data
    console.log("[1/3] Fetching market data...");
    const marketData = await fetchMarketData(marketQuestion);
    const dataContext = formatMarketDataForPrompt(marketData);

    // 2. TEE Inference
    console.log("[2/3] Running TEE inference...");
    const systemPrompt = `You are a precision market resolution oracle. Use the provided real-time data to answer the market question.`;
    const inferenceResult: TeeInferenceResult = await teeInference(
      systemPrompt,
      `Market Question: ${marketQuestion}\n\nData Context:\n${dataContext}`
    );

    if (!inferenceResult.content) {
      throw new Error("AI failed to provide a resolution");
    }

    // Parse the AI response (it's expected to be a JSON string inside the content)
    let resolutionData;
    try {
      const jsonMatch = inferenceResult.content.match(/\{[\s\S]*\}/);
      resolutionData = JSON.parse(jsonMatch ? jsonMatch[0] : inferenceResult.content);
    } catch (e) {
      console.warn("Failed to parse AI response as JSON, using raw content.");
      resolutionData = { resolution: "ERROR", reasoning: inferenceResult.content, confidence: 0 };
    }

    // 3. Upload to 0G Storage
    console.log("[3/3] Uploading receipt to 0G Storage...");
    const receipt = {
      marketQuestion,
      marketData,
      inference: {
        content: inferenceResult.content,
        model: inferenceResult.model,
        provider: inferenceResult.providerAddress,
        chatId: inferenceResult.chatId,
      },
      attestation: inferenceResult.attestation,
      timestamp: new Date().toISOString(),
    };

    const { rootHash } = await uploadReceipt(JSON.stringify(receipt));
    console.log(`[3/3] Root Hash: ${rootHash}`);

    // 4. Record on 0G Chain (On-chain settlement)
    console.log("[4/4] Recording resolution on 0G Chain...");
    const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc.0g.ai";
    const PRIVATE_KEY = process.env.PRIVATE_KEY;
    const ORACLE_CONTRACT_ADDRESS = process.env.ORACLE_CONTRACT_ADDRESS || "0xf25E765eF573c26d6314Fd83822564E7AF11C9Ac";

    let txHash = "0x";
    if (PRIVATE_KEY) {
      const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
      const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
      const ORACLE_ABI = [
        "function recordResolution(uint256 tokenId, bytes32 storageRoot, string calldata signedText, bytes calldata teeSignature, address teeSigner) external",
      ];
      const contract = new ethers.Contract(ORACLE_CONTRACT_ADDRESS, ORACLE_ABI, wallet);
      
      const tx = await contract.recordResolution(
        1, // Default Token ID
        rootHash,
        inferenceResult.attestation?.signedText || "",
        inferenceResult.attestation?.signature || "0x",
        inferenceResult.attestation?.teeSigner || ethers.ZeroAddress
      );
      await tx.wait();
      txHash = tx.hash;
      console.log(`[Done] On-chain TX: ${txHash}`);
    } else {
      console.warn("No PRIVATE_KEY provided in API, skipping on-chain recording.");
    }

    // Return the results + proofs
    res.json({
      success: true,
      resolution: resolutionData.resolution,
      confidence: resolutionData.confidence,
      reasoning: resolutionData.reasoning,
      data_used: marketData,
      proofs: {
        storageRoot: rootHash,
        onChainTx: txHash,
        teeSigner: inferenceResult.attestation?.teeSigner || ethers.ZeroAddress,
      }
    });

  } catch (error: any) {
    console.error("Resolution failed:", error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Internal Server Error" 
    });
  }
});

app.listen(PORT, () => {
  console.log(`0G Oracle API Bridge running on http://localhost:${PORT}`);
  console.log("Ready to handle verifiable AI resolutions.");
});
