// Packaging shell only. The real block is the third-party @modelcontextprotocol/server-everything,
// declared as a dependency and launched by the mcp-client row in cordis.patch.yml. dsh never loads
// this file as a plugin (the patch loads @deepseek-ai/dsh-mcp-client); it exists solely so dsh's
// package-entry resolution has a main to resolve.
module.exports = {}
