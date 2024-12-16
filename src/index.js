#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { HttpAgent, Actor } from "@dfinity/agent";

// Function to parse assets_leafs file
// Returns files map (path -> hash)
async function parseAssetsJson(filePath) {
  const data = await fs.readFile(filePath, "utf-8");
  const assetsArray = JSON.parse(data);
  const filesMap = {};

  for (const asset of assetsArray) {
    const identityEncoding = asset.encodings.find(
      (encoding) => encoding.content_encoding === "identity"
    );

    if (identityEncoding) {
      filesMap[asset.key] = identityEncoding.sha256[0].toLowerCase();
    }
  }

  return filesMap;
}

// Function to fetch assets from a canister
// Returns files map (path -> hash)
async function getAssetsFromCanister(canisterId) {
  const agent = HttpAgent.createSync({
    verifyQuerySignatures: false,
  });

  const assetCanisterIDL = ({ IDL }) =>
    IDL.Service({
      list: IDL.Func(
        [IDL.Record({})],
        [
          IDL.Vec(
            IDL.Record({
              key: IDL.Text,
              encodings: IDL.Vec(
                IDL.Record({
                  modified: IDL.Int,
                  sha256: IDL.Opt(IDL.Vec(IDL.Nat8)),
                  length: IDL.Nat,
                  content_encoding: IDL.Text,
                })
              ),
              content_type: IDL.Text,
            })
          ),
        ],
        ["query"]
      ),
    });

  const actor = Actor.createActor(assetCanisterIDL, { agent, canisterId });

  const assets = await actor.list({});

  const filesMap = {};
  for (const asset of assets) {
    const identityEncoding = asset.encodings.find(
      (encoding) => encoding.content_encoding === "identity"
    );

    if (identityEncoding) {
      filesMap[asset.key] = Array.from(identityEncoding.sha256[0])
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }
  }

  return filesMap;
}

// Function to calculate SHA-256 hash of a file
async function hashFile(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

// Recursive function to map all files in a directory
// Returns files map (path -> hash)
async function createFilesMap(dir, baseDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const filesMap = {};

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      Object.assign(filesMap, await createFilesMap(fullPath, baseDir));
    } else {
      const fileHash = await hashFile(fullPath);
      filesMap[`/${relativePath}`] = fileHash;
    }
  }

  return filesMap;
}

function compareFileMaps(map1, map2) {
  const discrepancies = {
    onlyInMap1: [],
    onlyInMap2: [],
    hashMismatch: [],
  };

  // Find files in map1 that are not in map2
  // or have a hash mismatch
  for (const [path, hash] of Object.entries(map1)) {
    if (!map2.hasOwnProperty(path)) {
      discrepancies.onlyInMap1.push(path);
    } else if (hash !== map2[path]) {
      discrepancies.hashMismatch.push({
        path,
        map1Hash: hash,
        map2Hash: map2[path],
      });
    }
  }

  // Find files in map2 that are not in map1
  for (const path of Object.keys(map2)) {
    if (!map1.hasOwnProperty(path)) {
      discrepancies.onlyInMap2.push(path);
    }
  }

  return discrepancies;
}

// Function to log discrepancies in file maps
function logDiscrepancies(discrepancies) {
  if (
    discrepancies.onlyInMap1.length === 0 &&
    discrepancies.onlyInMap2.length === 0 &&
    discrepancies.hashMismatch.length === 0
  ) {
    console.log("Success: All files match as expected.");
    return;
  }

  if (discrepancies.onlyInMap1.length > 0) {
    console.log("Files only in the first map:");
    discrepancies.onlyInMap1.forEach((file) => console.log(`  - ${file}`));
  }

  if (discrepancies.onlyInMap2.length > 0) {
    console.log("Files only in the second map:");
    discrepancies.onlyInMap2.forEach((file) => console.log(`  - ${file}`));
  }

  if (discrepancies.hashMismatch.length > 0) {
    console.log("Files with hash mismatches:");
    discrepancies.hashMismatch.forEach(({ path, map1Hash, map2Hash }) =>
      console.log(
        `  - ${path}\n    Map 1 Hash: ${map1Hash}\n    Map 2 Hash: ${map2Hash}`
      )
    );
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage(
      "Usage: $0 --distDir <distDir> (--assetsJson <filePath> | --canisterId <id>)"
    )
    .wrap(null)
    .option("distDir", {
      alias: "d",
      type: "string",
      describe: "Path to the dist directory",
      demandOption: true,
    })
    .option("assetsJson", {
      alias: "f",
      type: "string",
      describe: "Path to the assets json file",
      conflicts: "canisterId",
    })
    .option("canisterId", {
      alias: "c",
      type: "string",
      describe: "Canister ID to fetch assets from",
      conflicts: "assetsJson",
    })
    .check((argv) => {
      if (!argv.assetsJson && !argv.canisterId) {
        throw new Error(
          "You must specify either --assetsJson or --canisterId."
        );
      }
      return true;
    })
    .help().argv;

  const distDir = argv.distDir;

  let expectedFilesMap = {};

  try {
    if (argv.assetsJson) {
      expectedFilesMap = await parseAssetsJson(argv.assetsJson);
    } else {
      expectedFilesMap = await getAssetsFromCanister(argv.canisterId);
    }

    const actualFilesMap = await createFilesMap(distDir, distDir);
    const discrepancies = compareFileMaps(expectedFilesMap, actualFilesMap);

    logDiscrepancies(discrepancies);
  } catch (error) {
    console.error(`Failed to complete process: ${error.message}`);
  }
}

main();
