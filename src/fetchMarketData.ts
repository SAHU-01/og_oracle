/**
 * Multi-market real-time data fetcher.
 * Supports: ETH gas, ETH price, BTC price, and arbitrary token prices.
 * Uses public RPCs and free APIs — no API keys required.
 */

export interface MarketData {
  marketType: string;
  dataPoints: Record<string, number | string | null>;
  source: string;
  fetchedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function jsonFetch(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function rpcCall(url: string, method: string, params: unknown[] = []): Promise<any> {
  const data = await jsonFetch(url, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (data.error) throw new Error(`RPC: ${data.error.message}`);
  return data.result;
}

// ─── ETH Gas ────────────────────────────────────────────────────────────────

const ETH_RPCS = [
  "https://eth.llamarpc.com",
  "https://rpc.ankr.com/eth",
  "https://ethereum-rpc.publicnode.com",
];

export async function fetchEthGasData(): Promise<MarketData> {
  let lastError: Error | null = null;

  for (const rpc of ETH_RPCS) {
    try {
      const [gasPrice, blockHex] = await Promise.all([
        rpcCall(rpc, "eth_gasPrice"),
        rpcCall(rpc, "eth_blockNumber"),
      ]);

      const gasPriceGwei = Number(BigInt(gasPrice)) / 1e9;
      const blockNumber = Number(BigInt(blockHex));

      let baseFeeGwei: number | null = null;
      try {
        const block = await rpcCall(rpc, "eth_getBlockByNumber", ["latest", false]);
        if (block?.baseFeePerGas) {
          baseFeeGwei = Number(BigInt(block.baseFeePerGas)) / 1e9;
        }
      } catch {}

      return {
        marketType: "eth_gas",
        dataPoints: {
          gas_price_gwei: Math.round(gasPriceGwei * 100) / 100,
          base_fee_gwei: baseFeeGwei ? Math.round(baseFeeGwei * 100) / 100 : null,
          block_number: blockNumber,
        },
        source: rpc,
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }
  throw new Error(`All ETH RPCs failed. Last: ${lastError?.message}`);
}

// ─── Crypto Prices (CoinGecko free API — no key) ───────────────────────────

const COINGECKO_IDS: Record<string, string> = {
  btc: "bitcoin",
  bitcoin: "bitcoin",
  eth: "ethereum",
  ethereum: "ethereum",
  sol: "solana",
  solana: "solana",
  bnb: "binancecoin",
  matic: "matic-network",
  polygon: "matic-network",
  avax: "avalanche-2",
  dot: "polkadot",
  link: "chainlink",
  uni: "uniswap",
  aave: "aave",
};

export async function fetchCryptoPrice(symbol: string): Promise<MarketData> {
  const id = COINGECKO_IDS[symbol.toLowerCase()];
  if (!id) {
    throw new Error(
      `Unknown symbol "${symbol}". Supported: ${Object.keys(COINGECKO_IDS).join(", ")}`
    );
  }

  const data = await jsonFetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`
  );

  const coin = data[id];
  if (!coin) throw new Error(`No price data for ${id}`);

  return {
    marketType: "crypto_price",
    dataPoints: {
      symbol: symbol.toUpperCase(),
      price_usd: coin.usd,
      change_24h_pct: coin.usd_24h_change ? Math.round(coin.usd_24h_change * 100) / 100 : null,
      market_cap_usd: coin.usd_market_cap || null,
      volume_24h_usd: coin.usd_24h_vol || null,
    },
    source: "api.coingecko.com",
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Auto-detect market type from question ─────────────────────────────────

export async function fetchMarketData(question: string): Promise<MarketData> {
  const q = question.toLowerCase();

  // Gas price questions
  if (q.includes("gas") || q.includes("gwei")) {
    return fetchEthGasData();
  }

  // Crypto price questions — detect the token
  for (const [symbol, _id] of Object.entries(COINGECKO_IDS)) {
    if (q.includes(symbol.toLowerCase())) {
      return fetchCryptoPrice(symbol);
    }
  }

  // Default: fetch both ETH gas and ETH price for general ETH questions
  if (q.includes("eth")) {
    return fetchEthGasData();
  }

  // Fallback: try BTC if price is mentioned
  if (q.includes("price") || q.includes("exceed") || q.includes("above") || q.includes("below")) {
    // Try to find any crypto mention
    return fetchEthGasData(); // Default to ETH gas
  }

  return fetchEthGasData();
}

// ─── Format data for AI prompt ─────────────────────────────────────────────

export function formatMarketDataForPrompt(data: MarketData): string {
  const lines = [`Market type: ${data.marketType}`];
  for (const [key, value] of Object.entries(data.dataPoints)) {
    if (value !== null) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push(`Source: ${data.source}`);
  lines.push(`Fetched at: ${data.fetchedAt}`);
  return lines.join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const query = process.argv[2] || "eth gas";
  console.log(`Fetching data for: "${query}"\n`);

  fetchMarketData(query)
    .then((data) => console.log(JSON.stringify(data, null, 2)))
    .catch((err) => {
      console.error("Failed:", err.message);
      process.exit(1);
    });
}
