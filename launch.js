const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } = require("@solana/web3.js");
const { createMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } = require("@solana/spl-token");
const fs = require("fs");
const axios = require("axios"); // Add this for uploading metadata

const app = express();
app.use(express.json());
app.use(cors());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Function to upload metadata to a simple server (or Arweave/IPFS later)
async function uploadMetadata(name, symbol, description, image) {
  const metadata = {
    name,
    symbol,
    description: description || "A memecoin launched on memez.wtf",
    image: image || "https://via.placeholder.com/150" // Default image if none provided
  };

  // For now, mock uploading to a server (replace with your Render URL or Arweave later)
  const response = await axios.post("https://your-render-url.com/upload-metadata", metadata);
  return response.data.uri; // Assume server returns a URI
}

async function launchToken(name, symbol, supply, description, image) {
  console.log("Starting token mint:", { name, symbol, supply, description });
  try {
    const balance = await connection.getBalance(payer.publicKey);
    console.log("Payer balance:", balance / LAMPORTS_PER_SOL, "SOL");

    // Upload metadata and get URI
    const metadataUri = await uploadMetadata(name, symbol, description, image);

    // Create mint with Token-2022 and metadata
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      9, // Decimals
      undefined,
      {
        extensions: {
          metadata: {
            name,
            symbol,
            uri: metadataUri,
            additionalMetadata: [],
          },
        },
      },
      TOKEN_2022_PROGRAM_ID,
      { commitment: "confirmed" }
    );
    console.log("Mint created with metadata:", mint.toBase58());

    // Wait for confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Create Associated Token Account (ATA)
    const ata = await PublicKey.findProgramAddressSync(
      [payer.publicKey.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    )[0];
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        payer.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM
      )
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer.publicKey;
    const signature = await connection.sendTransaction(transaction, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Token account created:", signature);

    // Mint initial supply
    const mintAmount = BigInt(supply) * BigInt(10**9);
    const mintToData = Buffer.concat([
      Buffer.from([9]), // MintTo instruction
      Buffer.from(new Uint8Array(mintAmount.toString(16).padStart(16, '0').match(/.{2}/g).map(byte => parseInt(byte, 16))))
    ]);
    const mintToIx = new TransactionInstruction({
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      programId: TOKEN_2022_PROGRAM_ID,
      data: mintToData
    });
    const mintToTx = new Transaction().add(mintToIx);
    mintToTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    mintToTx.feePayer = payer.publicKey;
    const mintTxSignature = await connection.sendTransaction(mintToTx, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature: mintTxSignature, blockhash: (await connection.getLatestBlockhash("confirmed")).blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Supply minted to:", ata.toBase58(), "Tx:", mintTxSignature);

    return mint.toBase58();
  } catch (err) {
    console.error("Mint failed:", err.stack);
    throw err;
  }
}

app.post("/launch", async (req, res) => {
  const { name, symbol, supply, description, image } = req.body;
  console.log("Received launch request:", { name, symbol, supply, description });
  try {
    const mintAddress = await launchToken(name, symbol, supply, description, image);
    res.json({ success: true, mint: mintAddress });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server running on port ${port}`));
