import type _sodium from "libsodium-wrappers";

export interface ISecretEncryptor {
  encrypt(value: string, publicKeyBase64: string): Promise<string>;
}

export class SodiumEncryptor implements ISecretEncryptor {
  private sodium: typeof _sodium | undefined;
  private initPromise: Promise<void> | null = null;

  private ensureInitialized(): Promise<typeof _sodium> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const sodium = await import("libsodium-wrappers");
          await sodium.default.ready;
          this.sodium = sodium.default;
        } catch (error) {
          /* c8 ignore next 4 -- only fails when libsodium-wrappers is not installed */
          throw new Error(
            "Failed to load libsodium-wrappers. Install it: npm install libsodium-wrappers",
            { cause: error }
          );
        }
      })().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise.then(() => this.sodium!);
  }

  async encrypt(value: string, publicKeyBase64: string): Promise<string> {
    const sodium = await this.ensureInitialized();

    const messageBytes = sodium.from_string(value);
    const publicKey = sodium.from_base64(
      publicKeyBase64,
      sodium.base64_variants.ORIGINAL
    );

    const encrypted = sodium.crypto_box_seal(messageBytes, publicKey);

    return sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
  }
}
