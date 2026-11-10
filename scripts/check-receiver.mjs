// Shows what the receiver check says about an account before anything is paid.
//
//   node scripts/check-receiver.mjs kyawminthat.near            # allow, warn or block, with reasons
//   node scripts/check-receiver.mjs shop.near --pin             # record a contract's code you approve
//
// Settings: KYRONA_RPC, KYRONA_INDEXER (default https://api.nearblocks.io on mainnet, none on a
// local node; "off" turns it off), KYRONA_BLOCKLIST, KYRONA_PINS_FILE (default .kyrona-pins.json).

import { JsonRpcProvider } from "@near-js/providers";
import { EMPTY_CODE, check, describe, pin, readJson } from "./risk/check.mjs";

const RPC = process.env.KYRONA_RPC?.trim() || "https://free.rpc.fastnear.com";
const LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
const INDEXER_SETTING = process.env.KYRONA_INDEXER?.trim();
const INDEXER = INDEXER_SETTING === "off" ? null : INDEXER_SETTING || (LOCAL ? null : "https://api.nearblocks.io");
const BLOCKLIST = process.env.KYRONA_BLOCKLIST?.trim() || new URL("./risk/blocklist.json", import.meta.url);
const PINS = process.env.KYRONA_PINS_FILE?.trim() || new URL("../.kyrona-pins.json", import.meta.url);

const account = process.argv[2]?.trim().toLowerCase();
if (!account || account.startsWith("-")) {
  console.error("Usage: node scripts/check-receiver.mjs <account> [--pin]");
  process.exitCode = 1;
} else {
  const provider = new JsonRpcProvider({ url: RPC });
  const pins = readJson(PINS, {});
  const result = await check(account, {
    viewAccount: (id) => provider.viewAccount(id, { finality: "final" }),
    indexer: INDEXER,
    pins,
    blocklist: readJson(BLOCKLIST, []),
  });
  console.log(`${account}  ${describe(result)}`);
  if (process.argv.includes("--pin")) {
    if (!result.signals.exists || !result.signals.codeHash || result.signals.codeHash === EMPTY_CODE) {
      console.log("Not pinned: only a contract's code can be pinned.");
    } else {
      pin(PINS, pins, account, result.signals.codeHash);
      console.log(`Pinned ${result.signals.codeHash}. A change to this code will now be blocked.`);
    }
  }
  if (result.verdict === "block") process.exitCode = 2;
}
