import { ZgFile, Indexer } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import "dotenv/config";

const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai";
const OG_INDEXER_RPC =
  process.env.OG_INDEXER_RPC ||
  "https://indexer-storage-testnet-turbo.0g.ai";

export interface UploadResult {
  rootHash: string;
  txHash: string;
}

/**
 * Upload an AI resolution receipt to 0G Storage.
 *
 * Writes the content to a temp file, computes its Merkle tree root,
 * uploads via the 0G Indexer, and returns the root hash + tx hash.
 */
export async function uploadReceipt(content: string): Promise<UploadResult> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set in .env");

  // Write content to a temp file (ZgFile works with file paths)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-"));
  const tmpFile = path.join(tmpDir, "resolution.json");
  fs.writeFileSync(tmpFile, content, { encoding: "utf-8", mode: 0o600 });

  try {
    // Create ZgFile and compute Merkle tree
    const file = await ZgFile.fromFilePath(tmpFile);
    const [tree, treeErr] = await file.merkleTree();
    if (treeErr !== null || tree === null) {
      throw new Error(`Merkle tree error: ${treeErr}`);
    }

    const rootHash = tree.rootHash() as string;
    if (!rootHash) throw new Error("Failed to compute Merkle root hash");
    console.log("[0G Storage] Merkle root hash:", rootHash);

    // Connect signer
    const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
    const signer = new ethers.Wallet(privateKey, provider);

    // Upload via Indexer
    const indexer = new Indexer(OG_INDEXER_RPC);
    console.log("[0G Storage] Uploading receipt...");

    const [tx, uploadErr] = await indexer.upload(file, OG_RPC_URL, signer);
    await file.close();

    if (uploadErr !== null) {
      throw new Error(`Upload error: ${uploadErr}`);
    }

    const txHash =
      tx && "txHash" in tx ? (tx as any).txHash : "unknown";

    console.log("[0G Storage] Upload complete!");
    console.log("[0G Storage] TX hash:", txHash);

    return { rootHash, txHash };
  } finally {
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Allow running directly: ts-node src/uploadReceipt.ts "your content here"
if (require.main === module) {
  const content = process.argv[2] || JSON.stringify({
    market: "ETH Gas > 50 gwei",
    resolution: "NO",
    reasoning: "Sample test resolution",
    timestamp: new Date().toISOString(),
  });

  uploadReceipt(content)
    .then((result) => {
      console.log("\n--- Upload Result ---");
      console.log("Root Hash:", result.rootHash);
      console.log("TX Hash:", result.txHash);
    })
    .catch((err) => {
      console.error("Upload failed:", err);
      process.exit(1);
    });
}
