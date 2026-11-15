/** Convert the existing small V1 argument descriptors into a V2 JSON schema. */
export function toolInputSchema(args = {}) {
  const entries = Object.entries(args);
  const properties = Object.fromEntries(entries.map(([name, descriptor]) => {
    const property = { type: descriptor.type };
    if (descriptor.description) property.description = descriptor.description;
    if (descriptor.type === "array") property.items = { type: "string" };
    return [name, property];
  }));
  const required = entries.filter(([, descriptor]) => descriptor.required === true).map(([name]) => name);
  return { type: "object", properties, required, additionalProperties: false };
}

export function adaptV2WorktreeApi(api, projectID) {
  if (!api || typeof api.create !== "function" || typeof api.list !== "function" || typeof api.remove !== "function") return null;
  return {
    async create({ name, branch }) {
      const result = await api.create({ projectID, name, ...(branch ? { branch } : {}) });
      return result?.data ?? result;
    },
    async list() {
      const result = await api.list({ projectID });
      return { data: result?.data ?? result };
    },
    async remove({ directory }) {
      const result = await api.remove({ projectID, directory, force: false });
      return { data: result?.data ?? result };
    },
  };
}

async function resolveSessionContext(ctx, toolContext) {
  const sessionID = toolContext?.sessionID;
  if (typeof sessionID !== "string" || !sessionID || typeof ctx?.session?.get !== "function") {
    return { ok: false, reason: "the active session context is unavailable" };
  }
  let session;
  try {
    session = await ctx.session.get({ sessionID });
  } catch {
    return { ok: false, reason: "the active session context could not be read" };
  }
  const directory = session?.location?.directory ?? session?.directory;
  const projectID = session?.projectID ?? session?.location?.project?.id;
  if (typeof directory !== "string" || !directory || typeof projectID !== "string" || !projectID) {
    return { ok: false, reason: "the active session has no verified directory and project identity" };
  }
  return { ok: true, sessionID, directory, projectID };
}

export async function registerV2Tools(ctx, pluginId, toolFactory, { worktree = false } = {}) {
  const legacySurface = await toolFactory();
  const registration = await ctx.tool.transform((editor) => {
    for (const [name, definition] of Object.entries(legacySurface.tool ?? {})) {
      editor.add({
        name,
        description: definition.description,
        input: toolInputSchema(definition.args),
        execute: async (input, toolContext) => {
          const session = await resolveSessionContext(ctx, toolContext);
          if (!session.ok) return { content: JSON.stringify({ ok: false, blocked: true, reason: session.reason }) };
          const worktreeApi = worktree ? adaptV2WorktreeApi(ctx?.worktree, session.projectID) : null;
          const result = await definition.execute(input ?? {}, {
            directory: session.directory,
            projectID: session.projectID,
            worktree: worktreeApi,
            client: { worktree: worktreeApi },
            sessionID: session.sessionID,
          });
          return { content: typeof result === "string" ? result : JSON.stringify(result) };
        },
      });
    }
  });
  if (!registration || typeof registration.dispose !== "function") {
    throw new Error(`${pluginId}: OpenCode V2 did not return a tool registration handle`);
  }
  return () => registration.dispose();
}
