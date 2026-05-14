import { ethers } from "ethers";
import { uploadReceipt } from "./uploadReceipt.js";
import { fetchMarketData, formatMarketDataForPrompt, type MarketData } from "./fetchMarketData.js";
import { teeInference, discoverProviders, type TeeInferenceResult } from "./teeInference.js";
import "dotenv/config";

// ─── Configuration ──────────────────────────────────────────────────────────

const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai";

// Contract ABI (only the functions we need)
const ORACLE_ABI = [
  "function recordResolution(uint256 tokenId, bytes32 storageRoot, bytes teeSignature, address teeSigner) external",
  "function resolutionCount(uint256 tokenId) external view returns (uint256)",
];

// ─── Oracle Prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(marketData: MarketData, dataHash: string): string {
  const dataBlock = formatMarketDataForPrompt(marketData);
  return `You are the Sealed Precision Oracle, a tamper-proof AI judge for precision prediction markets.

REAL-TIME DATA PROVIDED (verified from live sources):
${dataBlock}
Data integrity hash: ${dataHash}

Your role:
1. Use the REAL DATA above (do NOT hallucinate values).
2. Evaluate the market question against this data.
3. Provide a clear YES or NO resolution.
4. State your confidence level (0-100%).
5. Explain your reasoning step by step, referencing the actual data.

Respond in this exact JSON format:
{
  "market_question": "<the question>",
  "resolution": "YES" or "NO",
  "confidence": <0-100>,
  "reasoning": "<step-by-step reasoning citing the real data>",
  "data_integrity_hash": "${dataHash}",
  "data_used": ${JSON.stringify(marketData.dataPoints)},
  "timestamp": "<current UTC timestamp>"
}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const marketQuestion =
    process.argv[2] ||
    "Will the average Ethereum mainnet gas price exceed 50 gwei right now?";
  const contractAddress = process.env.ORACLE_CONTRACT_ADDRESS;
  const tokenId = parseInt(process.env.ORACLE_TOKEN_ID || "1", 10);

  console.log("=== Sealed Precision Oracle v3.0 ===\n");
  console.log("Market Question:", marketQuestion);

  // ── Step 1: Fetch real market data ───────────────────────────────────
  console.log("\n[1/5] Fetching real-time market data...\n");

  const marketData = await fetchMarketData(marketQuestion);
  console.log("  Type:", marketData.marketType);
  for (const [k, v] of Object.entries(marketData.dataPoints)) {
    if (v !== null) console.log(`  ${k}: ${v}`);
  }
  console.log("  Source:", marketData.source);

  // Compute data integrity hash from data points only (excludes timestamp for stability)
  const stableData = JSON.stringify(marketData.dataPoints);
  const dataHash = ethers.keccak256(ethers.toUtf8Bytes(stableData));
  console.log("  Data hash:", dataHash);

  // ── Step 2: Run TEE-attested inference ──────────────────────────────
  console.log("\n[2/5] Running TEE-attested inference (direct provider)...\n");

  const systemPrompt = buildSystemPrompt(marketData, dataHash);
  const userPrompt = `Resolve this market: ${marketQuestion}`;

  let inferenceResult: TeeInferenceResult;
  try {
    inferenceResult = await teeInference(systemPrompt, userPrompt);
  } catch (err: any) {
    console.warn("\n  ╔══════════════════════════════════════════════════════════╗");
    console.warn("  ║  WARNING: FALLING BACK TO ROUTER API                    ║");
    console.warn("  ║  No per-inference TEE attestation will be available.     ║");
    console.warn("  ║  The AI response will NOT be cryptographically signed.   ║");
    console.warn("  ╚══════════════════════════════════════════════════════════╝\n");
    console.warn("[TEE] Reason:", err.message);

    // Fallback to Router if no direct providers available
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      baseURL: "https://router-api.0g.ai/v1",
      apiKey: process.env.ZG_API_KEY || "not-needed-for-testnet",
    });
    const completion = await client.chat.completions.create({
      model: "Qwen/Qwen2.5-7B-Instruct",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    });

    inferenceResult = {
      content: completion.choices[0]?.message?.content || "",
      chatId: completion.id || "unknown",
      model: "Qwen/Qwen2.5-7B-Instruct",
      providerAddress: "router-api (no direct provider)",
      providerUrl: "https://router-api.0g.ai/v1",
      attestation: null,
      attestationNote:
        "FALLBACK: Used Router API. No per-inference TEE attestation available. " +
        "Direct provider access failed: " + err.message,
    };
  }

  if (!inferenceResult.content) throw new Error("No response from inference");
  console.log("\nAI Resolution:\n", inferenceResult.content);

  // ── Step 3: Build receipt with cryptographic binding ────────────────
  console.log("\n[3/5] Building tamper-evident receipt...\n");

  // Hash the AI response for integrity binding
  const responseHash = ethers.keccak256(
    ethers.toUtf8Bytes(inferenceResult.content)
  );

  const receipt = {
    oracle: "Sealed Precision Oracle v3.0",
    model: inferenceResult.model,
    provider: {
      address: inferenceResult.providerAddress,
      url: inferenceResult.providerUrl,
    },
    tee_attestation: inferenceResult.attestation
      ? {
          verified: inferenceResult.attestation.verified,
          signed_text: inferenceResult.attestation.signedText,
          signature: inferenceResult.attestation.signature,
          tee_signer: inferenceResult.attestation.teeSigner,
          recovered_address: inferenceResult.attestation.recoveredAddress,
          chat_id: inferenceResult.chatId,
          note: inferenceResult.attestationNote,
        }
      : {
          verified: false,
          note: inferenceResult.attestationNote,
        },
    integrity: {
      data_hash: dataHash,
      response_hash: responseHash,
      note:
        "data_hash = keccak256(market_data_json). response_hash = keccak256(ai_response). " +
        "data_hash is embedded in the AI prompt so the TEE-signed response implicitly commits to the data.",
    },
    market_data: {
      type: marketData.marketType,
      data_points: marketData.dataPoints,
      source: marketData.source,
      fetched_at: marketData.fetchedAt,
    },
    market_question: marketQuestion,
    ai_response: inferenceResult.content,
    created_at: new Date().toISOString(),
  };

  // ── Step 4: Upload to 0G Storage ───────────────────────────────────
  console.log("[4/5] Uploading receipt to 0G Storage...\n");

  const receiptJSON = JSON.stringify(receipt, null, 2);
  const { rootHash, txHash } = await uploadReceipt(receiptJSON);

  // ── Step 5: Record on-chain with TEE signature ─────────────────────
  let chainTxHash: string | null = null;

  if (contractAddress) {
    console.log("\n[5/5] Recording resolution on-chain...\n");

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY required for on-chain recording");

    const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
    const signer = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddress, ORACLE_ABI, signer);

    // rootHash is 0x-prefixed hex — convert to bytes32
    const rootHashBytes32 = ethers.zeroPadValue(rootHash, 32);

    // Pass TEE signature and signer for on-chain verification
    const teeSignature = inferenceResult.attestation?.signature
      ? inferenceResult.attestation.signature
      : "0x";
    const teeSigner = inferenceResult.attestation?.teeSigner
      ? inferenceResult.attestation.teeSigner
      : ethers.ZeroAddress;

    const tx = await contract.recordResolution(
      tokenId,
      rootHashBytes32,
      teeSignature,
      teeSigner
    );
    const receiptTx = await tx.wait();
    chainTxHash = receiptTx?.hash || tx.hash;

    const count = await contract.resolutionCount(tokenId);
    console.log("  On-chain TX:", chainTxHash);
    console.log("  Total resolutions for token", tokenId + ":", count.toString());
  } else {
    console.log("\n[5/5] Skipped on-chain recording (ORACLE_CONTRACT_ADDRESS not set)");
    console.log("  Set ORACLE_CONTRACT_ADDRESS in .env after deploying the contract.");
  }

  // ── Final Summary ────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(56));
  console.log("  SEALED PRECISION ORACLE — RESOLUTION COMPLETE");
  console.log("=".repeat(56) + "\n");
  console.log("Market Question:", marketQuestion);
  const dataPreview = Object.entries(marketData.dataPoints)
    .filter(([_, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  console.log("Real Data:      ", dataPreview);
  console.log("Data Hash:      ", dataHash.slice(0, 18) + "...");
  console.log("Response Hash:  ", responseHash.slice(0, 18) + "...");

  if (inferenceResult.attestation?.verified) {
    console.log("TEE Attestation: VERIFIED (per-inference signature)");
    console.log("  Signer:       ", inferenceResult.attestation.teeSigner);
  } else {
    console.log("TEE Attestation:", inferenceResult.attestationNote.slice(0, 80));
  }

  console.log("\n0G Storage Root:", rootHash);
  console.log("0G Storage TX:  ", txHash);
  if (chainTxHash) {
    console.log("0G Chain TX:    ", chainTxHash);
    console.log("Explorer:        https://chainscan-galileo.0g.ai/tx/" + chainTxHash);
  }
  console.log(
    "\nVerification: Download the receipt from 0G Storage using the root hash."
  );
  console.log(
    "The receipt contains the TEE signature — verify it against the on-chain TEE signer."
  );
  console.log();
}

main().catch((err) => {
  console.error("Oracle execution failed:", err);
  process.exit(1);
});
