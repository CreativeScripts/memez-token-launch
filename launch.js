const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction } = require("@solana/web3.js");
const { createMint, mintTo, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction } = require("@solana/spl-token");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

async function launchToken(name, symbol, supply) {
  console.log("Starting token mint:", { name, symbol, supply });
  try {
    const balance = await connection.getBalance(payer.publicKey);
    console.log("Payer balance:", balance / LAMPORTS_PER_SOL, "SOL");

    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      9,
      undefined,
      {
        extensions: {
          metadata: {
            name,
            symbol: symbol || "$DWH",
            uri: "https://creativescripts.github.io/dogwifhat-metadata/dogwifhat.json",
            additionalMetadata: [],
          },
        },
      },
      TOKEN_2022_PROGRAM,
      { commitment: "confirmed" }
    );
    console.log("Mint created with metadata:", mint.toBase58());

    // Wait for mint confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Manual ATA creation
    const ata = new PublicKey(
      await PublicKey.findProgramAddressSync(
        [payer.publicKey.toBuffer(), TOKEN_2022_PROGRAM.toBuffer(), mint.toBuffer()],
        TOKEN_2022_PROGRAM
      )[0]
    );
    console.log("ATA address calculated:", ata.toBase58());

    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, // Payer
        ata, // ATA address
        payer.publicKey, // Owner
        mint, // Mint
        TOKEN_2022_PROGRAM // Program ID
      )
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer.publicKey;

    const signature = await connection.sendTransaction(transaction, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Token account created with signature:", signature);

    // Mint initial supply
    const mintAmount = BigInt(supply) * BigInt(10**9);
    await mintTo(
      connection,
      payer,
      mint,
      ata,
      payer,
      mintAmount,
      [],
      { commitment: "confirmed" }
    );
    console.log("Initial supply minted to:", ata.toBase58(), "Amount:", mintAmount.toString());

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
