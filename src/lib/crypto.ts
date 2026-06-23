const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const asArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const deriveKey = async (password: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asArrayBuffer(salt),
      iterations: 250000,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export interface EncryptedPayload {
  schema: "my-investment-journal.encrypted.v1";
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: 250000;
  salt: string;
  iv: string;
  ciphertext: string;
  encryptedAt: string;
}

export const encryptJson = async (value: unknown, password: string): Promise<EncryptedPayload> => {
  if (!password) throw new Error("백업 비밀번호가 필요합니다.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(iv) },
    key,
    encoder.encode(JSON.stringify(value))
  );
  return {
    schema: "my-investment-journal.encrypted.v1",
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 250000,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    encryptedAt: new Date().toISOString()
  };
};

export const decryptJson = async <T>(payload: EncryptedPayload, password: string): Promise<T> => {
  if (payload.schema !== "my-investment-journal.encrypted.v1") {
    throw new Error("지원하지 않는 암호화 파일입니다.");
  }
  const key = await deriveKey(password, fromBase64(payload.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(fromBase64(payload.iv)) },
    key,
    fromBase64(payload.ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
};
