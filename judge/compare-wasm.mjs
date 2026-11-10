// Compares a newly built contract with the one already running on mainnet.
// Mainnet refuses code that imports a host function it does not provide. The new build may import
// what the mainnet build imports, plus host functions NEAR has provided since its first protocol
// versions (callbacks, logs, context); anything newer fails this check. It may only use the wasm
// features the mainnet build uses.
// Usage: node judge/compare-wasm.mjs <old.wasm> <new.wasm>

import { readFileSync } from "node:fs";

function leb(bytes, at) {
  let value = 0;
  let shift = 0;
  for (;;) {
    const byte = bytes[at++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (byte < 0x80) return [value, at];
  }
}

function name(bytes, at) {
  const [length, start] = leb(bytes, at);
  return [new TextDecoder().decode(bytes.subarray(start, start + length)), start + length];
}

function inspect(path) {
  const bytes = readFileSync(path);
  const imports = new Set();
  const features = new Set();
  let at = 8;
  while (at < bytes.length) {
    const id = bytes[at++];
    const [size, start] = leb(bytes, at);
    const end = start + size;
    if (id === 2) {
      let [count, p] = leb(bytes, start);
      for (let i = 0; i < count; i++) {
        let module, field;
        [module, p] = name(bytes, p);
        [field, p] = name(bytes, p);
        const kind = bytes[p++];
        imports.add(`${module}.${field}`);
        if (kind === 0) [, p] = leb(bytes, p);
        else if (kind === 1) { p += 1; const flags = bytes[p++]; [, p] = leb(bytes, p); if (flags & 1) [, p] = leb(bytes, p); }
        else if (kind === 2) { const flags = bytes[p++]; [, p] = leb(bytes, p); if (flags & 1) [, p] = leb(bytes, p); }
        else if (kind === 3) p += 2;
        else throw new Error(`Unknown import kind ${kind} in ${path}`);
      }
    } else if (id === 0) {
      const [section, p0] = name(bytes, start);
      if (section === "target_features") {
        let [count, p] = leb(bytes, p0);
        for (let i = 0; i < count; i++) {
          const prefix = String.fromCharCode(bytes[p++]);
          let feature;
          [feature, p] = name(bytes, p);
          if (prefix === "+") features.add(feature);
        }
      }
    }
    at = end;
  }
  return { imports, features, size: bytes.length };
}

// Host functions NEAR has provided since its early protocol versions.
const LONG_STANDING = new Set([
  "read_register", "register_len", "write_register", "current_account_id", "signer_account_id",
  "signer_account_pk", "predecessor_account_id", "input", "block_index", "block_timestamp",
  "epoch_height", "storage_usage", "account_balance", "account_locked_balance", "attached_deposit",
  "prepaid_gas", "used_gas", "random_seed", "sha256", "keccak256", "keccak512", "value_return",
  "panic", "panic_utf8", "log_utf8", "log_utf16", "abort", "promise_create", "promise_then",
  "promise_and", "promise_batch_create", "promise_batch_then", "promise_batch_action_create_account",
  "promise_batch_action_deploy_contract", "promise_batch_action_function_call",
  "promise_batch_action_transfer", "promise_batch_action_stake",
  "promise_batch_action_add_key_with_full_access", "promise_batch_action_add_key_with_function_call",
  "promise_batch_action_delete_key", "promise_batch_action_delete_account", "promise_results_count",
  "promise_result", "promise_return", "storage_write", "storage_read", "storage_remove",
  "storage_has_key", "validator_stake", "validator_total_stake",
].map((f) => `env.${f}`));

const report = (text) => {
  console.log(text);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Contract build check::${text}`);
};

const [oldPath, newPath] = process.argv.slice(2);
const before = inspect(oldPath);
const after = inspect(newPath);
const added = [...after.imports].filter((x) => !before.imports.has(x));
const newImports = added.filter((x) => !LONG_STANDING.has(x));
const newFeatures = [...after.features].filter((x) => !before.features.has(x));

console.log(`old: ${before.size} bytes, ${before.imports.size} host imports`);
console.log(`new: ${after.size} bytes, ${after.imports.size} host imports`);
if (added.length) {
  console.log(`also imports: ${added.join(", ")}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Contract build check::${after.size} bytes; also imports ${added.join(", ")}`);
}
if (newImports.length) report(`imports host functions that may be newer than mainnet: ${newImports.join(", ")}`);
if (newFeatures.length) report(`uses wasm features the mainnet build does not: ${newFeatures.join(", ")}`);
if (newImports.length || newFeatures.length) process.exit(1);
console.log("The new build imports no host function newer than mainnet and uses no new wasm feature.");
