## Why

La configuración global actual del OpenCode privilegia capacidad sobre economía de contexto: `permission: "allow"` global, los cuatro MCP habilitados en cada sesión, dieciséis skills con descripción model-invocable, prompts extensos en `build`, `cotizador`, `qa` y `adversarial`, y una clasificación `small`/`medium`/`spec-required` que no se traduce en una política de modelo, profundidad de delegación ni presupuesto de tool output. Resultado: cada sesión carga contexto y dispara herramientas más de lo que la tarea requiere, y la divergencia entre archivos de agentes y `opencode.jsonc` (modelos, herramientas, permisos) hace que el comportamiento efectivo sea difícil de predecir o de auditar.

## What Changes

- Adoptar una **política explícita de routing por perfil de trabajo** (`small` / `medium` / `spec-required` / `auditoría`) que mapea clasificación → modelo → delegación → herramientas permitidas. Modelos Terra quedan reservados a decisiones irreversibles y de alta ambigüedad (arquitectura, propuesta OpenSpec, refactors riesgosos, cotización externa); M2.7-highspeed para discovery y tareas triviales; M3 como ejecutor por defecto.
- Fijar **topología de delegación en profundidad 1**: el agente primario resuelve y delega al especialista final; los subagentes no vuelven a delegar. Sólo `orchestrator` y `refactor` justifican profundidad 2, con presupuesto explícito.
- Migrar la política de `tools` (deprecado) a `permission` por agente, y reemplazar `permission: "allow"` global por un baseline mínimo (`bash`, `task`, `external_directory`, `webfetch`, `websearch`, edición) con permisos específicos concedidos por rol.
- Definir **presupuesto de contexto y tool output**: límites explícitos de `tool_output.max_lines`/`max_bytes`, `compaction.prune: true`, `tail_turns` y `preserve_recent_tokens` definidos, y `steps` por agente ajustado al coste esperado de cada rol.
- Establecer **perfiles MCP por rol/sesión**: CodeGraph como base para navegación; Serena sólo para `refactor`; Playwright sólo para `frontend`, `qa`, `cotizador`; Context7 sólo cuando se requiere documentación actual de una dependencia. Eliminar el arranque indiscriminado de los cuatro MCP en cada sesión.
- Reducir la **carga de prompts y skills**: pasar a `disable-model-invocation: true` los skills de operación especializada que rara vez se invocan (`archify`, `herdr-integration`, `mmx-cli`, `caveman-commit`, `git-workflow`, `writing-great-skills`). Aplicar divulgación progresiva a skills extensos (`interface-design`).
- Resolver **divergencias y duplicaciones**: una única fuente canónica para `/opsx-*` (sin copias divergentes entre `commands/` y `.opencode/commands/`); modelo por agente decidido en un solo lugar (frontmatter); alinear la asignación efectiva con la documentada.
- Introducir **modos `targeted` / `full`** en `qa`, `adversarial` y `cotizador`. El modo por defecto es `targeted`; `full` requiere pedido explícito o señal de riesgo.
- Instrumentar **métricas operativas** (tokens por sesión, tool calls, número de subagentes, ratio `small`/`medium`, compactaciones) para verificar el impacto del cambio durante dos semanas.

## Capabilities

### New Capabilities

- `agent-routing`: contrato que mapea clasificación de trabajo a modelo, profundidad de delegación y herramientas permitidas para cada agente global. Define los modos `targeted`/`full` y los criterios para escalar entre ellos.
- `context-budget`: presupuesto explícito de tokens, tool output y compactación, más límites de `steps` por agente. Cubre defaults de OpenCode hoy implícitos (2.000 líneas / 51 KB por salida de herramienta) que dominan el contexto cuando intervienen MCPs.
- `mcp-profiles`: política de habilitación de MCPs por agente y por sesión, y migración de `tools` (deprecado) a `permission` para que el control sea verificable.
- `skill-surface`: reglas para decidir qué skills quedan model-invocables y cuáles pasan a invocación manual, más directrices de divulgación progresiva para skills grandes.

### Modified Capabilities

_(No aplica. La única capability existente, `tui-quota-footer`, describe el comportamiento del plugin de TUI y no se ve afectada por este cambio.)_

## Impact

- **Configuración**: `opencode.jsonc` (global) y eventuales overrides en `.opencode/opencode.jsonc` por proyecto. Reescritura significativa de permisos, modelos por agente, defaults de compactación y tool output, y habilitación de MCPs.
- **Agentes**: actualizar `agent/build.md`, `agent/plan.md`, `agent/architect.md`, `agent/frontend.md`, `agent/backend.md`, `agent/qa.md`, `agent/adversarial.md`, `agent/cotizador.md`, `agent/refactor.md`, `agent/orchestrator.md`, `agent/p5t-installer.md`. Posible creación de un agente coordinador explícito para flujos `spec-required` si la opción de profundidad 1 lo requiere.
- **Comandos**: unificación de `/opsx-*` y eliminación de copias divergentes. `commands/opsx-propose.md`, `opsx-apply.md`, `opsx-explore.md`, `opsx-update.md`, `opsx-archive.md`, `opsx-sync.md`.
- **Skills**: frontmatter de cada `skills/<name>/SKILL.md` con `disable-model-invocation` según corresponda; movimiento de contenido extenso a referencias progresivas en `interface-design` y otros skills grandes.
- **Instalador**: `install.sh` debe seguir enlazando una única fuente canónica; sin cambios de comportamiento para el usuario más allá de la nueva configuración.
- **Comportamiento observable**: sesiones con menos tool calls y menos contexto retenido; agentes con permisos coherentes; capacidad de auditar qué herramientas se ofrecen por agente; necesidad explícita para activar modos `full` de auditoría.
- **Compatibilidad**: `tools` se mantiene en el corto plazo como shim hasta migrar cada agente a `permission`; comportamiento de los MCPs cambia al pasar de "todos habilitados" a "habilitados por agente".
