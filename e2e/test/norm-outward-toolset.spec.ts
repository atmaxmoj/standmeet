// norm-outward-toolset.spec.ts -- [outward] the **tools/list toolset golden**
// for owner-facing self-managed MCP handles (the real MCP client discovery
// path).
//
// This guards the tool list tools/list actually returns when the owner
// connects with a real MCP client (Claude Desktop / Cursor). It is **a
// different path** from norm-outward-handles.spec.ts (which goes through
// diag/registry to check capability ids):
//   - the registry path: is the capability registered correctly (an
//     in-process view).
//   - this path: is the tool serialized, transported over HTTP, and
//     discovered by the client -- **can it actually be used**.
//
// Why this is a separate spec: tools/list marshals the InputSchema of
// **every** tool in one shot. If any single tool's InputSchema is bad JSON,
// the whole marshal fails -> an empty body is returned -> the client
// discovers zero tools (owner MCP becomes entirely unusable). This is a bug
// that really happened historically (skill_create's schema misused Go string
// concatenation `"+` inside a backtick raw string). The Go side has
// schema_valid_test as a backstop; this spec pins down "a real client can
// discover the complete toolset" at the e2e level.
//
// golden = every owner_only tool (132 built-in + 10 from the jobs plugin + 1
// declared by a connector manifest = 143). This spec goes red when an owner
// tool is added or removed -- that's **deliberate**: it forces you to update
// the toolset expectation in sync.
//
// WARNING: **this hand-written list has gone stale for the third time now**
// (F-P-6). It's a checker that "requires someone to remember to update it" --
// and the same fact already has a home that never forgets:
// `internal/infra/paritymanifest` is the single source of truth for owner
// capabilities, and `server.New` checks it against both live facades at
// startup, panicking on mismatch.
// This is yet another copy, and whoever copies it will one day forget and
// let it silently drift. See F-P-6 for the structural fix: derive the
// expectation **from the manifest** instead of hand-writing it
// ([[structure-means-no-responsibility-class]]).
//
// **Owner tools have three sources**, not two: hardcoded on the host side,
// contributed by capability plugins, and **`owner_ops:` declared in a
// connector manifest**. The third source was added later (F-C-16's
// connectors.calendar_check), and that change never updated this golden --
// so this spec has been red ever since, unnoticed until owner-mcp was driven
// manually and its tools were counted by hand.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, listTools } from '@/fixtures/mcp';

const OWNER = {
  email: 'norm-toolset@example.com', password: 'correct-horse-battery-staple',
  handle: 'normtoolset', fullName: 'Norm Toolset Owner',
};

