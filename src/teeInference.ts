/**
 * Direct TEE-attested inference via the 0G Compute SDK.
 *
 * Bypasses the Router API entirely. Instead:
 *  1. Discovers providers on-chain from the InferenceServing contract
 *  2. Calls inference directly to the provider's broker URL
 *  3. Fetches the per-inference TEE signature from the provider
 *  4. Verifies the signature against the on-chain TEE signer address
 *
 * This provides REAL per-inference attestation, not just metadata.
 */

import { ethers } from "ethers";
import {
  createZGComputeNetworkBroker,
  createZGComputeNetworkReadOnlyBroker,
} from "@0gfoundation/0g-compute-ts-sdk";
import OpenAI from "openai";
import "dotenv/config";

const OG_RPC_URL = process.env.OG_RPC_URL || "https://evmrpc-testnet.0g.ai";

export interface TeeAttestation {
  signedText: string;
  signature: string;
  teeSigner: string;
  recoveredAddress: string;
  verified: boolean;
}

export interface TeeInferenceResult {
  content: string;
  chatId: string;
  model: string;
  providerAddress: string;
  providerUrl: string;
  attestation: TeeAttestation | null;
  attestationNote: string;
}

export interface ProviderInfo {
  provider: string;
  url: string;
  model: string;
  verifiability: string;
  teeSignerAddress: string;
}

/**
 * Discover TEE-attested providers for a given model from the on-chain registry.
 */
export async function discoverProviders(
  modelQuery?: string
): Promise<ProviderInfo[]> {
  const broker = await createZGComputeNetworkReadOnlyBroker(OG_RPC_URL);
  const services = await broker.inference.listService();

  return services
    .filter((s: any) => {
      const isTee =
        s.verifiability === "TeeML" || s.verifiability === "TeeTLS";
      const modelMatch = modelQuery
        ? s.model?.toLowerCase().includes(modelQuery.toLowerCase())
        : true;
      return isTee && modelMatch;
    })
    .map((s: any) => ({
      provider: s.provider,
      url: s.url,
      model: s.model,
      verifiability: s.verifiability,
      teeSignerAddress: s.teeSignerAddress,
    }));
}

/**
 * Run inference directly on a TEE-attested provider and verify the response signature.
 */
