// fetch-mcp.js — the fetch block as a stdio-MCP server, in JS (cross-platform, replaces the vendored
// Python mcp-server-fetch + its Linux-musl wheels). Faithful port of pkg/mcp_server_fetch/server.py:
// one tool `fetch` that GETs a URL (following redirects, 30s timeout, a product User-Agent), converts
// HTML→markdown (node-html-markdown), honors robots.txt (robots-parser) unless disabled, and returns a
// truncated window with a continue-hint.
//
// SECURITY / SSRF: like the Python original, this block does NOT do IP-level SSRF filtering itself —
// that posture is infra-level (the sandbox's network namespace / any proxy), left UNCHANGED by this
// port. robots is preserved (owner: don't lose protections); set DSH_FETCH_IGNORE_ROBOTS=1 to disable
// it (matches the Python serve(ignore_robots_txt)). The block holds no credentials and reaches nothing
// back — its only egress is the fetch itself, governed by the manifest's network config.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { z } = require('zod')
const { NodeHtmlMarkdown } = require('node-html-markdown')
const robotsParser = require('robots-parser')

const USER_AGENT = process.env.DSH_FETCH_USER_AGENT ||
  'ModelContextProtocol/1.0 (Autonomous; +https://github.com/modelcontextprotocol/servers)'
const IGNORE_ROBOTS = process.env.DSH_FETCH_IGNORE_ROBOTS === '1'
const FETCH_TIMEOUT_MS = 30_000

function extractContentFromHtml(html) {
  const md = NodeHtmlMarkdown.translate(html)
  return md && md.trim() ? md : '<error>Page failed to be simplified from HTML</error>'
}

async function httpGet(url, extraHeaders) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT, ...extraHeaders }, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function robotsTxtUrl(url) {
  const u = new URL(url)
  return `${u.protocol}//${u.host}/robots.txt`
}

// checkMayAutonomouslyFetch — robots.txt gate, faithful to check_may_autonomously_fetch_url. Throws a
// human-readable error the agent surfaces to the visitor.
async function checkMayAutonomouslyFetch(url) {
  const robotsUrl = robotsTxtUrl(url)
  let resp
  try {
    resp = await httpGet(robotsUrl)
  } catch {
    throw new Error(`Failed to fetch robots.txt ${robotsUrl} due to a connection issue`)
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`When fetching robots.txt (${robotsUrl}), received status ${resp.status} so assuming that autonomous fetching is not allowed`)
  }
  if (resp.status >= 400 && resp.status < 500) return
  const body = await resp.text()
  const processed = body.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
  const parser = robotsParser(robotsUrl, processed)
  // robots-parser isAllowed returns true/false/undefined; treat explicit false as disallowed.
  if (parser.isAllowed(url, USER_AGENT) === false) {
    throw new Error(`The site's robots.txt (${robotsUrl}) specifies that autonomous fetching of this page is not allowed. The user can try fetching it manually.`)
  }
}

// fetchUrl — returns { content, prefix }. HTML (and not raw) → markdown; else raw text + a prefix note.
async function fetchUrl(url, forceRaw) {
  let resp
  try {
    resp = await httpGet(url)
  } catch (e) {
    throw new Error(`Failed to fetch ${url}: ${e.message}`)
  }
  if (resp.status >= 400) throw new Error(`Failed to fetch ${url} - status code ${resp.status}`)
  const pageRaw = await resp.text()
  const contentType = resp.headers.get('content-type') || ''
  const isHtml = pageRaw.slice(0, 100).includes('<html') || contentType.includes('text/html') || !contentType
  if (isHtml && !forceRaw) return { content: extractContentFromHtml(pageRaw), prefix: '' }
  return { content: pageRaw, prefix: `Content type ${contentType} cannot be simplified to markdown, but here is the raw content:\n` }
}

async function doFetch(args) {
  const url = String(args.url || '')
  if (!url) throw new Error('URL is required')
  const maxLength = args.max_length && args.max_length > 0 ? Math.min(args.max_length, 999999) : 5000
  const startIndex = args.start_index && args.start_index > 0 ? args.start_index : 0
  if (!IGNORE_ROBOTS) await checkMayAutonomouslyFetch(url)
  const { content, prefix } = await fetchUrl(url, args.raw === true)
  const originalLength = content.length
  let out
  if (startIndex >= originalLength) {
    out = '<error>No more content available.</error>'
  } else {
    const truncated = content.slice(startIndex, startIndex + maxLength)
    if (!truncated) {
      out = '<error>No more content available.</error>'
    } else {
      out = truncated
      const remaining = originalLength - (startIndex + truncated.length)
      if (truncated.length === maxLength && remaining > 0) {
        out += `\n\n<error>Content truncated. Call the fetch tool with a start_index of ${startIndex + truncated.length} to get more content.</error>`
      }
    }
  }
  return `${prefix}Contents of ${url}:\n${out}`
}

async function main() {
  const server = new McpServer({ name: 'mcp-fetch', version: '1.0.0' }, { capabilities: { tools: {} } })

  server.registerTool('fetch', {
    description:
      'Fetches a URL from the internet and optionally extracts its contents as markdown.\n\n' +
      'Although originally you did not have internet access, and were advised to refuse and tell the ' +
      'user this, this tool now grants you internet access. Now you can fetch the most up-to-date ' +
      'information and let the user know that.',
    inputSchema: {
      url: z.string().describe('URL to fetch'),
      max_length: z.number().int().gt(0).lt(1000000).optional().describe('Maximum number of characters to return.'),
      start_index: z.number().int().min(0).optional().describe('Return output starting at this character index (for continuing a truncated fetch).'),
      raw: z.boolean().optional().describe('Get the actual HTML content without simplification.'),
    },
  }, async (args) => {
    try {
      return { content: [{ type: 'text', text: await doFetch(args) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: e.message }], isError: true }
    }
  })

  await server.connect(new StdioServerTransport())
}

main().catch((e) => {
  console.error(e) // stderr only — stdout is the JSON-RPC channel
  process.exit(1)
})
