const expected = [
  'sandbox_build', 'sandbox_rebuild', 'sandbox_transfer', 'sandbox_recover_transition',
  'sandbox_start', 'sandbox_status', 'sandbox_finish', 'sandbox_cancel', 'sandbox_recover',
  'reservation_start', 'reservation_stop', 'reservation_recover', 'sandbox_preflight', 'sandbox_supervisor',
  'worktree_create', 'worktree_list', 'worktree_capacity', 'worktree_candidates', 'worktree_retire',
  'worktree_lock', 'worktree_reconcile',
];

export default {
  id: 'at188.runtime-probe',
  async setup(ctx) {
    await ctx.tool.transform((editor) => editor.add({
      name: 'at188_probe_marker',
      description: 'Runtime probe marker',
      input: { type: 'object', properties: {}, additionalProperties: false },
      async execute() { return { content: 'ok' }; },
    }));
    const tools = await ctx.tool.list();
    const ids = tools.map((tool) => tool.id ?? tool.name ?? JSON.stringify(tool));
    const counts = Object.fromEntries(expected.map((id) => [id, ids.filter((toolId) => toolId === id).length]));
    console.log(`AT188_TOOL_IDS ${JSON.stringify({ ids, counts })}`);
    setTimeout(async () => {
      try {
        const late = await ctx.tool.list();
        const lateIds = late.map((tool) => tool.id ?? tool.name ?? JSON.stringify(tool));
        const lateCounts = Object.fromEntries(expected.map((id) => [id, lateIds.filter((toolId) => toolId === id).length]));
        console.log(`AT188_TOOL_IDS_LATE ${JSON.stringify({ ids: lateIds, counts: lateCounts })}`);
      } catch (error) {
        console.log(`AT188_TOOL_IDS_LATE_ERROR ${String(error?.message ?? error)}`);
      }
    }, 1500);
    // Verify the registered native command through the public API, without a
    // model. No raw prompt is admitted and no tool executor should run.
    setTimeout(async () => {
      let stage = 'hooks';
      try {
        let toolCalls = 0;
        let modelCalls = 0;
        await ctx.tool.hook('execute.before', () => { toolCalls++; });
        await ctx.session.hook('context', () => { modelCalls++; });
        stage = 'session';
        const session = await ctx.session.create({ title: 'AT-200 native command verification' });
        stage = 'commands';
        const inputs = ['', 'help', 'help extra', 'unknown', 'transfer', 'build "unfinished', 'transfer a b', 'build ../outside.json'];
        for (const text of inputs) await ctx.session.command({ sessionID: session.id, name: 'sandbox', text });
        stage = 'context';
        const messages = await ctx.session.context({ sessionID: session.id });
        const inboxResponse = await fetch(`http://127.0.0.1:8080/api/session/${encodeURIComponent(session.id)}/inbox`, {
          headers: { Authorization: `Basic ${btoa(`opencode:${process.env.OPENCODE_PASSWORD}`)}` },
        });
        if (!inboxResponse.ok) throw new Error('inbox API unavailable');
        const inbox = await inboxResponse.json();
        const serialized = JSON.stringify({ messages, inbox });
        console.log(`AT200_COMMAND_PROOF ${JSON.stringify({ count: inputs.length, toolCalls, modelCalls,
          usageSeen: serialized.includes('/sandbox build [path]'), invalidSeen: serialized.includes('invalid sandbox arguments'),
          messageCount: Array.isArray(messages) ? messages.length : null,
          syntheticSeen: serialized.includes('"type":"synthetic"'),
          responseScope: 'canonical context and pending synthetic inbox',
          modelRequired: false, native: true })}`);
      } catch (error) {
        console.log(`AT200_COMMAND_PROOF_ERROR ${JSON.stringify({ stage, type: error?.name ?? 'Error', code: error?.code ?? null })}`);
      }
    }, 2500);
  },
};
