## Context

`install.sh` ya instala Nerd Fonts de forma no fatal y avisa cuando
falta `openspec`, pero no detecta dependencias del entorno del
operador (`lazygit`, `lazydocker`, `codegraph`, `serena`, MCPs
declarados) ni el estado de las propuestas OpenSpec en vuelo. El
operador descubre esos huecos cuando un comando falla, y el
instalador no tiene un lugar natural donde reportarlos. No existe
hoy un agente de "health check" reutilizable. La matriz de routing
en `agent/routing.md` ya exige que toda nueva entrada respete
`subagent_depth`, el deny-by-default y la tabla por defecto.

El cambio añade un agente `doctor` con un script determinista
asociado, dejando `install.sh` enfocado en crear enlaces y
recomendando `/doctor` cuando algo falta. La propuesta y los specs
definen el contrato; este documento explica cómo se reparte el
trabajo entre script, agente y `install.sh`.

## Goals / Non-Goals

**Goals:**

- Un comando único (`/doctor`) y un script independiente
  (`scripts/doctor.mjs`) que cubran diagnóstico y reparación segura
  sin invocar un modelo.
- Reparaciones idempotentes y reversibles (instalación de paquetes,
  recreación de symlinks, ejecución del validador).
- Reporte claro con tres niveles: `ok`, `warn`, `fail`, más
  `requires-approval` para acciones que tocan MCPs, credenciales o
  propuestas OpenSpec.
- `install.sh` ya no intenta instalar `lazygit` o `lazydocker`;
  detecta su ausencia y delega en `/doctor`.
- Cobertura multiplataforma: Linux y macOS en Bash/Node, Windows
  nativo mediante un script PowerShell equivalente al doctor (no
  cubierto por este cambio para mantenerlo enfocado).

**Non-Goals:**

- No se invoca `mmx`, Codex u Ollama desde el script ni desde el
  instalador. El agente `doctor` puede interpretar el reporte con un
  modelo, pero no es un paso del flujo determinista.
- No se aplica automáticamente ninguna propuesta OpenSpec, no se
  activan MCPs deshabilitados y no se crean credenciales. Esas
  acciones siempre pasan por aprobación explícita.
- No se reemplaza `scripts/validate-config.mjs`; el doctor lo invoca
  como una de sus verificaciones.
- No se introduce un nuevo entry-point para Windows nativo en este
  cambio. Si el operador lo necesita, una propuesta posterior puede
  añadir `scripts/install-doctor.ps1` siguiendo el mismo patrón que
  `install-nerd-fonts.ps1`.

## Decisions

### Un script determinista primero, agente después

**Elección:** `scripts/doctor.mjs` implementa todas las
comprobaciones reproducibles (parsear `opencode.jsonc`, ejecutar
`openspec status`, detectar gestores, recrear symlinks) y `agent/doctor.md`
actúa como orquestador que interpreta el reporte y guía al operador.

**Rationale:** el script es invocable sin un modelo autenticado y sin
una sesión de OpenCode, lo cual es crítico para entornos CI o para
hosts donde la IA todavía no está configurada. El agente añade
narrativa y priorización cuando está disponible.

**Alternativas consideradas:**

- Solo agente, sin script: descarta los casos donde OpenCode no
  está disponible todavía.
- Solo script, sin agente: pierde la narrativa y la capacidad de
  priorizar hallazgos en configuraciones no triviales.

### Reparación segura separada de la inspección

**Elección:** dos modos explícitos:
- `node scripts/doctor.mjs --check-only` (defecto) — solo lee.
- `node scripts/doctor.mjs --apply-safe` — además de leer, instala
  dependencias y repara symlinks.

**Rationale:** la separación refleja el contrato del spec
"Check-only mode is safe to run anytime" y permite que un pipeline CI
ejecute el chequeo sin riesgo. La acción `--apply-safe` queda
documentada como reversible y limitada a operaciones idempotentes.

**Alternativas consideradas:**

- Un único modo "auto": rechazado por seguridad. `install.sh` debe
  poder ejecutarse en entornos donde la IA no aprueba nada.
