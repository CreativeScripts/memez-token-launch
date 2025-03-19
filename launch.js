const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, TransactionInstruction } = require("@solana/web3.js");
const { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } = require("@solana/spl-token");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

async function createMintInstruction(connection, payer, mint, mintAuthority, decimals, metadata) {
  const transaction = new Transaction();
  const mintIx = new TransactionInstruction({
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
    ],
    programId: TOKEN_2022_PROGRAM_ID,
    data: Buffer.from([0x00, ...Buffer.from(decimals.toString()), ...Buffer.from(JSON.stringify(metadata))]) // Simplified for example
  });
  transaction.add(mintIx);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer.publicKey;
  const signature = await connection.sendTransaction(transaction, [payer], { skipPreflight: false });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return mint;
}

async function launchToken(name, symbol, supply) {
  console.log("Starting token mint:", { name, symbol, supply });
  try {
    const balance = await connection.getBalance(payer.publicKey);
    console.log("Payer balance:", balance / LAMPORTS_PER_SOL, "SOL");

    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    await createMintInstruction(
      connection,
      payer,
      mint,
      payer.publicKey,
      9,
      {
        extensions: {
          metadata: {
            name,
            symbol: symbol || "$DWH",
            uri: "https://creativescripts.github.io/dogwifhat-metadata/dogwifhat.json",
            additionalMetadata: [],
          },
        },
      }
    );
    console.log("Mint created with metadata:", mint.toBase58());

    // Wait for mint confirmation
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Calculate ATA address with Associated Token Program
    const ata = await PublicKey.findProgramAddressSync(
      [payer.publicKey.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    )[0];
    console.log("ATA address calculated:", ata.toBase58());

    // Create ATA
    const transaction = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey, // Payer
        ata, // ATA address
        payer.publicKey, // Owner
        mint, // Mint
        TOKEN_2022_PROGRAM_ID, // Token Program (Token-2022)
        ASSOCIATED_TOKEN_PROGRAM // ATA Program
      )
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = payer.publicKey;

    const signature = await connection.sendTransaction(transaction, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Token account created with signature:", signature);

    // Mint initial supply with raw Token-2022 instruction
    const mintAmount = BigInt(supply) * BigInt(10**9);
    const mintToIx = new TransactionInstruction({
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      programId: TOKEN_2022_PROGRAM_ID,
      data: Buffer.from([0x09, ...Buffer.from(mintAmount.toString())]) // MintTo instruction (simplified)
    });
    const mintToTx = new Transaction().add(mintToIx);
    mintToTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    mintToTx.feePayer = payer.publicKey;

    const mintTxSignature = await connection.sendTransaction(mintToTx, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature: mintTxSignature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Initial supply minted to:", ata.toBase58(), "Amount:", mintAmount.toString(), "MintTo Tx:", mintTxSignature);

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
