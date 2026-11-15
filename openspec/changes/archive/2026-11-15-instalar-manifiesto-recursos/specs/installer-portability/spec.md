# Spec Delta

## ADDED Requirements

### Requirement: Installer exposes a non-mutating check mode and an idempotency report

El instalador SHALL aceptar --check junto a --profile y conservar las cuatro invocaciones por shell existentes. SHALL documentar los resultados: 0 sincronizado, 1 diferencias/conflictos y 2 argumentos/estado inválido/error operativo. El modo check SHALL usar el perfil registrado si no recibe uno explícito y SHALL NOT crear temporales, instalar fuentes, ejecutar reparaciones o invocar gates con escrituras. La instalación sin --profile SHALL conservar defaultProfile y su resumen de gates, identificando omisiones.

#### Scenario: Comprobación sincronizada
- **WHEN** el operador ejecuta bash ./install.sh --check con instalación y manifiesto válidos sin diferencias
- **THEN** SHALL informar sincronización y salir 0 sin modificar archivos o mtimes

#### Scenario: Comprobación con diferencias
- **WHEN** hay recursos faltantes, root distinto o recursos conservados pendientes
- **THEN** SHALL informar cada diferencia y salir 1 sin mutaciones

#### Scenario: Comprobación con perfil registrado
- **WHEN** se comprueba sin --profile una instalación que registra work
- **THEN** SHALL comprobar work sin sustituirlo por defaultProfile

#### Scenario: Argumento o estado inválido
- **WHEN** el argumento es desconocido, el perfil no existe o el manifiesto es inválido
- **THEN** SHALL salir 2 con explicación y sin modificar la instalación

#### Scenario: Ayuda compatible
- **WHEN** el operador consulta --help
- **THEN** SHALL documentar --check, --profile, códigos de salida y las cuatro shells soportadas