// GOLDEN -- tools/list must return exactly these 139 owner tools (compared
// after sorting; ordering noise is decided by mcp-go's registration order,
// which is out of this spec's responsibility). Once facade-parity debt was
// fully paid off (56 -> 0): every admin-facade owner capability has an
// owner-MCP twin tool. Adding/removing an owner tool must update this golden
// in lockstep.
const GOLDEN_TOOLSET: readonly string[] = [
  // me / seo / codes
  'me',
  // wiki / output are merged into one op (genre is a parameter) -- the admin
  // panel has long been a single route for this.
  'seo.set_entry_seo', 'seo.update_settings',
  'seo.get_settings', 'seo.stats',
  'codes.create', 'codes.revoke', 'codes.update_quotas',
  'codes.list', 'codes.list_members',
  'codes.list_denials', 'codes.add_denial', 'codes.remove_denial',
  // These four used to exist only on the admin panel (waypoints read/write /
  // ghost-evidence / revoking corpus entirely), with neither an MCP twin nor
  // an entry in the ledger. After moving into the convergence point, both
  // facades owe them at once.
  'codes.set_corpus_denials', 'codes.set_ghost_evidence',
  // codes.set_custom_page -- which page opens when this code is scanned
  // (a page is one rendering of a code).
  'codes.set_custom_page',
  'codes.waypoints', 'codes.set_waypoints',
  // corpus -- genre is a **parameter**, not three separate tool sets: before
  // normalization there were 11 tools here
  // (raw_dump / list_recent_{raw,wiki,output} / update_{wiki,output} /
  //  delete_{wiki,output} / promote_to_wiki / promote_wiki_to_output / corpus_get_entry),
  // and MCP couldn't create a wiki entry or edit a raw one -- those four gaps
  // got filled automatically once genre collapsed into one parameter.
  'subjectivity_write',
  'corpus.list', 'corpus.get', 'corpus.search',
  'corpus.create', 'corpus.update', 'corpus.delete', 'corpus.promote',
  // check_i18n -- inspects the multilingual structure without writing. The
  // owner's AI queries it once before writing a note with `> [!i18n]`, and
  // gets back the same diagnostic corpus.create would use to reject it (if
  // the two checks used separate logic, "checked out fine but still couldn't
  // write" would eventually happen, and the agent would just keep retrying).
  'corpus.check_i18n',
  // Assets -- **any genre** can carry an image / attachment / hero. There
  // used to be only one path for attaching an image (submitting the inline
  // image URL together with the form when writing a writing entry), so
  // "asset" wasn't its own thing, and there was no way at all for a raw
  // entry to carry an image. Now it's its own step: assets.upload first to
  // get an id, then reference standmeet-asset:<id> in the body, or set it as
  // the hero image.
  // assets.delete -- uploading the wrong one has to be undoable. With only
  // "attach" and no "detach", the owner's only recourse would be deleting
  // the whole entry.
  'assets.upload', 'assets.delete',
  // chat / conversations / prompts / roles
  // After both facades share one transcript payload, the op that reads it is
  // named conversations.get (chat.show_grounding was just the MCP side's old name).
  'conversations.list', 'conversations.get', 'conversations.ghost_telemetry',
  'prompt_create', 'prompt_list', 'prompt_delete', 'prompt_update', 'prompts.get',
  // providers -- the owner's provider registry. **No providers.create**:
  // creating one requires the raw API key, and MCP is a pure JSON tool
  // surface that doesn't carry secrets (same reasoning as ai_provider.set --
  // see owner/ops). List / update / set-default / delete never touch the
  // secret, so both facades get them.
  // providers.list_models -- takes this provider's stored key and asks it
  // "what models do you have" (F-R-11). Read-only, never touches the secret:
  // the key is stored encrypted, decryption only happens at the composition
  // root, and this surface only ever receives model names.
  'providers.list', 'providers.update', 'providers.set_default', 'providers.delete',
  'providers.list_models',
  'role_create', 'role_list', 'role_delete', 'role_update', 'roles.get',
  'roles.set_dock_buttons',
  // mcp servers / skills / capabilities
  // mcp_server_check -- the only thing you can ask once registered: does that
  // server respond, and what tools does it have. Without it, the only
  // evidence on an ext-MCP row is the URL the owner pasted in themselves
  // (F-D-8).
  'mcp_server_create', 'mcp_server_list', 'mcp_server_check', 'mcp_server_delete',
  'mcp_server_grant_dep',
  // skill_update -- added on 2026-08-22 alongside "the owner can grant a
  // connector's interface out", and **this golden did not get updated at the
  // same time** (the third time now -- see the file header).
  'skill_create', 'skill_update', 'skill_list', 'skill_delete', 'skill_set_enabled',
  'capabilities.list', 'capabilities.set_enabled', 'capabilities.delete',
  // writings
  // save is still writing_create (the multipart half hasn't moved -- see the
  // note in res_writings.go); the other four are named writings.* uniformly
  // by resource after moving into the convergence point.
  'writing_create',
  'writings.list', 'writings.publish', 'writings.unpublish', 'writings.delete',
  // custom page
  'custom_page.create', 'custom_page.list', 'custom_page.get_build',
  'custom_page.write_file', 'custom_page.build', 'custom_page.delete',
  'custom_page.promote_to_staging', 'custom_page.promote_to_live',
  'custom_page.rollback',
  // custom_page.set_byoai -- whether this page allows readers to bring their
  // own key (voided once a code is attached, which then decides instead).
  'custom_page.set_byoai',
  // page / calendar / booking / appearance
  'page.get', 'page.put', 'page.set_public_url',
  'page.pin', 'page.unpin',
  // Changing the handle and changing the public URL are the same kind of
  // thing (this instance's outward-facing address), hence set_handle rather
  // than update_handle; pinnable used to exist only on the admin panel.
  'page.set_handle', 'page.pinnable',
  // The booker's three owner tools are all provided by the **sandbox**
  // (declared as OwnerTools, implemented on its own side): list and cancel
  // used to each have a separate implementation on the host, a different
  // way of writing the same thing the sandbox already had.
  'calendar.list_slots', 'calendar.cancel_booking', 'bookings.list',
  'set_owner_css', 'appearance.get_css',
  // connectors
  'connectors.list', 'connectors.catalog', 'connectors.status',
  'connectors.create', 'connectors.update', 'connectors.delete',
  'connectors.activate', 'connectors.disconnect',
  'connectors.validate_spec', 'connectors.mail_test_send',
  // connectors.agent_ops -- same as skill_update, added in the 2026-08-22
  // batch, golden didn't follow.
  'connectors.agent_ops',
  // **The third source**: an owner op a connector manifest declares for
  // itself (`owner_ops:`). Everything above is hardcoded on the host side;
  // this one lives in `backend/connectors/google-calendar/manifest.yaml`,
  // added by F-C-16 -- and this golden didn't get updated at the time, so it
  // has been red ever since, unnoticed (see [[green-means-the-real-suite-ran]]:
  // a locally green run can't mask a cross-cutting guard's red).
  'connectors.calendar_check',
  // access requests / ip bans / domains / instance / marketplace / ai
  'access_requests.list', 'access_requests.update', 'access_requests.approve',
  'ip_bans.list', 'ip_bans.add', 'ip_bans.remove',
  'domains.list', 'domains.add', 'domains.remove',
  // A capability's configurable settings go through a **generic** surface
  // (capability_config.*), no longer a hardcoded set of tools per capability:
  // booking.get_policy / set_policy came from exactly that, and had drifted
  // from the sandbox's own policy.
  'capability_config.list', 'capability_config.get', 'capability_config.set',
  'instance.status', 'instance.inference_usage', 'instance.corpus_growth',
  // corpus_graph is a **newly-filled gap**: admin has always had
  // GET /stats/graph, and MCP had no twin; it didn't even have a line in the
  // hand-written comparison table -- the ratchet never saw it. Both facades
  // owed it after moving into the convergence point.
  'instance.corpus_graph',
  'instance.activity', 'instance.jobs',
  'marketplace.search', 'marketplace.install',
  'account.set_full_name', 'account.set_timezone', 'byoai.set', 'ai_provider.presets',
  // api-key facade management (facade-directions.md; MCP-first)
  'api_keys.create', 'api_keys.list', 'api_keys.revoke', 'api_keys.update',
  'api_keys.list_denials', 'api_keys.add_denial', 'api_keys.remove_denial',
  'api.open', 'api.close', 'api.list_candidates',
  // jobs plugin (jobs / resume / applications)
  'jobs.register_source', 'jobs.list_sources', 'jobs.unregister_source',
  'jobs.fetch_new', 'jobs.show', 'jobs.discard',
  'resume.draft', 'resume.update_draft', 'resume.discard_draft',
  'applications.commit',
];

