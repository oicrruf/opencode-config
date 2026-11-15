const expected = [
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
  },
};
