# Design

## Context

Ver `proposal.md` y AT-188. El root se renderiza como archivo regular; agentes, comandos, skills y TUI se enlazan. El instalador también enlaza Herdr y worktree, pero omite sandbox. Doctor acepta cualquier symlink sin comprobar su origen y puede sustituir el root regular mediante `--apply-safe`.

## Goals / Non-Goals

**Goals:** Un mismo inventario, reglas de propiedad y plan observable para instalar, comprobar y diagnosticar; migración conservadora; pruebas aisladas con evidencia suficiente para cada afirmación.

**Non-Goals:** Inventariar cada archivo dentro de árboles enlazados, administrar todos los recursos globales, cambiar modelos o aprovisionar Docker/dependencias. No se implementan AT-189, AT-198 o AT-200. El manifiesto protege el límite global de los enlaces; los cambios dentro del checkout siguen perteneciendo al repositorio y no se revierten durante una instalación.

## Decisions

### 1. Inventario compartido y manifiesto validado

`scripts/resource-manifest.mjs` define recursos esperados y un manifiesto local `.opencode-resource-manifest.json` bajo la configuración efectiva. Incluye versión, raíz propietaria del checkout, perfil y entradas con identificador/ruta relativa segura, tipo y origen de enlace o SHA-256 de archivo. El inventario cubre root, agents→agent, commands, skills, TUI, helper Herdr y entrypoints Herdr/worktree/sandbox. Las instrucciones configuradas se comprueban si se distribuyen; no se añade una nueva capa de instrucciones de AT-190.

No se confía en rutas arbitrarias del manifiesto: validar estructura, campos, identificadores únicos, tipos, versión y pertenencia a rutas administradas. Rechazar traversal, padres enlazados, archivos especiales y manifiesto enlazado. Inspeccionar enlaces con lstat/readlink, incluyendo enlaces rotos; no seguirlos para escribir o borrar sus destinos.

La alternativa de duplicar listas y reglas en shell y doctor se descarta por deriva. La granularidad de enlace preserva la distribución existente sin convertir el cambio en un gestor general de archivos.

### 2. Propiedad y migración sin toma de archivos ajenos

Con manifiesto, un enlace pertenece a la instalación solo mientras conserva el origen registrado; un archivo regular, solo mientras conserva el digest registrado. Un recurso ausente puede recrearse; uno sustituido o modificado se conserva como conflicto, nunca se repara sobrescribiéndolo. Un recurso propio idéntico puede actualizarse a la versión actual después de validar todo el plan. Una ruta obsoleta propia se retira únicamente si conserva identidad; una modificada se conserva y se informa con identidad previa retenida para diagnósticos posteriores.

Sin manifiesto, crear destinos ausentes y adoptar solo enlaces exactos a recursos actuales del checkout. Un root regular existente debe coincidir byte a byte con el render de un perfil conocido antes de adoptarlo; si hay más de un perfil equivalente y no hay selección explícita, informar ambigüedad. Un root enlazado solo se adopta si coincide con un origen legado conocido del mismo checkout y su contenido es un render conocido. No adoptar otro enlace, directorio real ajeno o root editado. La adopción acreditada precede cualquier reemplazo del root y conserva backup cuando cambia.

Herdr conserva su gestión propia: no modificar su código ni reemplazar una instalación global ajena. El enlace exacto conocido de este checkout puede registrarse; otro contenido se informa y conserva. El legado autonomy no se elimina por nombre ni por ser symlink: exige propiedad acreditada; sin ella, informar y conservar.

### 3. Plan previo, aplicación y recuperación

Calcular render e inspección en memoria, sin crear directorios, temporales o backups en el modo check. El plan identifica keep/create/update/remove/adopt/conflict/retained. Revisar el plan completo, validar render/perfil y resolver conflictos antes de la primera mutación de destinos. Ante conflicto activo, manifiesto inválido, ambigüedad o error de validación, no modificar root, enlaces, manifiesto ni recursos ajenos; el paso de fuentes tampoco se ejecuta.

Revalidar identidad inmediatamente antes de aplicar y serializar instalaciones concurrentes. Actualizar root y manifiesto con temporales exclusivos y rename en el mismo filesystem; backups únicos para root propio actualizado. Registrar operaciones aplicadas de forma recuperable: un fallo parcial no se presenta como éxito ni convierte archivos desconocidos en propios. No prometer una transacción atómica entre múltiples rutas; conservar evidencia y detener nuevas acciones si la recuperación no es verificable. Pruebas de fallo inyectado y concurrencia acreditan estas reglas.