- Modo `--apply-all`: rechazado porque incluiría activación de MCPs
  y aplicación de OpenSpec, lo cual excede el contrato del spec.

### `install.sh` solo enlaza y delega

**Elección:** `install.sh` mantiene su flujo actual (validator +
Nerd Fonts + symlinks), pero añade una verificación previa de
dependencias y un bloque de warning final con la línea de remediación
`/doctor` o `node scripts/doctor.mjs --apply-safe`. No instala
`lazygit` ni `lazydocker`.

**Rationale:** `install.sh` es el primer paso tras clonar el repo;
debe ser determinista y no añadir dependencias nuevas. `doctor`
absorbe la responsabilidad de instalar binarios.

**Alternativas consideradas:**

- Mover Nerd Fonts al doctor: rechazado porque ya está documentado
  como paso del instalador y funciona sin un modelo.

### El reporte usa `requires-approval` para lo no reversible

**Elección:** el reporte imprime cuatro categorías (`ok`, `warn`,
`fail`, `requires-approval`). La última nombra el comando exacto que
el operador debe ejecutar para aplicar la acción (por ejemplo,
`/opsx-apply add-doctor-agent` o editar una línea concreta de
`opencode.jsonc`).

**Rationale:** el operador ve la acción sugerida sin que el doctor
la ejecute. Es el patrón que ya usa `p5t-installer` para secretos:
detectar y recomendar, nunca escribir.

**Alternativas consideradas:**

- Marcar como `warn` las acciones que requieren aprobación: las
  mezcla con advertencias inofensivas y diluye la señal.
- Aplicar y revertir: añade un riesgo innecesario para un agente
  que ya cubre la lectura por defecto.

## Risks / Trade-offs

- **Cobertura de gestores limitada a brew/apt/dnf/pacman** →
  mitigado por emitir `fail` claro con el comando manual cuando
  ninguno esté disponible, y por documentar Homebrew como camino
  recomendado en macOS.
- **`openspec status --json` puede ser lento en repos grandes** →
  mitigado por ejecutarlo solo una vez por corrida y cachear el
  resultado en memoria del script.
- **El doctor podría sugerir reparaciones que el operador no
  autorizó culturalmente (por ejemplo, instalar paquetes sin
  sudo)** → mitigado por nunca invocar sudo, nunca modificar
  `/etc/`, `/usr/`, ni `%ProgramFiles%`, y por emitir `fail` con
  remediación explícita cuando el destino del symlink necesite
  elevación.
- **Falsos negativos en la detección de MCP habilitado** → mitigado
  por contrastar `enabled` y la presencia del token `<mcp>_*` en
  algún `permission` de agente, igual que el validador estático.
- **Windows queda fuera de este cambio** → aceptado; el script es
  multiplataforma a nivel de inspección pero la instalación de
  paquetes sigue siendo específica de Unix en esta entrega. La
  propuesta deja el espacio para un `install-doctor.ps1` posterior.

## Migration Plan

- Añadir `agent/doctor.md` y `commands/doctor.md` con los permisos
  mínimos consistentes con la matriz de routing.
- Añadir `scripts/doctor.mjs` ejecutable y testeable sin un modelo.
- Modificar `install.sh` para detectar dependencias y emitir un
  bloque de warning con la remediación `/doctor`; no instalar
  `lazygit` ni `lazydocker` desde aquí.
- Añadir la fila `doctor` a la tabla por defecto en
  `agent/routing.md`.
- Actualizar `README.md` con la nueva sección "Diagnose and repair
  (`/doctor`)" describiendo los dos modos y el flujo recomendado.
- Rollback: borrar los archivos nuevos y revertir los diffs en
  `install.sh`, `agent/routing.md` y `README.md`.

## Open Questions

- ¿`scripts/doctor.mjs` debe aceptar también un flag
  `--json` para integrarlo con pipelines? Se resuelve durante el
  apply si una tarea lo requiere; no cambia el contrato del spec.
