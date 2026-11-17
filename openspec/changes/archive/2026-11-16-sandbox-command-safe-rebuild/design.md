# Design

## Context

Ver motivación y alcance en `proposal.md`. Se inspeccionaron el destino en `f0b4929`, los dos contratos actuales y la referencia CEREBR4L en `79e679ad394ce0cce69cf36607228936feeca3fb`.

`index.js` expone start/status/finish/cancel/recover, preflight y supervisor. El adaptador V2 verifica sesión, directorio y proyecto, pero el arranque no pasa `sessionID` al ciclo de vida. `startSandbox` lee la configuración desde `worktreePath`; preflight la lee desde el directorio de sesión. Los archivos de estado se anclan al Git common dir. Esto distingue correctamente cuota común de fuente de captura, pero aún falta verificar su correspondencia.

`acquireReservation` usa creación exclusiva y guarda un verificador salado del token. No hay una transición exclusiva que cubra cierre y nuevo arranque. `finishSandbox` puede devolver `ok: true` con cleanup fallido: el reemplazo debe comprobar cierre y reserva explícitamente. El cierre preserva reporte y verifica captura antes de borrar su registro de recuperación. Estos controles se conservan.

La referencia ofrece build/rebuild/transfer y una reserva de reemplazo, pero sus APIs/almacenamiento no son compatibles directamente. Sus pruebas estáticas del Markdown tampoco demuestran por sí solas ausencia de llamadas en una sesión real.

## Goals / Non-Goals

**Goals:** separar checkout de estado común; asegurar continuidad de cuota y exclusión entre procesos; permitir transferencia explícita sin exportar capacidades antiguas; conservar recuperación verificable tras cada fase persistida.

**Non-Goals:** apropiarse de una aplicación manual, cambiar de trabajo o checkout silenciosamente, migrar sesiones de conversación, administrar credenciales MCP, cambiar modelos, provisionar runtime o dependencias, publicar o cerrar AT-200.

## Decisions

### 1. Sintaxis estricta y dos capas de validación

`docs/contracts/sandbox-command.md` documentará únicamente:

| Entrada | Resultado |
| --- | --- |
| `/sandbox` o `/sandbox help` | Ayuda sin herramientas |
| `/sandbox build <config.json>` | `sandbox_build` |
| `/sandbox rebuild <config.json>` | `sandbox_rebuild` |
| `/sandbox transfer <config.json>` | `sandbox_transfer` |

Un operando obligatorio, relativo al checkout; permitir comillas simples o dobles equilibradas para espacios, sin expansión de variables, glob, sustitución o shell. Rechazar operación desconocida, operandos extra, opciones y comillas incompletas. El plugin registra un executor nativo mediante `ctx.command.transform` y `editor.add({name, execute})`: invoca el parser puro antes de cualquier prompt o herramienta, y devuelve ayuda/errores con `ctx.session.synthetic` sin requerir un modelo. Para entradas válidas, aplica `ctx.permission.assert` con la acción sandbox correspondiente y ejecuta el mismo controlador que las herramientas. Las herramientas validan campos y permisos antes de resolver origen o mutar estado. El Markdown queda como referencia de distribución, sin sustituir el executor. La prueba runtime usa `ctx.session.command` y contadores de hooks de herramienta/modelo para acreditar rechazo sin llamadas. No utilizar hooks V1 como evidencia V2. API primaria consultada: https://opencode.ai/docs/build/plugins/server (Commands, Permissions y Sessions); el pin real se verifica en la fixture.

Las tres herramientas reciben una ruta de configuración; no reciben sesión, token anterior ni checkout alternativo como autoridad del llamador. Se mantienen los nombres y campos de las herramientas existentes. Se reutilizan los permisos `sandbox_*` de agentes autorizados; el comando no incorpora un override de modelo.

### 2. Origen verificado y configuración explícita

Resolver el toplevel real de Git desde `context.directory`, verificar su pertenencia al proyecto V2 y contrastar el checkout con inventario administrado y listing público de worktrees. Para el comando se requiere una identidad única de trabajo verificada en ese inventario; un checkout sin ella devuelve bloqueo explicativo. No inferirla del nombre de rama ni de una ruta. Un subdirectorio se normaliza a su mismo toplevel; nunca al checkout principal por usar el common dir.

