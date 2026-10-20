# Reconciliar cambios locales sin descartarlos

Cuando una release se integra desde un checkout aislado, el workspace original puede seguir en una rama anterior con archivos modificados o untracked que ya existen en main. Contar líneas de `git status` no identifica cuánto trabajo nuevo falta.

Desde un checkout actualizado del stack:

```sh
node --import tsx src/git/workspace-reconciliation.ts <workspace-a-revisar> main
```

El comando emite JSON por stdout y no cambia ramas, índice ni archivos. Compara la unión de rutas distintas del baseline y archivos untracked, incluyendo su contenido real. Resuelve primero el commit del baseline; no usa filtros de Git ni ejecuta transformaciones configuradas por el repositorio. Los nombres con espacios y Unicode se procesan mediante salidas NUL de Git.

| Estado | Interpretación |
|---|---|
| matches-baseline | El archivo local ya coincide exactamente con el blob integrado |
| matches-after-eol-normalization | Sólo difieren CRLF/LF en un archivo sin bytes NUL |
| different | Requiere comparar el cambio; puede ser trabajo local o una versión anterior |
| local-only | No existe en el baseline; puede estar en la historia de la rama o ser untracked |
| missing-locally | Existe en el baseline, pero no en el disco local; no prueba una eliminación intencional |
| unsupported-entry | Enlace, submódulo u otro tipo que requiere revisión separada |

No es un merge ni una autorización para restaurar, borrar o sobrescribir. Tampoco certifica seguridad, diseño o funcionalidad de los archivos coincidentes. La comparación de contenido no verifica bits de ejecución. Un filtro LFS u otra transformación requiere revisión propia. Si cambia el status durante la lectura, el comando aborta; la lectura no es un snapshot atómico frente a ediciones simultáneas de un archivo ya modificado.

Antes de cualquier reconciliación que modifique archivos, ejecutar `npm run guard:snapshot`, revisar el diff de cada lote y respetar los permisos de operaciones destructivas. No realizar checkout/reset/clean sobre un workspace con trabajo pendiente para hacer desaparecer diferencias.

Regresión: `tests/unit/workspace-reconciliation.test.ts`, con un repositorio real temporal, archivo untracked ya integrado, texto CRLF/Unicode, contenido binario diferente, archivo nuevo, archivo ausente y referencia inválida. Comprueba que el índice y el contenido del workspace se conservan.
