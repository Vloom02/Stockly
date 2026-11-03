// Cifra y firma la parte web para Capgo (lo mismo que hace su CLI con --key): AES-128-CBC con una llave al azar, y
// esa llave y la huella sha256 del zip "firmadas" con la llave privada RSA. Los APK desde 1.2.12 traen la pública
// (capacitor.config.ts) y no instalan nada que no venga firmado así: un release cambiado en GitHub no llega a las tablets.
// Uso: node scripts/cifrar-version.mjs <zip> <salida> <llave-privada.pem>   → imprime session-key y checksum-cifrado.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv, createHash, privateEncrypt, randomBytes, constants } from 'node:crypto';

const [zip, salida, llave] = process.argv.slice(2);
if (!zip || !salida || !llave) {
  console.error('uso: node scripts/cifrar-version.mjs <zip> <salida> <llave-privada.pem>');
  process.exit(1);
}
const privada = readFileSync(llave, 'utf8');
const datos = readFileSync(zip);
const clave = randomBytes(16);
const iv = randomBytes(16);
const c = createCipheriv('aes-128-cbc', clave, iv);
writeFileSync(salida, Buffer.concat([c.update(datos), c.final()]));
const firmar = (buf) => privateEncrypt({ key: privada, padding: constants.RSA_PKCS1_PADDING }, buf);
console.log(`session-key: ${iv.toString('base64')}:${firmar(clave).toString('base64')}`);
console.log(`checksum-cifrado: ${firmar(createHash('sha256').update(datos).digest()).toString('hex')}`);