Leer el JSON explícito dentro de ese checkout, comprobar escapes y symlinks con los mismos límites del lector actual y resolver dockerfile/context respecto al toplevel, no al directorio del JSON. Mantener las ubicaciones por defecto para consumidores antiguos. Por decisión del operador, el JSON seleccionado permanece fuera de la captura: registrar externamente ruta relativa, huella de sus bytes y parámetros permitidos sin secretos. Verificar que su huella no cambió entre validación y final de captura; nunca copiar el JSON protegido ni permitir que include anule su exclusión. La evidencia omite valores de testSecrets, URLs de dependencias y campos libres que puedan contener credenciales. Un cambio de fuente/configuración durante la operación bloquea, no produce una combinación de dos checkouts.

Propagar la sesión verificada a los arranques existentes y nuevos. Estado/cuota/reportes siguen bajo el proyecto común; registro y reporte identifican el checkout que realmente se probó. Alternativa rechazada: usar la raíz común también como fuente, que podría probar otro trabajo.

La lectura segura reutiliza los descriptores relativos/no-follow del helper Python ya distribuido con worktree-control; un helper acotado devuelve los bytes únicamente por un pipe privado a Node. No se pasan contenidos por argv ni se imprimen errores crudos. Si Python o las capacidades de filesystem faltan, la lectura bloquea sin instalar paquetes. Se descarta lstat seguido de open por ruta, que permite sustituir un ancestro entre ambas operaciones.

El executor nativo registra la respuesta con `session.synthetic` usando `delivery: "queue"` y `resume: false`: no despierta al agente por ayuda, error o resultado de control. La fixture observa la respuesta durable en contexto o inbox, no presupone que ya se haya incorporado al historial de un agente idle. La referencia Markdown vive en `docs/contracts/`; no se instala una plantilla de comando con el mismo nombre que pueda eclipsar el executor.

### 3. Transición exclusiva y persistida por proyecto

Agregar exclusión entre procesos, con creación exclusiva de un registro de operación, identidad del dueño del bloqueo y generación de reserva. Un bloqueo no se roba por edad. Mantener un journal recuperable con operación, fase, ejecución anterior, sucesora, sesión y generación, sin tokens en claro.

Todas las rutas que mutan reserva/recursos —incluidas herramientas antiguas, aplicación manual y supervisor— deben respetar esta exclusión y verificar generación e identidad inmediatamente antes de mutar. Los helpers internos reutilizan una autorización de operación privada sin adquirir recursivamente el bloqueo. Una operación competidora devuelve ocupado/bloqueado; no espera indefinidamente ni reintenta automáticamente.

Rebuild exige sandbox activo del mismo trabajo, checkout y sesión. Build exige cuota libre. Transfer explícito permite otra sesión del mismo proyecto/trabajo: con sandbox activo reemplaza; con cuota libre construye; con reserva manual, otro trabajo o estado no verificable bloquea. Una reserva sin ejecución verificable no se considera libre.

Orden de reemplazo:

1. Validar entrada, origen/configuración, prerrequisitos nuevos y autorización antes de destruir el anterior.
2. Bajo exclusión, verificar reserva sandbox, ejecución, sesión, generación, motor fijado, recursos atribuibles y ausencia de operaciones en vuelo; persistir intención manteniendo cuota ocupada.
3. Preservar reporte de la ejecución anterior fuera del entorno, con razón de reemplazo/transferencia y resultado realmente conocido; usar `not executed` cuando no hay prueba realizada.
4. Cerrar únicamente recursos propios, verificar ausencia de contenedor/red/imagen/volúmenes/captura/secretos y detener o invalidar el supervisor anterior. No inferir cierre de un `ok` general.
5. Sin liberar cuota, cambiar atómicamente a identidad sucesora y nueva generación; construir una captura nueva mediante el ciclo existente, todavía bajo exclusión. Publicar capacidad al nuevo dueño únicamente cuando la transición persistida sea coherente.
6. Liberar el bloqueo de operación cuando la fase durable permita recuperación. La cuota queda con la ejecución nueva; si el arranque falla se aplica cierre verificable, con reserva conservada ante cualquier incertidumbre.

Fallo de reporte/cierre mantiene la reserva anterior o de transición y no inicia sucesora. Un fallo posterior a cierre conserva journal, evidencia y estado de la sucesora: nunca resucita recursos anteriores ni anuncia éxito. Recuperar requiere revalidar fase e identidades y solo reanuda cierre; nunca arranca automáticamente otra prueba. Una operación abandonada sin identidad verificable permanece bloqueada. Alternativa rechazada: finish + start públicos consecutivos, que libera cuota entre ambas llamadas.

