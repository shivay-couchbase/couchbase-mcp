# Couchbase Monster Data MCP Server

## Installation

Load up a Couchbase collection with the monster data.

Run `pnpm install` to install the dependencies.

Run `pnpm run build` to build the server.

Edit the `claude_desktop_config.json` file to add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
{
    "mcpServers": {
      "monster-server": {
        "name": "monster-server",
        "command": "/usr/local/bin/node",
        "args": ["/Users/shivaylamba/Desktop/cb-repos/mcp-cbimplementation/datastax-mcp-monsters/build/index.js"],
        "env": {
          "COUCHBASE_USERNAME": "",
          "COUCHBASE_PASSWORD": "!",
          "COUCHBASE_URL": "",
          "COUCHBASE_BUCKET":"",
          "COUCHBASE_SCOPE":"",
          "COUCHBASE_COLLECTION":"",
          "OPENAI_API_KEY":"",
          "USE_LOCAL_EMBEDDING":"false"
        }
      }
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

