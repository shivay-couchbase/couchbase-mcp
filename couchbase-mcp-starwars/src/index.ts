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
interface StarWarsCharacter {
  name: string;
  rotation_period: string;
  orbital_period: string;
  diameter: string;
  climate: string;
  gravity: string;
  terrain: string;
  surface_water: string;
  population: string;
  residents: string[];
  films: string[];
  created: string;
  edited: string;
  url: string;
  embedding?: number[];
}

interface SimilarCharacter extends Partial<StarWarsCharacter> {
  score: number;
  id: string;
}

function debugLog(message: string): void {
    const timestamp = new Date().toISOString();
    process.stderr.write(`${timestamp}: ${message}\n`);
}

// Schema definition
const StarWarsSchema = z.object({
  name: z.string().describe("The name of the Star Wars planet"),
  rotation_period: z.string(),
  orbital_period: z.string(),
  diameter: z.string(),
  climate: z.string(),
  gravity: z.string(),
  terrain: z.string(),
  surface_water: z.string(),
  population: z.string(),
  residents: z.array(z.string()),
  films: z.array(z.string()),
  created: z.string(),
  edited: z.string(),
  url: z.string(),
  embedding: z.array(z.number()).optional(),
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

async function getCharacter(name: string): Promise<StarWarsCharacter | null> {
  if (!name) {
      throw new Error("Planet name is required");
  }

  const docId = capitalizeFirstLetter(name);
  debugLog(`Fetching planet with ID: ${docId}`);
  
  const collection = await getCollection();
  try {
      const result = await collection.get(docId);
      // Direct access to content without _default
      return result.content as StarWarsCharacter;
  }
  catch (err) {
      console.error(`Error fetching planet ${docId}:`, err);
      return null;
  }
}

async function findSimilarCharacters(planetName: string): Promise<SimilarCharacter[]> {
    debugLog(`Starting findSimilarPlanets for: ${planetName}`);
    
    const planetDoc = await getCharacter(planetName);
    if (!planetDoc) {
        throw new Error(`Planet not found: ${planetName}`);
    }

    const planetEmbedding = planetDoc.embedding;
    if (!planetEmbedding || !Array.isArray(planetEmbedding)) {
        throw new Error(`No embedding found for planet: ${planetName}`);
    }

    const c = await initCouchbase();
    const scope = c.bucket(COUCHBASE_BUCKET ?? "").scope(COUCHBASE_SCOPE ?? "_default");
    const fullIndexName = 'vector-search-index';
    const numResults = 5;  // Limit to 5 results

    try {
        const request = SearchRequest.create(
            VectorSearch.fromVectorQuery(
                VectorQuery.create('embedding', planetEmbedding)
                    .numCandidates(numResults)
            )
        );

        const result = await Promise.race([
            scope.search(fullIndexName, request, { timeout: 3000 }),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Search timeout')), 3000)
            )
        ]) as SearchResult;

        if (!result.rows.length) {
            return [];
        }

        const collection = await getCollection();
        
        // Process only essential fields with timeout
        const docs = await Promise.all(
            result.rows.slice(0, 5).map(async row => {
                try {
                    const docResult = await Promise.race([
                        collection.get(row.id, {
                            timeout: 2000,
                            // Only fetch essential fields
                            project: ['name', 'climate', 'terrain', 'population']
                        }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Document fetch timeout')), 2000)
                        )
                    ]) as GetResult;

                    return {
                        name: docResult.content.name,
                        climate: docResult.content.climate,
                        terrain: docResult.content.terrain,
                        population: docResult.content.population,
                        score: row.score,
                        id: row.id
                    } as SimilarCharacter;
                } catch (err) {
                    return null;
                }
            })
        );

        // Clean up connection immediately
        if (cluster) {
            await cluster.close();
            cluster = null;
        }

        return docs.filter((doc): doc is SimilarCharacter => doc !== null);
    } catch (err) {
        if (cluster) {
            await cluster.close();
            cluster = null;
        }
        throw new Error(`Vector search failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
}

const server = new Server(
  {
    name: "starwars-server",
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
        name: "fetch_planet_name",
        description: "Fetch a Star Wars planet by name",
        inputSchema: zodToJsonSchema(StarWarsSchema.pick({ name: true })),
      },
      {
        name: "find_planets_which_are_similar",
        description: "Find similar planets by name to the given name",
        inputSchema: zodToJsonSchema(StarWarsSchema.pick({ name: true })),
      },
    ],
  };
});

// Tool call handling
server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  switch (request.params.name) {
    case "fetch_planet_name": {
        const planetName = request.params.arguments?.name as string;
        if (!planetName) {
            return {
                content: [{ type: "text", text: "Planet name is required" }],
                isError: true,
            };
        }
        const planet = await getCharacter(planetName);
        if (!planet) {
            return {
                content: [{ type: "text", text: `Planet "${planetName}" not found` }],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(planet, null, 2),
                },
            ],
            isError: false,
        };
    }
    case "find_planets_which_are_similar": {
      const planetName = request.params.arguments?.name;
      if (typeof planetName !== 'string') {
        return {
          content: [{ type: "text", text: "Planet name must be a string" }],
          isError: true,
        };
      }
      const similarPlanets = await findSimilarCharacters(planetName);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(similarPlanets, null, 2),
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
