// Same docs server/editor/build pipeline; one opt-in authoritative room.
process.env.ARENA='1';
await import('./docs/dev.mjs');
