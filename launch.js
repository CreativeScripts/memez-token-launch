const express = require("express");
const cors = require("cors");
const formData = require("express-form-data");
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } = require("@solana/web3.js");
const { createMint, mintTo, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } = require("@solana/spl-token");
const { createMetadataAccountV3 } = require("@metaplex-foundation/mpl-token-metadata");
const fs = require("fs");
const path = require("path");
const nacl = require("tweetnacl");
const bs58 = require("bs58");

const app = express();
app.use(express.json());
app.use(cors({ origin: "https://memez.wtf" }));
app.use(formData.parse());
app.use("/metadata", express.static(path.join(__dirname, "metadata")));

const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Load and validate wallet
const secretKeyRaw = fs.readFileSync("wallet.json", "utf8");
console.log("Raw secret key data:", secretKeyRaw.slice(0, 20) + "...");
let secretKey;
try {
  secretKey = JSON.parse(secretKeyRaw);
} catch (err) {
  throw new Error("Failed to parse wallet.json: " + err.message);
}
console.log("Parsed secret key length:", secretKey.length);
console.log("First few bytes:", secretKey.slice(0, 5));
if (!Array.isArray(secretKey) || secretKey.length !== 64) {
  throw new Error("wallet.json must contain a 64-byte secret key array");
}

const secretKeyUint8 = Uint8Array.from(secretKey);
const payer = Keypair.fromSecretKey(secretKeyUint8);
console.log("Payer public key:", payer.publicKey.toBase58());
console.log("Payer private key (first 5 bytes):", secretKeyUint8.slice(0, 5));
console.log("Payer publicKey type:", payer.publicKey.constructor.name);

const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const BASE_URL = "http://localhost:3001"; // Local testing

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
    console.log("Mint publicKey type:", mintKeypair.publicKey.constructor.name);

    // Validate public keys
    try {
      bs58.decode(payer.publicKey.toBase58());
      bs58.decode(mintKeypair.publicKey.toBase58());
    } catch (err) {
      throw new Error("Invalid base58 public key: " + err.message);
    }

    // Create and initialize mint using createMint
    const mintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: 82,
        lamports: await connection.getMinimumBalanceForRentExemption(82),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
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
    const mintSerialized = mintTx.serializeMessage();
    const payerMintSignature = nacl.sign.detached(mintSerialized, secretKeyUint8);
    const mintKeySignature = nacl.sign.detached(mintSerialized, mintKeypair.secretKey);
    mintTx.addSignature(payer.publicKey, Buffer.from(payerMintSignature));
    mintTx.addSignature(mintKeypair.publicKey, Buffer.from(mintKeySignature));
    const mintSig = await connection.sendRawTransaction(mintTx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: mintSig, blockhash, lastValidBlockHeight }, "confirmed");
    const mint = mintKeypair.publicKey;
    console.log("Mint created and initialized:", mint.toBase58());

    // Create associated token account
    const ata = await PublicKey.findProgramAddressSync(
      [payer.publicKey.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM
    )[0];
    const ataTx = new Transaction();
    ataTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    ataTx.feePayer = payer.publicKey;
    ataTx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        payer.publicKey,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM
      )
    );
    const ataSerialized = ataTx.serializeMessage();
    const ataSignature = nacl.sign.detached(ataSerialized, secretKeyUint8);
    ataTx.addSignature(payer.publicKey, Buffer.from(ataSignature));
    const ataSig = await connection.sendRawTransaction(ataTx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: ataSig, blockhash: ataTx.recentBlockhash, lastValidBlockHeight: (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight }, "confirmed");
    console.log("Token account created:", ataSig);

    // Mint tokens
    const mintAmount = BigInt(supply) * BigInt(10**9);
    const mintToTx = await mintTo(
      connection,
      payer,
      mint,
      ata,
      payer.publicKey,
      mintAmount,
      [],
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    console.log("Supply minted to:", ata.toBase58(), "Tx:", mintToTx);

    // Add metadata
    const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const [metaplexMetadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METAPLEX_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      METAPLEX_PROGRAM_ID
    );
    console.log("Metadata PDA:", metaplexMetadataPDA.toBase58());

    const uriCheck = await fetch(uri);
    if (!uriCheck.ok) {
      throw new Error(`Metadata URI ${uri} is not accessible: ${uriCheck.statusText}`);
    }
    console.log("Metadata URI is accessible");

    const metadataTx = new Transaction();
    metadataTx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    metadataTx.feePayer = payer.publicKey;
    metadataTx.add(
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
          sellerFeeBasisPoints: 0,
          creators: [],
          collection: null,
          uses: null,
        },
        isMutable: true,
      })
    );
    const metaSerialized = metadataTx.serializeMessage();
    const metaSignature = nacl.sign.detached(metaSerialized, secretKeyUint8);
    metadataTx.addSignature(payer.publicKey, Buffer.from(metaSignature));
    const metadataSig = await connection.sendRawTransaction(metadataTx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: metadataSig, blockhash: metadataTx.recentBlockhash, lastValidBlockHeight: (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight }, "confirmed");
    console.log("Metaplex metadata added:", metadataSig);

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