### 4. Transferencia como autorización acotada, no como filtración de token

El comando transfer es la solicitud explícita del operador en una sesión obtenida por la API V2, sujeta a los permisos actuales. La herramienta verifica proyecto/trabajo/checkout y la relación exacta reserva-ejecución, y reclama una nueva generación bajo exclusión. No acepta un `sessionId` escrito por el llamador como prueba. Bloquea ante operaciones activas o propiedad ambigua; no requiere la muerte de una sesión inactiva y verificable para un traspaso explícito.

El control obtiene autoridad interna acotada a la transición y rota el verificador; no recupera ni persiste el token antiguo en claro. Solo la nueva sesión recibe su nueva capacidad. Capacidades anteriores y supervisores con generación antigua quedan invalidados para actuar sobre la sucesora. Los cierres ordinarios siguen requiriendo token, ahora ligado además al executionId/generación exactos. La excepción se especifica en `local-execution-reservation`; no se extiende a `reservation_stop` de aplicaciones manuales.

Una interrupción antes de entregar la capacidad se recupera por la transición verificada, sin pedir el token de otra sesión ni escribirlo a reportes. Se registran identidades y fases, no capacidades. Alternativa rechazada: desactivar verificación de token globalmente o copiar tokens de sesiones.

La recuperación explícita también admite `running` cuando se verificó que la operación anterior terminó o la sesión solicitante es la propietaria registrada: esa fase puede haberse persistido antes de entregar el token. Para cerrar se conserva el registro mientras se eliminan recursos/secretos y se persiste el estado terminal atómicamente antes de liberar cuota. Un provisional ya cerrado se revalida con su reporte y ausencia de recursos si falló la publicación del journal; el reintento no reconstruye.

## Risks / Trade-offs

- [Carrera entre herramientas antiguas, supervisor y transferencia] → exclusión común, generación y pruebas con procesos separados y barreras en cada transición; no basta un mutex en memoria.
- [Registros antiguos sin sesión/origen/generación] → status legible, cierre conservador por la ruta compatible y bloqueo de reemplazo/transferencia hasta reconciliación explícita; no completar identidades por conjetura.
- [Fallo entre escritura de reserva y journal] → fases recuperables, escrituras atómicas, validación cruzada y fallo cerrado; nunca convertir una inconsistencia en cuota libre.
- [Symlink o configuración cambiante] → resolver límites reales y validar huellas de los bytes usados/capturados; probar checkout principal y worktree con declaraciones distintas.
- [Regresión a un comando guiado por modelo] → executor nativo obligatorio, parser anterior al despacho y evidencia de sesión real sin modelo; ese criterio no pasa con regex únicamente.
- [Disponibilidad de runtime] → ejecutar el fixture mediante sandbox-control con imagen/binario ya preparados; ausencia bloquea, sin aplicar la excepción histórica de aprovisionamiento de AT-188 a este issue.

## Migration Plan

1. Reconciliar la base limpia con el commit pendiente de `origin/main` antes de apply, preservando el adaptador V2 compartido. Verificar el estado actual de AT-188; su relación en Linear no prueba por sí sola un bloqueo técnico vigente.
2. Implementar y validar en el repositorio. Versionar registros nuevos, leer registros antiguos sin reescritura oportunista y rechazar transiciones que no se puedan verificar.
3. Ejecutar tests unitarios/concurrencia/V2 y gates de ambos perfiles. Para comportamiento runtime, usar solo sandbox-control y el fixture declarado; conservar reporte de lo efectivamente observado. Revisión adversarial obligatoria del diff final por cambios de autorización, concurrencia y cierre destructivo.
4. Activación posterior mediante `./install.sh --profile <seleccionado>`, sesión nueva y `bash ./install.sh --check`; la propuesta no ejecuta instalación ni modifica el estado global.
5. Rollback: detener nuevas transferencias, cerrar o recuperar ejecuciones nuevas con la versión que entiende sus registros y preservar reportes. No borrar reservas/journals para activar una versión antigua. Reinstalar versión anterior solo tras verificar ausencia de recursos/transiciones incompatibles; ante duda conservar la versión capaz de recuperar y reportar el bloqueo.
