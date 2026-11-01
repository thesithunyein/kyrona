import { loadSharedDesk, readLocalDesk } from "./account-desk";
import { readBalances } from "./chain";
import { useDesk } from "./store";

export async function openAccount(id: string) {
  const local = readLocalDesk(id);
  if (local) useDesk.getState().replaceDesk(local.rules, local.decisions, local.savedAt);
  useDesk.getState().setAccount(id);
  useDesk.getState().setBalances(await readBalances(id));
  const remote = await loadSharedDesk(id).catch(() => null);
  if (remote && remote.savedAt > (useDesk.getState().deskSavedAt || 0)) {
    useDesk.getState().replaceDesk(remote.rules, remote.decisions, remote.savedAt);
  }
}
