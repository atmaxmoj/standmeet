// mail-sender-mcp.js — the mail.send block as a stdio-MCP server, in JS (cross-platform, no Go).
//
// Replaces mcp-servers/mail-sender (Go) verbatim in behaviour: one tool, send_email, that hard-controls
// the recipient sandbox-side (args.recipient, else the visitor's session email — never an LLM-chosen
// arbitrary address), then reaches back through the FIXED-vocabulary op supplier.invoke("mail","send").
// It owns no data/credentials and reads the trusted session off the tool-call `_meta` (planted by the
// host). The host runs the real MailContract.Send through the owner's active mail supplier.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const { gwSupplierInvoke, sessionFromMeta } = require('./gateway.js')

const instructions =
  'You can send an email on the owner\'s behalf through their configured mail supplier. Use ' +
  'send_email only when the visitor has clearly asked you to email them (or the owner) something ' +
  'concrete — a summary, a link, a follow-up. Gather the subject and body first; the recipient ' +
  'defaults to the email the visitor gave when they arrived unless they name another.'

async function main() {
  const server = new McpServer(
    { name: 'mail-sender', version: '1.0.0' },
    { instructions, capabilities: { tools: {} } },
  )

  server.registerTool(
    'send_email',
    {
      description:
        'Send an email through the owner’s mail supplier. Provide subject and body; recipient ' +
        "defaults to the visitor's session email unless they give a different address.",
      inputSchema: {
        recipient: z.string().optional().describe("Override recipient; empty uses the visitor's session email."),
        subject: z.string(),
        body: z.string(),
      },
      _meta: { progress_label: 'sending email' },
    },
    // D-4 recipient hard-control sandbox-side, then reach back via the fixed op. Result wire
    // ({ok:true} / folded error) is the agent-facing result.
    async (args, extra) => {
      const s = sessionFromMeta(extra)
      const to = args.recipient || s.visitorEmail
      try {
        const resp = await gwSupplierInvoke(s.ownerID, 'mail', 'send', {
          to, subject: args.subject, body: args.body,
        })
        return { content: [{ type: 'text', text: resp }] }
      } catch (e) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }] }
      }
    },
  )

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
