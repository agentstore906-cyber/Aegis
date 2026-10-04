import "server-only";

// Provider-credential encryption. The implementation (AES-256-GCM with a
// versioned keyring — see that file's header for the rotation model) lives
// in credential-keyring.ts so the rotation script can share it; app code
// imports from here so the server-only guard stays in place.
export * from "@/lib/connectors/credential-keyring";
