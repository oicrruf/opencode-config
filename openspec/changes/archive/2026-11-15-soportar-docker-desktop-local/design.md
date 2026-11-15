# Design

## Context

Ver proposal.md y el delta docker-test-sandbox. checkEngineHost() decide hoy solo
por process.platform/uname y rechaza Darwin antes de consultar Docker.
checkEngineReachable() solo comprueba una cadena de versión. preflight y start
usan esas funciones; lifecycle, cleanup, recovery y supervisor emiten operaciones
contra el contexto ambiente, sin persistir identidad de daemon.

Evidencia local de esta investigación: cliente Darwin arm64; Docker Desktop
4.90.0; contexto desktop-linux con endpoint Unix local existente; info declara
OSType=linux, OperatingSystem=Docker Desktop y Name=docker-desktop; Engine
29.7.2 responde. Hay una imagen node:20-bookworm linux/arm64 en caché (ID
fbe82d01962ac07e80fb0ebc10c8edd09a4efeb8ecea765f4e13922cb5e862f6).
El OpenCode del host es Mach-O arm64: no es prueba de que exista un binario
Linux compatible dentro de esa imagen. No se iniciaron contenedores de prueba.

## Goals / Non-Goals

**Goals:** admitir únicamente el motor Desktop local verificable, compartir
preflight con start, fijar la identidad durante todo el ciclo y obtener una
ruta honesta para acreditar AT-188 en este equipo.

**Non-Goals:** Windows nativo, Podman/Colima, daemons remotos, instalación de
Docker/VMs, cambios de modelos, descarga de dependencias implícitas o no
versionadas, relajación de aislamiento o limpieza de recursos ajenos. La única
imagen permitida por esta fixture está fijada explícitamente en la decisión 4. No ejecutar producto en el host
para sustituir el sandbox. No modificar la instalación global del operador.

## Decisions

### 1. Inspección de solo lectura y decisión explícita

Añadir una inspección compartida en docker-adapter.mjs que obtenga plataforma,
endpoint efectivo y solo metadatos necesarios del daemon mediante argumentos
estructurados, sin shell. Resolver y probar precedencia de las opciones
soportadas de contexto/entorno; no basta con inspeccionar el contexto nombrado
si DOCKER_HOST u otro override cambia el destino efectivo.

Aceptar endpoints Unix locales verificables. Rechazar transportes de red,
valores vacíos, identificación ambigua, respuestas inválidas y combinaciones
no soportadas antes de crear reserva o captura. En macOS requerir además
identificación positiva de Docker Desktop y Linux containers. Linux/WSL2
mantiene soporte con daemon Linux local; Windows fuera de WSL2 continúa bloqueado.
Un nombre desktop-linux o un version exitoso por sí solos no son evidencia.
No registrar env completo ni errores de conexión sin sanitizar.

Alternativa descartada: permitir cualquier Darwin o inyectar platform=linux;
elimina la comprobación en lugar de acreditar una plataforma soportada.

### 2. Binding persistente y ejecución contra el mismo daemon

Registrar endpoint normalizado, identidad de daemon y metadatos no sensibles
junto a la ejecución. Encapsular el ejecutor Docker para usar explícitamente
ese endpoint y neutralizar overrides ambientales contradictorios. Usar el
mismo binding en build, start, inspect, finish/cancel, cleanup, recover y
supervisor, incluyendo instancias nuevas del proceso coordinador.

Antes de operaciones destructivas, comprobar que el endpoint todavía
identifica al daemon registrado. Ante cambio, ausencia o respuesta incierta,
conservar reserva y evidencia. Los registros anteriores sin binding no se
migran automáticamente con el contexto actual: diagnóstico y reconciliación
explícita. Los IDs, labels y verificación de ausencia siguen siendo necesarios;
el binding no los sustituye.

Alternativa descartada: volver a resolver el contexto actual en cada operación;
podría limpiar en otro motor tras un cambio de contexto o un reinicio.

### 3. Aislamiento y dependencias

Reutilizar los constructores actuales de argumentos y sus tests negativos:
cap-drop/no-new-privileges, límites, red interna, publicaciones loopback,
captura independiente y prohibición de socket/montaje original/host network.
No añadir flags de privilegio para resolver diferencias de Docker Desktop.
El cliente macOS controla un daemon Linux; la evidencia declara esa diferencia
con una ejecución Linux/WSL2 nativa sin afirmar equivalencia de producción.

