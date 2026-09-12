// Package blockdesk is the inbound controller for what a block asks about ITSELF.
//
// Two sockets, one subject: a block's own isolated storage (blockstore.*) and its own config
// (blockconfig.get). Both are thin shells — they parse socket args and forward into a handle
// bound at construction time to one block, so a sandbox cannot fill in another block's id.
//
// It is the sibling of routes/supplier, which carries the other inbound question: not "what is
// mine" but "do this for me with the owner's calendar". Both project from the one inbound
// convergence point (routes/hostdesk).
package blockdesk
