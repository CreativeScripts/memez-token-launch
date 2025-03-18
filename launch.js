const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");
const { createMetadataAccountV3 } = require("@solana/spl-token-metadata"); // Add this
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

async function launchToken(name, symbol, supply) {
  // Mint the token
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    9
  );

  // Add metadata
  await createMetadataAccountV3(
    connection,
    payer, // Payer of the transaction
    mint, // Mint address
    payer.publicKey, // Mint authority
    payer.publicKey, // Update authority
    {
      name: name, // e.g., "DOGWIFHAT"
      symbol: symbol, // e.g., "$DWH"
      uri: "https://example.com/dogwifhat.json", // Optional: link to JSON with image/description
      sellerFeeBasisPoints: 0, // Royalties (0% here)
      creators: null, // Optional: creators array
      collection: null, // Optional: collection info
      uses: null // Optional: usage info
    }
  );

  return mint.toBase58();
}

app.post("/launch", async (req, res) => {
  const { name, symbol, supply } = req.body;
  try {
    const mintAddress = await launchToken(name, symbol, supply);
    res.json({ success: true, mint: mintAddress });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server running on port ${port}`));
