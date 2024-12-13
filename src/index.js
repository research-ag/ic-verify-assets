import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// Function to parse assets_leafs file
// Returns files map (path -> hash)
async function parseAssetsFile(filePath) {
  const data = await fs.readFile(filePath, "utf-8");
  const assetsArray = JSON.parse(data);
  const assets = {};

  for (const asset of assetsArray) {
    const identityEncoding = asset.encodings.find(
      (encoding) => encoding.content_encoding === "identity"
    );

    if (identityEncoding) {
      assets[asset.key] = identityEncoding.sha256[0].toLowerCase();
    }
  }

  return assets;
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
  const files = {};

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      Object.assign(files, await createFilesMap(fullPath, baseDir));
    } else {
      const fileHash = await hashFile(fullPath);
      files[`/${relativePath}`] = fileHash;
    }
  }

  return files;
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

// Main function
async function main() {
  const assetsPath = "./for_test/assets_leafs.json";
  const distDir = "./for_test/dist";

  try {
    const expectedFilesMap = await parseAssetsFile(assetsPath);
    const actualFilesMap = await createFilesMap(distDir, distDir);
    const discrepancies = compareFileMaps(expectedFilesMap, actualFilesMap);

    logDiscrepancies(discrepancies);
  } catch (error) {
    console.error(`Failed to complete process: ${error.message}`);
  }
}

main();
