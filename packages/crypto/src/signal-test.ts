// Throwaway spike: libsignal-client / Bun N-API smoke test.
//
// This is *not* used by @enclave/crypto production code.
// It exists to quickly validate whether Bun can load the native bindings.
//
// To run (after installing @signalapp/libsignal-client somewhere Bun can resolve):
//   bun run packages/crypto/src/signal-test.ts

type LibsignalModule = {
  PrivateKey: { generate: () => { getPublicKey: () => { seal: (msg: Uint8Array, info: string) => Uint8Array; getPublicKeyBytes: () => Uint8Array }; open: (ciphertext: Uint8Array, info: string) => Uint8Array } };
};

const isLibsignalModule = (value: unknown): value is LibsignalModule => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.PrivateKey === "object" && v.PrivateKey !== null;
};

export const runLibsignalBunSmokeTest = async (): Promise<void> => {
  const moduleName = "@signalapp/libsignal-client";

  // Avoid TS module-resolution errors when the dependency isn't installed.
  const imported: unknown = await import(moduleName);
  if (!isLibsignalModule(imported)) {
    throw new Error(`Unexpected export shape from ${moduleName}`);
  }

  const sk = imported.PrivateKey.generate();
  const pk = sk.getPublicKey();
  const msg = new TextEncoder().encode("bun-smoke-test");
  const ciphertext = pk.seal(msg, "enclave-mail-smoke");
  const opened = sk.open(ciphertext, "enclave-mail-smoke");

  const openedText = new TextDecoder().decode(opened);
  const ok = openedText === "bun-smoke-test";

  if (!ok) {
    throw new Error("libsignal-client smoke test failed: seal/open roundtrip mismatch");
  }

  console.log({ ok, publicKeyBytes: pk.getPublicKeyBytes().length });
};

if (import.meta.main) {
  runLibsignalBunSmokeTest().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
