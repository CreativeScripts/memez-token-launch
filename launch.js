const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");
const { createInstruction } = require("@metaplex-foundation/mpl-token-metadata");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

async function launchToken(name, symbol, supply) {
  console.log("Starting token mint:", { name, symbol, supply });
  try {
    const mint = await createMint(connection, payer, payer.publicKey, null, 9);
    console.log("Mint created:", mint.toBase58());

    const [metadataPDA] = await PublicKey.findProgramAddress(
      [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      METAPLEX_PROGRAM_ID
    );

    const metadataData = {
      name,
      symbol: symbol || "$DWH",
      uri: "https://example.com/dogwifhat.json",
      seller_fee_basis_points: 0,
      creators: null,
      collection: null,
      uses: null,
    };

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: payer.publicKey }).add(
      createInstruction(
        METAPLEX_PROGRAM_ID,
        SystemProgram.programId,
        metadataPDA,
        mint,
        payer.publicKey, // Mint authority
        payer.publicKey, // Payer
        payer.publicKey, // Update authority
        metadataData,
        true // isMutable
      )
    );
    const signature = await connection.sendTransaction(transaction, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Metadata added for:", mint.toBase58());

    return mint.toBase58();
  } catch (err) {
    console.error("Mint/metadata failed:", err.stack);
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
