// Genera un HMAC token válido para el Worker qa-velzia.
// Uso: node scripts/gen-hmac.mjs [ttlDays]
//
// El payload queda como base64url(JSON), firmado con HMAC-SHA256(HMAC_SECRET).

import crypto from "node:crypto";

const HMAC_SECRET = "qa_velzia_hmac_2026_05_07_chany_secret_v1";
const ttlDays = parseInt(process.argv[2] || "90", 10);
const exp = Date.now() + ttlDays * 24 * 3600 * 1000;
const payload = { sub: "chany", exp };

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const b64Payload = b64url(JSON.stringify(payload));
const sig = crypto.createHmac("sha256", HMAC_SECRET).update(b64Payload).digest();
const b64Sig = b64url(sig);

const token = `${b64Payload}.${b64Sig}`;
console.log(token);
