import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SodiumEncryptor } from "../../../src/secrets/encryption.js";

describe("SodiumEncryptor", () => {
  test("encrypt returns base64 string", async () => {
    const encryptor = new SodiumEncryptor();

    const testKey = Buffer.from(new Uint8Array(32).fill(1)).toString("base64");
    const result = await encryptor.encrypt("test-secret-value", testKey);

    assert.equal(typeof result, "string");
    assert.doesNotThrow(() => Buffer.from(result, "base64"));
    const decoded = Buffer.from(result, "base64");
    assert.ok(decoded.length > 48);
  });

  test("encrypt produces different output each call (nonce)", async () => {
    const encryptor = new SodiumEncryptor();

    const testKey = Buffer.from(new Uint8Array(32).fill(1)).toString("base64");
    const result1 = await encryptor.encrypt("same-value", testKey);
    const result2 = await encryptor.encrypt("same-value", testKey);

    assert.notEqual(result1, result2);
  });
});
