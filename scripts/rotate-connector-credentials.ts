import "dotenv/config";
import { Pool } from "pg";

import {
  CredentialDecryptionError,
  decryptCredentialWithKeyInfo,
  encryptCredential,
  primaryCredentialKeyId,
} from "../lib/connectors/credential-keyring";

// Re-encrypts every stored provider credential (AgentConnection) with the
// current PRIMARY key — the bulk step of a key rotation (P0 §10, see
// docs/AEGIS_P0_IMPLEMENTATION.md). Credentials are also re-encrypted lazily
// the next time each connection is used, so running this is about finishing
// a rotation promptly, not about correctness.
//
// Dry run by default (reports what it would do, writes nothing):
//   npx tsx scripts/rotate-connector-credentials.ts
// Apply:
//   npx tsx scripts/rotate-connector-credentials.ts --apply
//
// Before running, configure BOTH the new primary key and every key still
// needed to decrypt existing rows:
//   CONNECTOR_ENCRYPTION_KEYS="new:<key>,old:<key>"   and/or
//   AUTH_SECRET_PREVIOUS="<old AUTH_SECRET>"
// Only after this reports 0 rows left on old keys is it safe to remove an
// old key from configuration.
//
// Never prints credential values or key material. Each UPDATE is
// conditional on the ciphertext being unchanged since it was read, so a
// concurrent reconnect is never overwritten.

const apply = process.argv.includes("--apply");

type Row = {
  id: string;
  credentialCiphertext: string;
  credentialIv: string;
  credentialAuthTag: string;
  credentialKeyId: string | null;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const primary = primaryCredentialKeyId();
  console.log(`Primary key: ${primary}${apply ? "" : "  (dry run — pass --apply to write)"}`);

  const counts = { alreadyPrimary: 0, reencrypted: 0, wouldReencrypt: 0, undecryptable: 0, changedConcurrently: 0 };
  try {
    const { rows } = await pool.query<Row>(
      `SELECT "id", "credentialCiphertext", "credentialIv", "credentialAuthTag", "credentialKeyId"
         FROM "agent_connections"
        WHERE "credentialCiphertext" IS NOT NULL AND "credentialIv" IS NOT NULL AND "credentialAuthTag" IS NOT NULL`
    );

    for (const row of rows) {
      let decrypted;
      try {
        decrypted = decryptCredentialWithKeyInfo({
          ciphertext: row.credentialCiphertext,
          iv: row.credentialIv,
          authTag: row.credentialAuthTag,
          keyId: row.credentialKeyId,
        });
      } catch (error) {
        if (!(error instanceof CredentialDecryptionError)) throw error;
        counts.undecryptable += 1;
        console.warn(`  connection ${row.id}: cannot decrypt (key ${row.credentialKeyId ?? "legacy/AUTH_SECRET"}) — ${error.message}`);
        continue;
      }

      if (!decrypted.needsReencryption) {
        counts.alreadyPrimary += 1;
        continue;
      }
      if (!apply) {
        counts.wouldReencrypt += 1;
        continue;
      }

      const next = encryptCredential(decrypted.plaintext);
      const result = await pool.query(
        `UPDATE "agent_connections"
            SET "credentialCiphertext" = $1, "credentialIv" = $2, "credentialAuthTag" = $3, "credentialKeyId" = $4, "updatedAt" = NOW()
          WHERE "id" = $5 AND "credentialCiphertext" = $6`,
        [next.ciphertext, next.iv, next.authTag, next.keyId, row.id, row.credentialCiphertext]
      );
      if (result.rowCount === 1) counts.reencrypted += 1;
      else counts.changedConcurrently += 1;
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify(counts, null, 2));
  if (counts.undecryptable > 0) {
    console.log("Some credentials could not be decrypted with any configured key. Restore the missing key, or reconnect those agents.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
