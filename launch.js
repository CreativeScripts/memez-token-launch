const express = require("express");
const cors = require("cors");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction } = require("@solana/web3.js");
const { createMint, mintToChecked, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAccount } = require("@solana/spl-token");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

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
      TOKEN_2022_PROGRAM_ID,
      { commitment: "confirmed" }
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

    // Verify ATA state
    const ataInfo = await getAccount(connection, ata, "confirmed");
    console.log("ATA state:", {
      address: ataInfo.address.toBase58(),
      mint: ataInfo.mint.toBase58(),
      owner: ataInfo.owner.toBase58(),
      amount: ataInfo.amount.toString()
    });

    // Mint initial supply with Token-2022 using mintToChecked
    const mintAmount = BigInt(supply) * BigInt(10**9);
    const mintTx = await mintToChecked(
      connection,
      payer,
      mint,
      ata,
      payer,
      mintAmount,
      9, // Decimals
      [],
      { commitment: "confirmed", programId: TOKEN_2022_PROGRAM_ID }
    );
    console.log("Initial supply minted to:", ata.toBase58(), "Amount:", mintAmount.toString(), "MintTo Tx:", mintTx);

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
