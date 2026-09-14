## Why

`quota-tui.tsx` y futuros plugins renderizan iconos Nerd Font (familia
`nf-md-*` como `󰧑`, `󰚩`, `󰃖`, `󰀄`) en la barra inferior y en los
estados de error. Hoy el instalador `install.sh` solo enlaza la
configuración a `~/.config/opencode/`: presupone que el usuario ya
tiene Nerd Fonts configuradas en su terminal, pero no verifica ni
instala nada. El README documenta únicamente WSL/Linux y no menciona el
requisito, así que un operador nuevo descubre la dependencia solo
después de ver los iconos como caracteres `Tofu` (``). Esta fricción
es material: la barra inferior del TUI deja de ser legible sin la
fuente.

## What Changes

- Añadir un script de instalación de **JetBrainsMono Nerd Font** desde
  el release oficial *latest* de `ryanoasis/nerd-fonts`, idempotente y
  restringido al ámbito del usuario (`~/.local/share/fonts`,
  `~/Library/Fonts`, `%LOCALAPPDATA%\Microsoft\Windows\Fonts`).
- Implementar tres instaladores, uno por familia de sistema operativo:
  - `scripts/install-nerd-fonts.sh` para Linux y macOS (Bash, invocado
    desde `install.sh`).
  - `scripts/install-nerd-fonts.ps1` para Windows nativo
    (PowerShell 5.1+), independiente de WSL.
- Detectar el sistema operativo y delegar al script correcto desde
  `install.sh`, sin romper la instalación actual cuando el script de
  fuente no pueda ejecutarse (red caída, `curl`/`Invoke-WebRequest`
  ausentes, sin permiso de escritura sobre el directorio de fuentes).
- Refrescar la caché de fuentes después de una instalación exitosa:
  `fc-cache -f` en Linux/macOS, registro del directorio en Windows vía
  la API `AddFontResource` expuesta por `Add-Type` no es necesario
  porque Windows enumera la carpeta en el arranque y la mayoría de
  terminales la releen al cambiar el perfil.
- Documentar en `README.md` el nuevo paso de instalación, los sistemas
  soportados y la instrucción explícita de **seleccionar manualmente**
  JetBrainsMono Nerd Font en el perfil de la terminal; instalar la
  fuente no la activa por sí misma en Windows Terminal, Terminal de
  macOS, iTerm2 ni en las terminales Linux.
- Añadir la dependencia documentada al JSDoc de `quota-tui.tsx` y a
  cualquier otra sección del README que actualmente asume la fuente
  sin nombrarla.

No es `BREAKING`: el comportamiento cuando las fuentes ya están
instaladas es idempotente (sin redescarga, sin reinstalación). Cuando
la fuente no puede descargarse, el script falla con un mensaje
accionable y el instalador de configuración continúa sin abortar, así
los enlaces de OpenCode se crean aunque Nerd Fonts quede pendiente.

## Capabilities

### New Capabilities

- `install-nerd-fonts`: instalador multiplataforma de JetBrainsMono
  Nerd Font que cubre detección de SO, descarga desde el release
  *latest*, extracción, copia al directorio por usuario y refresco de
  caché cuando aplique, con manejo explícito de los modos "ya
  instalada", "descarga fallida" y "fuente presente en una variante
  distinta".

### Modified Capabilities

_Ninguna._ El cambio no altera ninguna capacidad existente; las
secciones de la spec `tui-quota-footer` siguen siendo correctas porque
no describen el comportamiento del instalador.

## Impact

- **Archivos nuevos:**
  - `scripts/install-nerd-fonts.sh` (Bash, Linux/macOS).
  - `scripts/install-nerd-fonts.ps1` (PowerShell, Windows).
  - `openspec/changes/install-nerd-fonts/specs/install-nerd-fonts/spec.md`.
- **Archivos modificados:**
  - `install.sh`: invocar el script de fuente antes de los enlaces,
    continuar si el script de fuente falla con un mensaje no fatal.
  - `README.md`: nueva sección "Nerd Fonts" antes de "Initialize a
    project", documentando sistemas soportados, qué hace el script y
    cómo seleccionar la fuente en la terminal tras la instalación.
  - `quota-tui.tsx`: añadir Nerd Fonts al docblock de prerrequisitos
    (no cambia el contrato visible).
- **Dependencias externas:** `curl` o `wget` en Linux/macOS,
  `Invoke-WebRequest` y `Expand-Archive` en PowerShell (presentes por
  defecto en Windows 10+ y PowerShell 5.1+).
- **Compatibilidad:** macOS 12+, Ubuntu 20.04+/Debian 11+ con glibc
  reciente, Windows 10+ con PowerShell 5.1. En sistemas más antiguos el
  script imprime una advertencia accionable en lugar de fallar la
  instalación completa.
- **Riesgo:** descarga de binarios desde GitHub Releases sin verificación
  de checksum contra un valor fijado en el repo. Aceptado porque el
  usuario eligió explícitamente "latest oficial" sobre "fijar versión y
  checksum"; el coste de un release comprometido queda mitigado por la
  instalación por usuario (sin escalado de privilegios).
