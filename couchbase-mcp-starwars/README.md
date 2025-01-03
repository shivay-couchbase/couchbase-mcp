# Couchbase Monster Data MCP Server

## Installation

Load up a Couchbase collection with the starwars data.

#### Import Data with Couchbase Shell

Change into the directory where the data files with embeddings are:

```bash
cd starwars_documents
```

Open up Couchbase shell passing in an argument with the location of the config file defining your Couchbase information:

```bash
cbsh --config-dir ../config-file
```

Once in the shell, run the `nodes` command to just perform a sanity check that you are connected to the correct cluster.

```bash
> nodes
```

This should output something similar to the following:

```bash
╭───┬───────────┬────────────────┬─────────┬──────────────────────────┬───────────────────────┬───────────────────────────┬──────────────┬─────────────┬─────────╮
│ # │  cluster  │    hostname    │ status  │         services         │        version        │            os             │ memory_total │ memory_free │ capella │
├───┼───────────┼────────────────┼─────────┼──────────────────────────┼───────────────────────┼───────────────────────────┼──────────────┼─────────────┼─────────┤
│ 0 │ dev.local │ 127.0.0.1:8091 │ healthy │ search,indexing,kv,query │ 8.0.0-1246-enterprise │ x86_64-apple-darwin19.6.0 │  34359738368 │ 12026126336 │ false   │
╰───┴───────────┴────────────────┴─────────┴──────────────────────────┴───────────────────────┴───────────────────────────┴──────────────┴─────────────┴─────────╯
```

Now, import the data into the bucket you created earlier:

```bash
ls *_with_embedding.json | each { |it| open $it.name | wrap content | insert id $in.content._default.name } | doc upsert
```

Once this is done, you can perform a sanity check to ensure the documents were inserted by running a query to select just one:

```bash
query "select * from name_of_your_bucket._default._default limit 1"
```

Replace the `name_of_your_bucket` with the name of your bucket you created.

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