El control no escribe ni inventa Dockerfiles. La fixture versionada declara su
Dockerfile y la única base autorizada:
`ghcr.io/anomalyco/opencode:2.2.7@sha256:7b1e3139a64121d12e572530974a18b9452967fb4d67516d8cfd9c0e763dd57d`.
Es el índice OCI multiarch oficial; la inspección de registry confirmó Linux/
amd64 y Linux/arm64. El tag coincide con el runtime del host, pero la ejecución
usa el digest inmutable. El preflight exige que esa imagen exacta esté local y
valida ID/plataforma antes de reservar; no descarga nada en ejecución. El operador
autorizó aprovisionar explícitamente esta imagen fijada para la fixture. No se
instalan otros paquetes ni se permiten tags flotantes; no copiar el Mach-O del
host.

### 4. Prueba real de AT-188

Declarar una fixture reproducible basada en la imagen oficial OpenCode v2.2.7
por digest multiarch. Copiar solo los entrypoints y módulos seleccionados de
sandbox-control y worktree-control desde la captura a un HOME/XDG temporal dentro
del sandbox. Configurar exclusivamente plugins locales, sin MCP, proveedores
conectados ni credenciales reales. Arrancar un servidor/sesión local y consultar
la interfaz pública documentada de IDs de herramientas para esta versión; no
inventar endpoints ni usar la respuesta de una factoría invocada manualmente
como evidencia de descubrimiento por OpenCode.

**Compatibility gate discovered during implementation:** both target plugins
currently use the OpenCode V1 named-export/factory API (`export const ... =
async () => ({ tool: ... })`). OpenCode V2 does not load V1 implementations.
This change now includes porting both entrypoints to V2's default-export
`{id, setup(ctx)}` contract and registering the existing tool surface through
`ctx.tool.transform`. Keep the V1 named exports as a compatibility adapter for
existing V1 installations; do not call plugin factories manually in the
fixture. Worktree operations must adapt to the public V2 `ctx.worktree` API and
fail closed if that API is unavailable. Verify V2.2.7 itself in the fixture;
current online docs are guidance, not substitute evidence for that pinned
runtime.

Observar versiones, herramientas de ambos plugins y unicidad; registrar
configuración/render y fingerprint de captura. Inspeccionar las restricciones
del contenedor y preservar logs/resultados fuera antes de limpiar solo los
recursos etiquetados de esta ejecución. Un segundo inicio simultáneo debe
quedar bloqueado. Evidencia sin prueba real no completa AT-188 4.5.

La fixture inicia una sesión OpenCode V2 contra el servidor del mismo
contenedor con un modelo inexistente y sin proveedores ni credenciales. La
petición inicializa la ubicación real y sus plugins antes de que falle la
selección del modelo. El plugin de verificación consulta `ctx.tool.list()`
después de un intervalo para permitir que terminen las activaciones
asíncronas de otros plugins y escribe los IDs en los logs; el host espera el
catálogo completo y lee esa línea con el ejecutor Docker ligado al daemon. La
autenticación de servidor usa un secreto efímero que no se registra. La fixture
no publica puertos y verifica esa ausencia directamente; la red interna no se
expone para consultar el servidor.

## Risks / Trade-offs

- Contextos y overrides cambian el destino → resolver efectivamente, fijar y verificar binding.
- Endpoint Unix no acredita tipo de motor por sí solo → exigir metadatos positivos para macOS y declarar el límite de esa observación local, sin prometer una atestación criptográfica.
- Daemon reiniciado con identidad distinta → preservar bloqueo en vez de limpiar por nombres similares.
- Registros antiguos incompletos → reconciliación explícita, nunca inferencia destructiva.
- Tests stub no prueban Desktop real → usar fixtures para negativos y una ejecución real independiente para acreditación.
- Imagen del runtime no local → permitir únicamente el digest multiarch oficial autorizado y fijado; el preflight vuelve a bloquear si no está disponible localmente.

## Migration Plan

1. Añadir inspección/binding y pruebas de entradas positivas, negativas y cambiantes.
2. Integrar preflight/start/operaciones posteriores y actualizar guía y tests existentes.
3. Ejecutar gates y revisión adversarial final de este nuevo límite de compatibilidad.
4. Aprovisionar solo la imagen OpenCode oficial fijada, preparar la fixture local y ejecutarla mediante sandbox-control; preservar reporte y limpieza verificada.
5. Solo con evidencia suficiente completar AT-188 4.5. Si falta una dependencia, identificarla sin declarar cumplida la entrega.
6. Rollback de soporte nuevo rechaza nuevos inicios macOS; conservar registros y bindings existentes para cierre seguro. Nunca borrar reservas o cambiar al daemon ambiente para forzar rollback.
