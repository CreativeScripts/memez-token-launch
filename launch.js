const express = require("express");
const cors = require("cors");
const formData = require("express-form-data");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, TransactionInstruction } = require("@solana/web3.js");
const { createMint, mintTo, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, createInitializeMetadataPointerInstruction, createInitializeMintInstruction } = require("@solana/spl-token");
const { createMetadataAccountV3 } = require("@metaplex-foundation/mpl-token-metadata");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors({ origin: "https://memez.wtf" }));
app.use(formData.parse());
app.use("/metadata", express.static(path.join(__dirname, "metadata")));

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const secretKey = JSON.parse(fs.readFileSync("wallet.json", "utf8"));
console.log("Secret key length:", secretKey.length); // Should be 64
if (!Array.isArray(secretKey) || secretKey.length !== 64) {
  throw new Error("wallet.json must contain a 64-byte secret key array");
}
const payer = Keypair.fromSecretKey(Uint8Array.from(secretKey));
console.log("Payer public key:", payer.publicKey.toBase58());
console.log("Payer has signTransaction:", typeof payer.signTransaction === "function"); // Verify payer is a Keypair

const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BASE_URL = "https://memez-token-launch.onrender.com";

const metadataDir = path.join(__dirname, "metadata");
if (!fs.existsSync(metadataDir)) fs.mkdirSync(metadataDir);

app.post("/upload-metadata", (req, res) => {
  const { name, symbol, description, image, telegram, twitter, website } = req.body;
  if (!name || !symbol) {
    return res.status(400).json({ success: false, error: "Name and symbol are required" });
  }
  const safeName = (name || "Unknown").replace(/\s+/g, "-");
  const metadata = {
    name,
    symbol,
    description: description || "A memecoin launched on memez.wtf",
    image: image || "https://via.placeholder.com/150",
    external_url: website || "",
    attributes: [
      { trait_type: "Telegram", value: telegram || "N/A" },
      { trait_type: "Twitter", value: twitter || "N/A" }
    ],
  };
  const filename = `${Date.now()}-${safeName}.json`;
  const filepath = path.join(metadataDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(metadata, null, 2));
  const uri = `${BASE_URL}/metadata/${filename}`;
  res.json({ success: true, uri });
});

async function launchToken(name, symbol, supply, description, image, telegram, twitter, website) {
  console.log("Starting token mint:", { name, symbol, supply });
  if (!name || !symbol || !supply) {
    throw new Error("Name, symbol, and supply are required");
  }
  try {
    const balance = await connection.getBalance(payer.publicKey);
    console.log("Payer balance:", balance / LAMPORTS_PER_SOL, "SOL");

    const metadataResponse = await fetch(`${BASE_URL}/upload-metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, symbol, description, image, telegram, twitter, website }),
    });
    const { uri } = await metadataResponse.json();
    console.log("Metadata URI:", uri);

    const mintKeypair = Keypair.generate();
    console.log("Payer key:", payer.publicKey.toBase58());
    console.log("Mint keypair:", mintKeypair.publicKey.toBase58());

    const metadataPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), TOKEN_2022_PROGRAM_ID.toBuffer(), mintKeypair.publicKey.toBuffer()],
      TOKEN_2022_PROGRAM_ID
    )[0];
    console.log("Metadata PDA:", metadataPDA.toBase58());

    const mintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: 146,
        lamports: await connection.getMinimumBalanceForRentExemption(146),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMetadataPointerInstruction(
        mintKeypair.publicKey,
        payer.publicKey,
        metadataPDA,
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction({
        mint: mintKeypair.publicKey,
        decimals: 9,
        mintAuthority: payer.publicKey,
        freezeAuthority: null,
        programId: TOKEN_2022_PROGRAM_ID,
      })
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    mintTx.recentBlockhash = blockhash;
    mintTx.feePayer = payer.publicKey;
    console.log("Before signing:", {
      payerPubkey: payer.publicKey.toBase58(),
      mintPubkey: mintKeypair.publicKey.toBase58()
    });
    const signedMintTx = await payer.signTransaction(mintTx);
    signedMintTx.partialSign(mintKeypair);
    const mintSig = await connection.sendRawTransaction(signedMintTx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: mintSig, blockhash, lastValidBlockHeight }, "confirmed");
    const mint = mintKeypair.publicKey;
    console.log("Mint created:", mint.toBase58());

    const metadataTx = new Transaction().add(
      new TransactionInstruction({
        keys: [
          { pubkey: metadataPDA, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        programId: TOKEN_2022_PROGRAM_ID,
        data: Buffer.concat([
          Buffer.from([14]), // Metadata instruction for Token-2022
          Buffer.from(name, "utf8"), Buffer.from([0]), // Name + null terminator
          Buffer.from(symbol, "utf8"), Buffer.from([0]), // Symbol + null terminator
          Buffer.from(uri, "utf8"), Buffer.from([0]) // URI + null terminator
        ]),
      })
    );
    metadataTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    metadataTx.feePayer = payer.publicKey;
    const metadataSig = await connection.sendTransaction(metadataTx, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature: metadataSig, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Metadata added:", metadataSig);

    await new Promise(resolve => setTimeout(resolve, 2000));

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
    transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    transaction.feePayer = payer.publicKey;
    const signature = await connection.sendTransaction(transaction, [payer], { skipPreflight: false });
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("Token account created:", signature);

    const mintTxSignature = await mintTo(
      connection,
      payer,
      mint,
      ata,
      payer.publicKey,
      BigInt(supply) * BigInt(10**9),
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    console.log("Supply minted to:", ata.toBase58(), "Tx:", mintTxSignature);

    // Add Metaplex metadata
    const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const [metaplexMetadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METAPLEX_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      METAPLEX_PROGRAM_ID
    );

    const metaplexMetadataTx = new Transaction().add(
      createMetadataAccountV3({
        metadata: metaplexMetadataPDA,
        mint: mint,
        mintAuthority: payer.publicKey,
        payer: payer.publicKey,
        updateAuthority: payer.publicKey,
        data: {
          name,
          symbol,
          uri,
          sellerFeeBasisPoints: 0, // No royalties for now
          creators: null, // Add creators if you want
          collection: null,
          uses: null,
        },
        isMutable: true,
        programId: METAPLEX_PROGRAM_ID,
      })
    );

    metaplexMetadataTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    metaplexMetadataTx.feePayer = payer.publicKey;
    const metaplexMetadataSig = await connection.sendTransaction(metaplexMetadataTx, [payer], { skipPreflight: false });
    await connection.confirmTransaction({
      signature: metaplexMetadataSig,
      blockhash: metaplexMetadataTx.recentBlockhash,
      lastValidBlockHeight: (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight,
    }, "confirmed");
    console.log("Metaplex metadata added:", metaplexMetadataSig);

    return mint.toBase58();
  } catch (err) {
    console.error("Mint failed:", err.stack);
    throw err;
  }
}

app.post("/launch", async (req, res) => {
  const { name, symbol, supply, description, image, telegram, twitter, website, wallet } = req.body;
  console.log("Received launch request:", { name, symbol, supply, wallet });
  try {
    const mintAddress = await launchToken(name, symbol, supply, description, image, telegram, twitter, website);
    res.json({ success: true, mint: mintAddress });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server running on port ${port}`));