let token = '';
let sid = '';

test.describe('能力归一化 · 【对外】tools/list 工具面 golden(真实客户端发现路径)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    token = await createAPIToken(request, csrf, 'norm-toolset');
    sid = await initMCP(request, token);
    await request.dispose();
  });

  test('tools/list 返回完整 owner 工具面(逐字等于 golden)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const names = (await listTools(request, token, sid)).map((t) => t.name).sort();
    expect(names).toEqual([...GOLDEN_TOOLSET].sort());
    await request.dispose();
  });

  // A capability can add its own field to the codes input schema (the
  // booker's max_bookings was the first, going through access.CodeExtras).
  // The access domain doesn't recognize it, so there's nothing at compile
  // time pinning down "it's still there": the wiring can break and stay
  // green, and the owner just loses the ability to set booking quotas via
  // MCP. This test pins exactly that down.
  test('codes 的入参 schema 带着能力贡献的字段(max_bookings)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const tools = await listTools(request, token, sid);
    for (const name of ['codes.create', 'codes.update_quotas']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} missing from tools/list`).toBeTruthy();
      expect(
        Object.keys(tool?.inputSchema?.properties ?? {}),
        `${name} lost the capability-contributed field`,
      ).toContain('max_bookings');
    }
    await request.dispose();
  });

  test('tools/list body 非空(回归守护:坏 schema 曾让整张表返空)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const tools = await listTools(request, token, sid);
      expect(tools.length).toBeGreaterThan(0);
      // Every tool must have a name -- proving serialization wasn't truncated
      // by some bad schema.
      for (const t of tools) expect(t.name).toBeTruthy();
      await request.dispose();
    });
});