Cuando no cambia nada, preservar contenido y mtimes del root, manifiesto y enlaces. Retener la procedencia de obsoletos preservados; no borrar el registro para ocultar drift. No borrar un manifiesto como estrategia normal de recuperación o rollback.

### 4. Perfiles, check y doctor

La instalación sin --profile conserva el contrato existente de usar defaultProfile. La comprobación sin --profile usa el perfil del manifiesto válido; con --profile compara contra el solicitado sin activarlo. Sin manifiesto no hay instalación acreditada: diagnosticar migración pendiente y salir no sincronizado, aunque se pueda inferir un perfil conocido. Un perfil desconocido o ambiguo nunca se activa silenciosamente.

Resultados del helper/check: 0 sincronizado o aplicación correcta, 1 drift/conflicto/recurso conservado pendiente, 2 argumentos/estado inválido/error operativo. Informar por ruta y motivo; no afirmar carga runtime. `--check` no ejecuta gates que escriban, fuentes, instaladores, reparaciones ni proveedores. Mantener las invocaciones existentes y normalización de rutas de Linux/macOS/WSL/Git Bash.

Doctor reutiliza inspección y catálogo: root regular/digest/perfil, enlaces al origen correcto, entrypoints esperados y configuración efectiva ambigua (por ejemplo roots JSON/JSONC simultáneos). `--check-only` y `--dry-run` no mutan. `--apply-safe` solo repara ausencias con propiedad acreditada y sin conflictos; nunca reemplaza un root regular por symlink ni desplaza archivos ajenos. No ampliar instalaciones de dependencias existentes en doctor dentro de este cambio. El delta `specs/doctor-agent/spec.md` sustituye los requisitos principales de check-only y reparación segura, eliminando la antigua obligación de respaldar y reemplazar destinos modificados; mantiene la instalación existente de herramientas.

### 5. Plugins y pruebas

Añadir sandbox al mismo inventario de entrypoints que worktree. Verificar imports relativos desde el entrypoint instalado y que la configuración usada por la prueba no produce doble descubrimiento. Tests de importación y presencia acreditan esas propiedades únicamente; la carga efectiva de OpenCode requiere una sesión runtime con inventario de herramientas y ausencia de duplicados, ejecutada mediante sandbox-control.

Fixtures usan HOME/XDG_CONFIG_HOME y fuentes temporales, fuentes/fonts desactivadas y ningún secreto real. Cubrir árbol ajeno, root editado, symlinks rotos y padres enlazados, cambio de perfil, migración, obsoletos, fallo antes de escritura, fallo parcial, concurrencia y mtime/idempotencia. No ejecutar install.sh ni doctor --apply-safe contra la configuración real como prueba.

## Risks / Trade-offs

- Metadatos de propiedad dañados → rechazo explícito, sin asumir primera instalación.
- Checkout movido → conservar enlaces desconocidos y exigir reconciliación, sin apropiación automática.
- TOCTOU/concurrencia → lock más revalidación antes de mutar; fallos inciertos se conservan y reportan.
- Múltiples destinos no son transacción única → recuperación verificable y pruebas de fallos, sin afirmaciones de atomicidad global.
- Symlinks en Windows → mantener soporte y probar traducción/rutas con fixtures; registrar verificaciones de plataforma no disponibles.
- Este host es Darwin y carece de declaración de sandbox; checkEngineHost lo rechaza → dejar acreditación runtime bloqueada hasta contar con Linux/WSL2, Docker local y configuración declarada; no instalar ni evadir el control.

## Migration Plan

1. Implementar y probar el helper con fixtures antes de integrarlo.
2. Integrar installer y doctor manteniendo gates y documentación acordes.
3. Probar migración de instalaciones anteriores exactas y conservación de modificaciones.
4. Ejecutar gates del repositorio y revisión adversarial requerida por el límite de escritura.
5. Acreditar carga runtime en sandbox compatible; el bloqueo no se convierte en aprobado.
6. Activación global solo mediante solicitud de instalación. Rollback conserva manifiesto y recursos; restaurar únicamente backups propios cuya identidad se verifique, sin borrar datos ajenos ni desactivar reglas de propiedad a ciegas.