export async function teeInference(
  systemPrompt: string,
  userPrompt: string,
  modelQuery?: string
): Promise<TeeInferenceResult> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set in .env");

  const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  // 1. Create broker with wallet (needed for auth headers + fees)
  console.log("[TEE] Creating compute broker...");
  const broker = await createZGComputeNetworkBroker(wallet);

  // 2. Discover providers on-chain
  console.log("[TEE] Discovering providers from on-chain registry...");
  const services = await broker.inference.listService();
  const service = services.find((s: any) => {
    const isTee =
      s.verifiability === "TeeML" || s.verifiability === "TeeTLS";
    const modelMatch = modelQuery
      ? s.model?.toLowerCase().includes(modelQuery.toLowerCase())
      : true;
    return isTee && modelMatch;
  });

  if (!service) {
    // Fallback: list what's available
    const available = services.map((s: any) => `${s.model} (${s.verifiability})`);
    throw new Error(
      `No TEE provider found for model query "${modelQuery}". ` +
      `Available: ${available.join(", ") || "none"}`
    );
  }

  const providerAddress = service.provider;
  const providerUrl = service.url;
  const model = service.model;
  const teeSigner = service.teeSignerAddress;

  console.log(`[TEE] Found provider: ${providerAddress}`);
  console.log(`[TEE] Model: ${model}`);
  console.log(`[TEE] URL: ${providerUrl}`);
  console.log(`[TEE] TEE signer: ${teeSigner}`);
  console.log(`[TEE] Verifiability: ${service.verifiability}`);

  // 3. Setup: deposit funds and acknowledge provider
  try {
    await broker.ledger.depositFund(0.001); // Small deposit for testnet
    console.log("[TEE] Deposited funds to ledger");
  } catch (err: any) {
    // May fail if already deposited — that's OK
    console.log("[TEE] Deposit skipped (may already have funds):", err.message?.slice(0, 80));
  }

  try {
    await broker.inference.acknowledgeProviderSigner(providerAddress);
    console.log("[TEE] Acknowledged provider TEE signer");
  } catch (err: any) {
    console.log("[TEE] Acknowledge skipped (may already be done):", err.message?.slice(0, 80));
  }

  // 4. Get endpoint and auth headers
  const metadata = await broker.inference.getServiceMetadata(providerAddress);
  const headers = await broker.inference.getRequestHeaders(providerAddress);

  console.log("[TEE] Calling inference directly on provider...");

  // 5. Direct inference call to provider (no Router)
  const openai = new OpenAI({ baseURL: metadata.endpoint, apiKey: "" });
  const { data: completion, response: httpResponse } =
    await openai.chat.completions
      .create(
        {
          model: metadata.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 1024,
        },
        { headers: { ...headers } }
      )
      .withResponse();

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from provider");

  // Get chat ID from response header (for signature lookup)
  const chatId =
    httpResponse.headers.get("ZG-Res-Key") || completion.id || "unknown";

  console.log("[TEE] Got response, chat ID:", chatId);

  // 6. Process response (fees + signature verification via SDK)
  let sdkVerified: boolean | null = null;
  try {
    sdkVerified = await broker.inference.processResponse(
      providerAddress,
      chatId,
      JSON.stringify(completion.usage || {})
    );
    console.log("[TEE] SDK processResponse result:", sdkVerified);
  } catch (err: any) {
    console.log("[TEE] SDK processResponse failed:", err.message?.slice(0, 100));
  }

  // 7. Manual signature verification for full transparency
  let attestation: TeeAttestation | null = null;
  let attestationNote = "";

  try {
    const sigUrl = `${providerUrl}/v1/proxy/signature/${chatId}?model=${model}`;
    console.log("[TEE] Fetching per-inference signature...");
    const sigRes = await fetch(sigUrl, { signal: AbortSignal.timeout(10_000) });

    if (sigRes.ok) {
      const { text: signedText, signature } = (await sigRes.json()) as {
        text: string;
        signature: string;
      };

      // Determine the expected signing address
      let expectedSigner = teeSigner;
      try {
        const additionalInfo = JSON.parse(
          (service as any).additionalInfo || "{}"
        );
        if (
          additionalInfo.TargetSeparated &&
          additionalInfo.ProviderType !== "centralized" &&
          additionalInfo.TargetTeeAddress
        ) {
          expectedSigner = additionalInfo.TargetTeeAddress;
        }
      } catch {}

      // Verify ECDSA signature
      const messageHash = ethers.hashMessage(signedText);
      const recoveredAddress = ethers.recoverAddress(messageHash, signature);
      const verified =
        recoveredAddress.toLowerCase() === expectedSigner.toLowerCase();

      attestation = {
        signedText,
        signature,
        teeSigner: expectedSigner,
        recoveredAddress,
        verified,
      };

      attestationNote = verified
        ? `PER-INFERENCE TEE attestation VERIFIED. ` +
          `Response signed by ${recoveredAddress}, matches on-chain TEE signer ${expectedSigner}.`
        : `PER-INFERENCE TEE signature recovered ${recoveredAddress} but expected ${expectedSigner}. MISMATCH.`;

      console.log("[TEE]", attestationNote);
    } else {
      attestationNote = `Signature endpoint returned ${sigRes.status}. Per-inference attestation unavailable.`;
      console.log("[TEE]", attestationNote);
    }
  } catch (err: any) {
    attestationNote = `Signature fetch failed: ${err.message}. Per-inference attestation unavailable.`;
    console.log("[TEE]", attestationNote);
  }

  return {
    content,
    chatId,
    model,
    providerAddress,
    providerUrl,
    attestation,
    attestationNote,
  };
}

// Allow direct execution for testing
if (require.main === module) {
  (async () => {
    console.log("=== TEE Provider Discovery ===\n");
    try {
      const providers = await discoverProviders();
      console.log(`Found ${providers.length} TEE providers:\n`);
      for (const p of providers) {
        console.log(`  ${p.model} | ${p.verifiability} | ${p.provider.slice(0, 10)}...`);
      }
    } catch (err) {
      console.error("Discovery failed:", err);
    }
  })();
}
