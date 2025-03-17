const express = require("express");
const cors = require("cors"); // Add this
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors()); // Add this—simplest CORS fix

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));

async function launchToken(name, symbol, supply) {
  const mint = await createMint(connection, payer, payer.publicKey, null, 9);
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
