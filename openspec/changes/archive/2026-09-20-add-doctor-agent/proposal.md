## Why

Hoy el instalador `install.sh` solo crea enlaces en `~/.config/opencode/`
y aborta en silencio cuando faltan dependencias del entorno — Nerd Fonts,
`lazygit`, `lazydocker`, `openspec`, `codegraph`, `serena`, o los MCPs
declarados en `opencode.jsonc`. El operador descubre cada hueco cuando
un comando falla, no cuando ejecuta el instalador. Tampoco hay una
forma de auditar rápidamente si una propuesta OpenSpec quedó a medias
o si un cambio aplicado dejó la configuración rota.

El resultado es fricción al primer arranque, fallos silenciosos en
configuraciones parciales, y ningún lugar donde el operador pueda
preguntar "¿está sano este entorno?". Necesitamos un agente **`doctor`**
que diagnostique y arregle el estado del entorno, sin invocar `mmx` y
sin depender de un proveedor de modelos específico.

## What Changes

- Crear un agente global `agent/doctor.md` que diagnostique el entorno
  y aplique reparaciones seguras, con permisos mínimos y un
  comportamiento de "informe + reparación bajo aprobación explícita"
  para acciones que tocan MCPs remotos, credenciales o propuestas
  OpenSpec pendientes.
- Añadir un comando `commands/doctor.md` que invoque al agente desde
  la TUI como `/doctor`.
- Añadir un script determinista `scripts/doctor.mjs` que ejecute las
  comprobaciones reproducibles (instaladores, validadores, estado de
  OpenSpec, MCPs, Nerd Fonts) sin requerir un modelo en línea.
- Hacer que `install.sh` solo cree los enlaces y, cuando detecte
  dependencias faltantes, emita una advertencia explícita que indique
  al operador cómo invocar `/doctor`. La instalación de Nerd Fonts se
  mantiene como está; `doctor` reporta su estado sin reinstalarla.
- Documentar el flujo en `README.md` bajo una nueva sección
  "Diagnose and repair (`/doctor`)".
- Exponer `doctor` en la tabla de agentes por defecto de `agent/routing.md`
  para que el clasificador lo pueda derivar cuando un usuario pida
  explícitamente una comprobación del entorno.

## Capabilities

### New Capabilities

- `doctor-agent`: diagnóstico y reparación del entorno OpenCode,
  ejecutable desde la TUI como `/doctor` o como script independiente
  `scripts/doctor.mjs`. Cubre estado del SO, gestores de paquetes,
  dependencias del instalador, Nerd Fonts, propuestas OpenSpec
  pendientes, configuración local, MCPs y symlinks de la
  configuración global.

### Modified Capabilities

- `agent-routing`: añadir el agente `doctor` a la tabla por defecto
  en `agent/routing.md` con `steps: 100` y permisos de solo lectura,
  para que el clasificador lo pueda derivar sin promoverlo a primario.
  No se cambian las clases (`small` / `medium` / `spec-required` /
  `audit`), solo se documenta su rol.

## Impact

- **Archivos nuevos:**
  - `agent/doctor.md` — definición del agente (frontmatter + cuerpo).
  - `commands/doctor.md` — wrapper `subtask: true` para `/doctor`.
  - `scripts/doctor.mjs` — comprobaciones reproducibles sin modelo.
  - `openspec/changes/add-doctor-agent/specs/doctor-agent/spec.md` —
    delta de la nueva capacidad.
- **Archivos modificados:**
  - `install.sh` — emitir un aviso accionable cuando falten
    dependencias o MCPs; eliminar cualquier intento de instalar
    `lazygit`/`lazydocker` desde aquí (queda en `/doctor`).
  - `README.md` — añadir sección "Diagnose and repair (`/doctor`)"
    con el flujo de uso, los modos `--check-only` y `--apply-safe`,
    y el opt-out por variable de entorno.
  - `agent/routing.md` — añadir fila `doctor` en la tabla por
    defecto, sin alterar las clases.
- **Compatibilidad:** la capacidad `agent-routing` ya exige que toda
  nueva entrada respete `subagent_depth` y el deny-by-default del
  bloque `permission`. `doctor` hereda ese contrato y no introduce
  permisos de edición fuera de su carpeta de trabajo.
- **Riesgo:** las acciones que tocan el estado del usuario (instalar
  paquetes, vincular MCPs) deben pasar siempre por una confirmación
  explícita del operador. `doctor` se documenta como herramienta
  "check-first, apply-second"; el script `--check-only` es seguro y
  el script `--apply-safe` solo aplica acciones reversibles.
