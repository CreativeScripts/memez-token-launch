const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { createMint, TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

async function launchToken(name, symbol, supply) {
  console.log("Starting token mint:", { name, symbol, supply });
  try {
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey, // Mint authority
      null, // Freeze authority (none)
      9, // Decimals
      undefined, // Keypair (default generated)
      {
        extensions: {
          metadata: {
            name,
            symbol: symbol || "$DWH",
            uri: "https://example.com/dogwifhat.json",
            additionalMetadata: [], // Optional extra fields
          },
        },
      },
      TOKEN_2022_PROGRAM_ID
    );
    console.log("Mint created with metadata:", mint.toBase58());
    return mint.toBase58();
  } catch (err) {
    console.error("Mint failed:", err.stack);
    throw err;
  }
}

app.post("/launch", async (req, res) => {
  console.log("Raw body:", req.body);
  const { name, symbol = "$DWH", supply } = req.body;
  console.log("Received launch request:", { name, symbol, supply });
  try {
    const mintAddress = await launchToken(name, symbol, supply);
    res.json({ success: true, mint: mintAddress });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server running on port ${port}`));
