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
    assert.equal(decoded.length, Buffer.byteLength("test-secret-value") + 48);
  });

  test("encrypt produces different output each call (nonce)", async () => {
    const encryptor = new SodiumEncryptor();

    const testKey = Buffer.from(new Uint8Array(32).fill(1)).toString("base64");
    const result1 = await encryptor.encrypt("same-value", testKey);
    const result2 = await encryptor.encrypt("same-value", testKey);

    assert.notEqual(result1, result2);
  });

  test("encrypt throws on invalid public key", async () => {
    const encryptor = new SodiumEncryptor();

    await assert.rejects(
      () => encryptor.encrypt("value", "not-valid-base64!!!"),
      (err: Error) => {
        assert.equal(err instanceof Error, true);
        return true;
      }
    );
  });

  test("after a throwing call, subsequent call retries and can succeed", async () => {
    const encryptor = new SodiumEncryptor();

    // First call fails due to invalid key
    await assert.rejects(() =>
      encryptor.encrypt("value", "not-valid-base64!!!")
    );

    // Second call with valid key succeeds (init was not permanently broken)
    const validKey = Buffer.from(new Uint8Array(32).fill(1)).toString("base64");
    const result = await encryptor.encrypt("test-value", validKey);
    assert.equal(typeof result, "string");
  });

  test("concurrent encrypt calls share initialization", async () => {
    const encryptor = new SodiumEncryptor();
    const testKey = Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

    // Launch two encryptions concurrently — both must succeed
    const [result1, result2] = await Promise.all([
      encryptor.encrypt("value-a", testKey),
      encryptor.encrypt("value-b", testKey),
    ]);

    assert.equal(typeof result1, "string");
    assert.equal(typeof result2, "string");
    // Different plaintexts produce different ciphertexts
    assert.notEqual(result1, result2);
  });
});
