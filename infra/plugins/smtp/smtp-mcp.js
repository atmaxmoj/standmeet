// smtp-mcp.js — the SMTP mail supplier as a stdio-MCP block, the same shape caldav uses for the
// calendar seam. It provides the `mail` seam: `send` (deliver one message) and `verify` (a connection
// handshake, no message sent). SMTP itself is done by nodemailer — nothing here (and no Go)
// reimplements the protocol; a correct delivery proves the block ran.
//
// The connection (host/port/username/password/from/tls) is passed per call by the caller: the
// substrate resolves the owner's stored SMTP credentials (credmgr) and merges them into the tool
// args when it dispatches the mail seam. The block holds no credentials.
//
// The block OWNS its error classification. When the in-host protocol supplier lived here it produced
// three friendly sentences (auth / tls / connect); the owner's connect card shows those. A block's
// tool error is one sentence across the socket, so the block puts the SAME friendly sentence in it —
// classification is mail's business, not the host's, and the host surfaces the sentence verbatim.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const nodemailer = require('nodemailer')

// conn — the credential shape every op carries (host-supplied, not LLM-chosen). Keys match the
// owner's stored SMTP credentials verbatim (cmd/server/blockwire smtpCredJSON): host, port (a
// string, as stored), username, password, from_address, from_name, tls.
const conn = {
  host: z.string(),
  port: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  from_address: z.string().optional(),
  from_name: z.string().optional(),
  tls: z.string().optional(), // "" | "none" | "starttls" | "tls" (implicit)
}
const asText = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })

// The three friendly connect-failure sentences — the SAME wording the in-host mailer produced
// (internal/infra/mailer/mailer_verify.go ErrVerifyConnect/TLS/Auth), so the owner's card reads
// identically whether SMTP is in-host or a block.
const MSG_CONNECT = "couldn't connect to the SMTP server — check the host and port"
const MSG_TLS = 'TLS handshake failed — check the TLS setting matches the server'
const MSG_AUTH = 'SMTP authentication failed — check the username and password'

// classify — map a nodemailer error to one of the three friendly sentences. nodemailer sets
// err.code (EAUTH / ECONNECTION / EDNS / ETIMEDOUT / ESOCKET / ECONNREFUSED) and err.responseCode
// (an SMTP reply code). Auth is decided first (a 5xx/535 or EAUTH), then TLS (a secure-socket
// failure — ESOCKET on a TLS attempt, or an SSL/STARTTLS message), else it's a connect failure.
function classify(err) {
  const code = (err && err.code) || ''
  const msg = ((err && err.message) || '').toLowerCase()
  const reply = err && err.responseCode
  if (code === 'EAUTH' || reply === 535 || /auth|credential|password|535/.test(msg)) {
    return MSG_AUTH
  }
  if (
    code === 'ESOCKET' ||
    /tls|ssl|secure|wrong version|starttls|does not support/.test(msg)
  ) {
    return MSG_TLS
  }
  return MSG_CONNECT
}

// sendFault — a send failure's classification for the host. A 5xx relay reply is a PERMANENT
// rejection (invalid recipient / refused / too large): lead with a "[fault:rejected]" token so the
// host says "change the recipient", never "try again later" — retrying a 5xx only fails again. A 4xx
// / dropped connection / timeout carries no token → the retryable "unavailable" class. The sentence
// after the token is advisory; the host reclassifies a send by the token's class.
function sendFault(err) {
  const reply = err && err.responseCode
  if (reply && reply >= 500) {
    return new Error('[fault:rejected] the mail server refused this message')
  }
  return new Error(classify(err))
}

// transportFor — build a nodemailer transport from the merged credentials. TLS mode maps the same
// way the Go mailer treated it: "tls" = implicit TLS (secure socket), "starttls" = upgrade on a
// plain socket, "none"/"" = plaintext (the e2e mailpit/mail-mock case, no auth). Port is stored as a
// string; default it from the TLS mode when absent (465 implicit / 587 starttls / 25 plain).
function transportFor(c) {
  const tls = c.tls || 'none'
  const secure = tls === 'tls'
  const port = c.port ? Number(c.port) : (secure ? 465 : tls === 'starttls' ? 587 : 25)
  const opts = { host: c.host, port, secure }
  if (tls === 'starttls') opts.requireTLS = true
  if (c.username) opts.auth = { user: c.username, pass: c.password || '' }
  return nodemailer.createTransport(opts)
}

// fromHeader — RFC5322 From: "Name" <addr> when a display name is set, else the bare address.
function fromHeader(c) {
  if (c.from_name && c.from_address) return `"${c.from_name}" <${c.from_address}>`
  return c.from_address || ''
}

async function main() {
  const server = new McpServer({ name: 'smtp', version: '1.0.0' })

  server.registerTool(
    'verify',
    { description: 'SMTP connection test (handshake, no message sent). Throws a classified, friendly reason if it fails.', inputSchema: conn },
    async (c) => {
      try {
        await transportFor(c).verify()
      } catch (e) {
        throw new Error(classify(e))
      }
      return asText({ ok: true })
    },
  )

  server.registerTool(
    'send',
    {
      description: 'Send one email through the owner\'s SMTP server. Returns { id } (empty when the ' +
        'server gives no message id). A send failure throws a classified, friendly reason.',
      inputSchema: {
        ...conn,
        to: z.string(),
        subject: z.string(),
        body: z.string(),
        html: z.string().optional(),
      },
    },
    async (c) => {
      let info
      try {
        info = await transportFor(c).sendMail({
          from: fromHeader(c), to: c.to, subject: c.subject,
          text: c.body, html: c.html || undefined,
        })
      } catch (e) {
        throw sendFault(e)
      }
      return asText({ id: (info && info.messageId) || '' })
    },
  )

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
