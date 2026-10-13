# Seguridad

Escudo guarda información muy sensible de personas en riesgo. Si encuentras una vulnerabilidad, **no abras un issue público**: usa *Security → Report a vulnerability* en GitHub (aviso privado).

## Modelo de amenazas

**Escudo protege contra:**

- Alguien que toma el celular **bloqueado o con Escudo cerrado** y revisa archivos, la galería o el almacenamiento del navegador: los registros y pruebas están cifrados (AES-GCM 256, clave derivada con PBKDF2-SHA256, 210 000 iteraciones).
- Escrituras a medias: guardar un registro, cambiar la contraseña o restaurar una copia se hace en una sola transacción de IndexedDB (todo o nada).
- Alteraciones de la bitácora: cada registro está encadenado con SHA-256 al anterior y cada prueba tiene su huella. `verify()` detecta cambios, registros borrados o reordenados y archivos dañados.
- Archivos manipulados: las copias y los ZIP se validan (parámetros de cifrado, claves permitidas, tamaño máximo descomprimido de 300 MB, CRC de cada archivo).
- Adivinar la contraseña desde la app: tras 3 intentos fallidos, cada intento espera cada vez más (hasta 30 s). La bitácora se bloquea tras 5 minutos sin uso o 2 minutos en segundo plano, y las pruebas abiertas dejan de ser accesibles al bloquearse.
- Fugas por la red: no hay servidor, la página no carga recursos de terceros y la política de seguridad de contenido (CSP) bloquea conexiones a otros dominios.

**Escudo NO protege contra:**

- Alguien con el celular desbloqueado **mientras Escudo está abierto**.
- Malware o *spyware* instalado en el teléfono.
- Ataques de fuerza bruta contra contraseñas cortas si alguien copia los datos del navegador. Recomendamos frases largas.
- Pérdida de datos si se borra el almacenamiento del navegador o se pierde el celular. Para eso existen las copias de seguridad cifradas.
- Que la persona extorsionadora vea el informe si la víctima lo comparte por un canal inseguro.

**Sobre las huellas:** una huella SHA-256 demuestra que un archivo no cambió desde que se registró en Escudo. No demuestra quién lo envió ni sustituye el peritaje de la Policía o la Fiscalía sobre el dispositivo original.

## Limitaciones conocidas

- El paquete de pruebas (ZIP) no está cifrado: está pensado para entregarse a las autoridades.
- El modo camuflado guarda un indicador y la nota señuelo sin cifrar en el navegador (`localStorage`). Engaña a una mirada rápida, no a un análisis forense.
- La hora de cada registro la da el reloj del teléfono, que la persona puede cambiar.
- Los contactos de confianza del SOS (nombre y número) y la hora límite y el contacto de un trayecto en curso se guardan sin cifrar en `localStorage`, para que la alerta funcione sin contraseña. El destino del trayecto no se guarda; el plan de seguridad y la palabra clave familiar van cifrados en la bóveda. "Borrar todo" también elimina estos datos.
- Escudo no envía mensajes: abre WhatsApp o la app de SMS con el texto listo. Si el celular no tiene saldo, datos o señal, el mensaje no sale; el botón "Llamar al 105" sigue siendo la primera opción en peligro inmediato.
- Los datos personales del escrito de denuncia (nombre, DNI, domicilio, correo) no se guardan: se usan para armar el documento y se borran del formulario al bloquear.
- Los metadatos EXIF se leen del archivo tal como llegó al teléfono de la víctima; Escudo no se conecta a nada para obtenerlos. Pueden haber sido alterados por quien envió la foto: son una pista para la investigación, no una prueba concluyente.
- La ubicación del SOS es la del propio teléfono y solo se pide al pulsar el botón. Puede ser imprecisa en interiores.
