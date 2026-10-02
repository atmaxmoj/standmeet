// pagestore-mcp.js — the microsite.store block as a stdio-MCP server, in JS.
//
// A microsite can keep a shared manuscript in its own store (docs/design/scenario-s2-collaborative-
// writing.md). These tools let the agent be the main way visitors write it: read it, search it, and
// add a passage for the visitor. The page is the one the turn is asked on — it arrives on the trusted
// session `_meta` (host-planted), never as a tool argument, and the host checks the session may open
// it. Owns no data: every call goes to the host over STANDMEET_HOST_SOCKET.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const { callHost } = require('./gateway.js')

const instructions =
  'This page keeps a shared manuscript that its visitors write together, mostly through you. ' +
  'When a visitor asks to add something, write it as a passage with store_append (their words, ' +
  'or your draft of what they asked for) and tell them what happened — the result says whether ' +
  'it is on the page, waits for the owner\'s review, or could not be saved and why. Use ' +
  'store_search or store_read before answering a question about what has been written; each ' +
  'passage carries its author (_author.name).'

// manuscript —— the collection a page's manuscript lives in when the tool names none (the page's
// own convention: `useMicrositeStore('passages')`).
const manuscript = 'passages'

// forward — the session off `_meta` + the tool's arguments → the named host op. The host answers
// {ok, docs?, id?, pending?, message?}; that JSON is what the agent reads.
function forward(op) {
  return async (args, extra) => {
    const s = (extra && extra._meta && extra._meta['standmeet/session']) || {}
    try {
      const resp = await callHost({
        op,
        owner_id: s.owner_id || '',
        page: s.page || '',
        subject_id: s.subject_id || '',
        visitor_name: s.visitor_name || '',
        args: { ...(args || {}), collection: (args && args.collection) || manuscript },
      })
      return { content: [{ type: 'text', text: resp }] }
    } catch (e) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, message: e.message }) }] }
    }
  }
}

const collection = z.string().optional()
  .describe('The page\'s collection; omit for the manuscript (passages).')

async function main() {
  const server = new McpServer(
    { name: 'pagestore', version: '1.0.0' },
    { instructions, capabilities: { tools: {} } },
  )

  server.registerTool('store_read', {
    description: 'Read the whole manuscript of this page: every published passage, oldest first, ' +
      'each with its text and author.',
    inputSchema: { collection },
    annotations: { readOnlyHint: true },
    _meta: { progress_label: 'reading the manuscript' },
  }, forward('page_store.read'))

  server.registerTool('store_search', {
    description: 'Find the published passages of this page whose text contains the query ' +
      '(any case). Each comes with its author.',
    inputSchema: { query: z.string(), collection },
    annotations: { readOnlyHint: true },
    _meta: { progress_label: 'searching the manuscript' },
  }, forward('page_store.search'))

  server.registerTool('store_append', {
    description: 'Add one passage to this page\'s manuscript for the visitor. Everyone on the ' +
      'page sees it at once, unless the owner reviews new passages first (the result says so).',
    inputSchema: { text: z.string().min(1), collection },
    _meta: { progress_label: 'adding a passage' },
  }, forward('page_store.append'))

  await server.connect(new StdioServerTransport())
}

main().catch((e) => { console.error(e); process.exit(1) })
