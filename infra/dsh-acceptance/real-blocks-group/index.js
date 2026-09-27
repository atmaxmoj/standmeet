// Packaging shell only. The real blocks are the standmeet-caldav-mcp and standmeet-smtp-mcp packages,
// composed by the cordis:group in cordis.patch.yml. dsh never loads this file as a plugin; it exists
// solely so dsh's package-entry resolution has a main to resolve.
module.exports = {}
