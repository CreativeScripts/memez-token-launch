const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey, Transaction } = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");
const { createInitializeMetadataInstruction, TOKEN_2022_PROGRAM_ID } = require("@solana/spl-token-metadata");
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
    // Create mint with Token-2022 program
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      9,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID // Use Token-2022 for metadata
    );
    console.log("Mint created:", mint.toBase58());

    // Add metadata via instruction
    const transaction = new Transaction().add(
      createInitializeMetadataInstruction(
        mint,
        payer.publicKey, // Mint authority
        payer.publicKey, // Update authority
        name,
        symbol,
        "https://example.com/dogwifhat.json",
        TOKEN_2022_PROGRAM_ID
      )
    );
    await connection.sendTransaction(transaction, [payer]);
    console.log("Metadata added for:", mint.toBase58());

    return mint.toBase58();
  } catch (err) {
    console.error("Mint/metadata failed:", err);
    throw err;
  }
}

app.post("/launch", async (req, res) => {
  const { name, symbol, supply } = req.body;
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
