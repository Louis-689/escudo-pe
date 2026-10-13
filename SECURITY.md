# Seguridad

Escudo guarda información muy sensible de personas en riesgo. Si encuentras una vulnerabilidad, **no abras un issue público**: usa *Security → Report a vulnerability* en GitHub (aviso privado).

## Modelo de amenazas

**Escudo protege contra:**

- Alguien que toma el celular **bloqueado o con Escudo cerrado** y revisa archivos, la galería o el almacenamiento del navegador: los registros y pruebas están cifrados (AES-GCM 256, clave derivada con PBKDF2-SHA256, 210 000 iteraciones).
- Alteraciones de la bitácora: cada registro está encadenado con SHA-256 al anterior y cada prueba tiene su huella. `verify()` detecta cambios, registros borrados o reordenados y archivos dañados.
- Fugas por la red: no hay servidor, la página no carga recursos de terceros y la política de seguridad de contenido (CSP) bloquea conexiones a otros dominios.

**Escudo NO protege contra:**

- Alguien con el celular desbloqueado **mientras Escudo está abierto**.
- Malware o *spyware* instalado en el teléfono.
- Ataques de fuerza bruta contra contraseñas cortas si alguien copia los datos del navegador. Recomendamos frases largas.
- Pérdida de datos si se borra el almacenamiento del navegador o se pierde el celular. Para eso existen las copias de seguridad cifradas.
- Que la persona extorsionadora vea el informe si la víctima lo comparte por un canal inseguro.

**Sobre las huellas:** una huella SHA-256 demuestra que un archivo no cambió desde que se registró en Escudo. No demuestra quién lo envió ni sustituye el peritaje de la Policía o la Fiscalía sobre el dispositivo original.

## Limitaciones conocidas

- El cambio de contraseña vuelve a cifrar todo en varios pasos. Si se interrumpe a la mitad, algunos archivos podrían quedar inaccesibles. La app recomienda descargar una copia antes.
- La hora de cada registro la da el reloj del teléfono, que la persona puede cambiar.
