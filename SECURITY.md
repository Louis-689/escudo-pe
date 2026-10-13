# Seguridad

Escudo guarda información muy sensible de personas en riesgo. Si encuentras una vulnerabilidad, **no abras un issue público**: usa *Security → Report a vulnerability* en GitHub (aviso privado).

## Modelo de amenazas

**Escudo protege contra:**

- Alguien que toma el celular **bloqueado o con Escudo cerrado** y revisa archivos, la galería o el almacenamiento del navegador: los registros y pruebas están cifrados (AES-GCM 256, clave derivada con PBKDF2-SHA256, 600 000 iteraciones en bóvedas nuevas; las antiguas suben al cambiar la contraseña). La contraseña debe tener al menos 8 caracteres, no puede ser solo un número corto (fecha, DNI, PIN) ni repetir los mismos caracteres.
- Escrituras a medias: guardar un registro, cambiar la contraseña o restaurar una copia se hace en una sola transacción de IndexedDB (todo o nada).
- Alteraciones de la bitácora: cada registro está encadenado con SHA-256 al anterior y cada prueba tiene su huella. `verify()` detecta cambios, registros borrados o reordenados y archivos dañados.
- Archivos manipulados: las copias y los ZIP se validan (parámetros de cifrado, claves permitidas, tamaño máximo descomprimido de 300 MB, CRC de cada archivo).
- Adivinar la contraseña desde la app: tras 5 intentos fallidos, cada intento espera cada vez más (hasta 10 s). Lo que tiene menos caracteres que el mínimo no cuenta como intento (en modo camuflado es una búsqueda normal). La bitácora se bloquea tras 5 minutos sin uso o 2 minutos en segundo plano, y las pruebas abiertas dejan de ser accesibles al bloquearse.
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
- **Contraseña de emergencia:** abre una segunda bitácora cifrada (base de datos `notas`) que está vacía. Quien examine el navegador a fondo puede ver que existen dos bases de datos; quien solo mira la app, no. Con la contraseña de emergencia no se puede leer ni borrar la bitácora real.
- **Borrador al bloquearse:** si la app se bloquea con un registro a medias, se guarda cifrado con la misma clave y se elimina al recuperarlo. No entra en las copias de seguridad.
- **Archivos compartidos:** lo que llega con "Compartir" desde WhatsApp queda en la caché del navegador, sin cifrar, solo hasta que se abre Escudo con la contraseña; entonces se importa y se borra.
- **Registros borrados al final:** quien tenga acceso al almacenamiento podría intentar quitar los últimos registros. Escudo guarda un sello cifrado con el total y la huella final, y detecta archivos de pruebas sin registro; la defensa más fuerte es enviar la huella a un tercero ("Enviar la huella de mi bitácora").
- La app instalada en la pantalla de inicio conserva el nombre y el ícono de Escudo aunque el modo camuflado esté activo.
- Los contactos de confianza del SOS (nombre y número) y la hora límite y el contacto de un trayecto en curso se guardan sin cifrar en `localStorage`, para que la alerta funcione sin contraseña. El destino del trayecto no se guarda; el plan de seguridad y la palabra clave familiar van cifrados en la bóveda. "Borrar todo" también elimina estos datos.
- Escudo no envía mensajes: abre WhatsApp o la app de SMS con el texto listo. Si el celular no tiene saldo, datos o señal, el mensaje no sale; el botón "Llamar al 105" sigue siendo la primera opción en peligro inmediato.
- Los datos personales del escrito de denuncia (nombre, DNI, domicilio, correo) no se guardan: se usan para armar el documento y se borran del formulario al bloquear.
- Los metadatos EXIF se leen del archivo tal como llegó al teléfono de la víctima; Escudo no se conecta a nada para obtenerlos. Pueden haber sido alterados por quien envió la foto: son una pista para la investigación, no una prueba concluyente.
- La ubicación del SOS es la del propio teléfono y solo se pide al pulsar el botón. Puede ser imprecisa en interiores.
