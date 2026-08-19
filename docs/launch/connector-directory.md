# Anthropic connector directory — submission checklist

State as of 2026-08-19. Submit at the directory's partner form when every box is ticked.

- [x] Remote MCP server over Streamable HTTP (`/api/mcp`)
- [x] OAuth 2.1: PRM + AS metadata well-knowns, DCR, PKCE S256 only, WWW-Authenticate trigger
- [x] Tool annotations (readOnlyHint/destructiveHint/idempotentHint) + titles on all tools
- [x] structuredContent on fork/merge/tree; MCP Apps inline UI on bonsai_tree (SEP-1865)
- [x] Fails closed on auth (dev key rejected in prod, DB errors reject, bogus keys/tokens 401)
- [x] Rate limiting on inference-shaped tools
- [ ] Attach-test the OAuth flow once from a fresh claude.ai account (not the dev account)
- [ ] SESSION_SECRET set in production (signed web sessions; the consent page rides them)
- [ ] Privacy note: what's stored per key (branches, insights, timestamps), no message content
      from the claude.ai conversation beyond what the model passes into fork explicitly
- [ ] Support contact + status page link on /connect
- [ ] Screenshot set: consent page, inline tree, fork paste block
