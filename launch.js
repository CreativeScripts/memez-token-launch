const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");
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

    // Metadata data (V3 format)
    const metadataData = Buffer.concat([
      Buffer.from([2]), // Instruction type (Create Metadata V3)
      Buffer.from(name.padEnd(32, "\0")), // Name (32 bytes max)
      Buffer.from((symbol || "$DWH").padEnd(10, "\0")), // Symbol (10 bytes max)
      Buffer.from("https://example.com/dogwifhat.json".padEnd(200, "\0")), // URI (200 bytes max)
      Buffer.from([0, 0]), // Seller fee basis points (0)
      Buffer.from([0]), // No creators
      Buffer.from([1]), // isMutable: true
      Buffer.from([0]), // No collection
    ]);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ recentBlockhash: blockhash, feePayer: payer.publicKey }).add(
      new TransactionInstruction({
        keys: [
          { pubkey: metadataPDA, isSigner: false, isWritable: true }, // Metadata account
          { pubkey: mint, isSigner: false, isWritable: false }, // Mint
          { pubkey: payer.publicKey, isSigner: true, isWritable: false }, // Mint authority
          { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
          { pubkey: payer.publicKey, isSigner: false, isWritable: false }, // Update authority
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
        ],
        programId: METAPLEX_PROGRAM_ID,
        data: metadataData,
      })
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
