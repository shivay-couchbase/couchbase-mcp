#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import couchbase, { 
  Cluster, 
  Collection, 
  SearchRequest, 
  VectorSearch, 
  VectorQuery,
  SearchResult,
  GetResult
} from "couchbase";
import "dotenv/config";

// Type definitions
interface Monster {
  _id: string;
  index: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  hit_points: number;
  hit_dice: string;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  languages: string;
  challenge_rating: number;
  proficiency_bonus: number;
  xp: number;
  speed_walk: string;
  proficiency_skill_deception: number;
  proficiency_skill_insight: number;
  proficiency_skill_persuasion: number;
  embedding?: number[];
}

interface SimilarMonster extends Partial<Monster> {
  score: number;
  id: string;
}

function debugLog(message: string): void {
    const timestamp = new Date().toISOString();
    process.stderr.write(`${timestamp}: ${message}\n`);
}

// Schema definition
const MonsterSchema = z.object({
  _id: z.string(),
  index: z.string(),
  name: z.string().describe("The name of the monster"),
  size: z.string(),
  type: z.string(),
  alignment: z.string(),
  hit_points: z.number(),
  hit_dice: z.string(),
  strength: z.number(),
  dexterity: z.number(),
  constitution: z.number(),
  intelligence: z.number(),
  wisdom: z.number(),
  charisma: z.number(),
  languages: z.string(),
  challenge_rating: z.number(),
  proficiency_bonus: z.number(),
  xp: z.number(),
  speed_walk: z.string(),
  proficiency_skill_deception: z.number(),
  proficiency_skill_insight: z.number(),
  proficiency_skill_persuasion: z.number(),
});

// Environment variables
const {
  COUCHBASE_URL,
  COUCHBASE_USERNAME,
  COUCHBASE_PASSWORD,
  COUCHBASE_BUCKET,
  COUCHBASE_SCOPE,
  COUCHBASE_COLLECTION
} = process.env;

// Initialize Couchbase variables
let cluster: Cluster | null = null;

// Initialize Couchbase connection if not already connected
async function initCouchbase(): Promise<Cluster> {
  if (!cluster) {
    cluster = await couchbase.connect(COUCHBASE_URL ?? "", {
      username: COUCHBASE_USERNAME ?? "",
      password: COUCHBASE_PASSWORD ?? "",
      configProfile: "wanDevelopment",
    });
  }
  return cluster;
}

// Retrieve scope/collection references
async function getCollection(): Promise<Collection> {
  const c = await initCouchbase();
  const bucket = c.bucket(COUCHBASE_BUCKET ?? "");
  const scope = bucket.scope(COUCHBASE_SCOPE ?? "_default");
  return scope.collection(COUCHBASE_COLLECTION ?? "_default");
}

// Utility functions
function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

async function getMonster(name: string): Promise<Monster | null> {
    if (!name) {
        throw new Error("Monster name is required");
    }

    const docId = `monster::${name.toLowerCase()}`;
    const collection = await getCollection();
    try {
        const result = await collection.get(docId);
        return result.content as Monster;
    }
    catch (err) {
        console.error(`Error fetching monster ${docId}:`, err);
        return null;
    }
}

async function findSimilarMonsters(monsterName: string): Promise<SimilarMonster[]> {
    debugLog(`Starting findSimilarMonsters for: ${monsterName}`);
    
    const monsterDoc = await getMonster(monsterName);
    if (!monsterDoc) {
        debugLog(`Monster not found: ${monsterName}`);
        throw new Error(`Monster not found: ${monsterName}`);
    }

    const monsterEmbedding = monsterDoc.embedding;
    if (!monsterEmbedding || !Array.isArray(monsterEmbedding)) {
        debugLog(`No embedding found in monster document`);
        throw new Error(`No embedding found for monster: ${monsterName}`);
    }

    const c = await initCouchbase();
    const scope = c.bucket(COUCHBASE_BUCKET ?? "").scope(COUCHBASE_SCOPE ?? "_default");

    const searchIndex = "pdf_search";
    const numResults = 5;

    try {
        const request = SearchRequest.create(
            VectorSearch.fromVectorQuery(
                VectorQuery.create('embedding', monsterEmbedding)
                    .numCandidates(numResults)
            )
        );

        const searchPromise = scope.search(searchIndex, request);
        const result = await Promise.race([
            searchPromise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Search timeout')), 5000)
            )
        ]) as SearchResult;

        if (!result.rows.length) {
            return [];
        }

        const collection = await getCollection();
        const docs = await Promise.all(
            result.rows.slice(0, 5).map(async row => {
                try {
                    const docResult = await collection.get(row.id, {
                        timeout: 2000,
                        project: ['name', 'type', 'challenge_rating', 'size']
                    });
                    return {
                        ...docResult.content,
                        score: row.score,
                        id: row.id
                    } as SimilarMonster;
                } catch (err) {
                    debugLog(`Error fetching doc ${row.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    return null;
                }
            })
        );

        return docs.filter((doc): doc is SimilarMonster => doc !== null);
    } catch (err) {
        debugLog(`Vector search error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        throw new Error(`Vector search failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
}

// Server setup
const server = new Server(
  {
    name: "monsters-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

// Expose the available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "fetch_monster_name",
        description: "Fetch a dungeons and dragons monster by name",
        inputSchema: zodToJsonSchema(MonsterSchema.pick({ name: true })),
      },
      {
        name: "find_monsters_which_are_similar",
        description: "Find similar monsters by name to the given name",
        inputSchema: zodToJsonSchema(MonsterSchema.pick({ name: true })),
      },
    ],
  };
});

// Tool call handling
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  switch (request.params.name) {
    case "fetch_monster_name": {
        const monsterName = request.params.arguments?.name as string;
        if (!monsterName) {
            return {
                content: [{ type: "text", text: "Monster name is required" }],
                isError: true,
            };
        }
        const monster = await getMonster(monsterName);
        if (!monster) {
            return {
                content: [{ type: "text", text: `Monster "${monsterName}" not found` }],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(monster, null, 2),
                },
            ],
            isError: false,
        };
    }
    case "find_monsters_which_are_similar": {
      const monsterName = request.params.arguments?.name;
      if (typeof monsterName !== 'string') {
        return {
          content: [{ type: "text", text: "Monster name must be a string" }],
          isError: true,
        };
      }
      const similarMonsters = await findSimilarMonsters(monsterName);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(similarMonsters, null, 2),
          },
        ],
        isError: false,
      };
    }
    default:
      throw new Error("Unknown tool");
  }
});

// Main
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});