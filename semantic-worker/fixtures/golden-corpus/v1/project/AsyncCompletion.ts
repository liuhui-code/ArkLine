import { loadAccount } from "./Barrel"

async function loadSettings(): Promise<void> {
  const account = await loadAccount()
  account./*@completion.async-return-receiver.query*/
}

void loadSettings()
