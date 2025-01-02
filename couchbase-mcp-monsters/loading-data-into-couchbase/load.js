// saveMonstersToCouchbaseSingleFile.mjs
//
// This script demonstrates how to:
//   1. Read monster data from a local monsters.json file.
//   2. Generate embeddings (using the OpenAI embeddings API).
//   3. Connect to Couchbase.
//   4. Store each monster as a JSON document (with embedding) in Couchbase.
//
// Requirements:
//   - A valid monsters.json file in the same directory, containing an array of monster objects.
//   - A .env file (or environment variables) with:
//       COUCHBASE_URL
//       COUCHBASE_USERNAME
//       COUCHBASE_PASSWORD
//       COUCHBASE_BUCKET
//       OPENAI_API_KEY (if not using local embeddings)
//       USE_LOCAL_EMBEDDING (true or false)
//
// Usage:
//   node saveMonstersToCouchbaseSingleFile.mjs

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import couchbase from 'couchbase';
import { OpenAI } from 'openai';

// If set to true, no calls to the OpenAI API will be made (this script does not define local embeddings).
// You can adapt the script to handle local embeddings as necessary.
const useLocalEmbedding = process.env.USE_LOCAL_EMBEDDING === 'true';

// Initialize the OpenAI client (if local embedding is disabled)
let openaiClient = null;
if (!useLocalEmbedding) {
  openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Simple function to generate an embedding for a given text using OpenAI
 * @param {string} query The text to be embedded
 * @returns {Promise<number[]>} A numeric array representing the embedding
 */
async function generateQueryEmbedding(query) {
  if (useLocalEmbedding) {
    throw new Error('Local embedding mode is enabled, but no local embedding function is provided here.');
  }
  if (!openaiClient) {
    throw new Error('OpenAI client is not initialized.');
  }
  
  const response = await openaiClient.embeddings.create({
    model: 'text-embedding-ada-002',
    input: query,
  });
  
  return response.data[0].embedding;
}

// Initialize Couchbase connection
let cluster;
async function initCouchbase() {
  if (!cluster) {
    cluster = await couchbase.connect(process.env.COUCHBASE_URL, {
      username: process.env.COUCHBASE_USERNAME,
      password: process.env.COUCHBASE_PASSWORD,
      configProfile: 'wanDevelopment',
    });
  }
  return cluster;
}

/**
 * Stores a JSON string (monster data) along with its generated embedding into Couchbase.
 * @param {string} content - A JSON string representing the monster data.
 * @param {string} docId - The document ID used in Couchbase.
 */
async function storeEmbedding(content, docId) {
  console.log(`Processing document: ${docId}`);

  // Generate an embedding (or skip if using local embedding)
  let embedding;
  if (useLocalEmbedding) {
    throw new Error('Local embedding mode is enabled, but this script does not define a local embedding function.');
  } else {
    embedding = await generateQueryEmbedding(content); // Embedding based on entire monster data
  }

  // Connect to Couchbase, and obtain a reference to the bucket + collection
  const c = await initCouchbase();
  const bucket = c.bucket(process.env.COUCHBASE_BUCKET);
  const scope = bucket.scope(process.env.COUCHBASE_SCOPE || '_default');

  // Pick up the collection name from environment variables
  const collectionName = process.env.COUCHBASE_COLLECTION || '_default';

  // Reference your named collection
  const collection = scope.collection(collectionName);

  // Attempt to parse the JSON content
  let parsedContent;
  try {
    parsedContent = JSON.parse(content);
  } catch (err) {
    console.error(`Invalid JSON in document ${docId}:`, err);
    throw new Error(`Invalid JSON in document ${docId}: ${err.message}`);
  }

  // Combine the parsed content with the embedding
  const docToStore = { ...parsedContent, embedding };

  // Store in Couchbase (upsert will create or overwrite the document)
  await collection.upsert(docId, docToStore);
  console.log(`Document stored: ${docId}`);
}

/**
 * Main function to read monsters from monsters.json and store them in Couchbase with embeddings.
 */
async function saveMonstersToCouchbase() {
  try {
    // Resolve the path to monsters.json
    const monstersFilePath = path.resolve(process.cwd(), 'monsters.json');

    // Read the file contents
    const fileContent = fs.readFileSync(monstersFilePath, 'utf-8');

    // Parse the JSON array of monsters
    const monsters = JSON.parse(fileContent);

    // Process each monster in the array
    for (const monster of monsters) {
      // Generate a doc ID by converting monster name to something couchbase-friendly
      const docId = `monster::${monster.name.replace(/\s+/g, '_').toLowerCase()}`;
      const monsterAsJson = JSON.stringify(monster);

      // Store the monster in Couchbase along with an embedding
      await storeEmbedding(monsterAsJson, docId);
    }

    console.log('All monsters have been processed and stored with embeddings in Couchbase.');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Close the Couchbase connection if desired (optional)
    if (cluster) {
      await cluster.close();
      console.log('Couchbase connection closed.');
    }
  }
}

// Run the main function
saveMonstersToCouchbase();