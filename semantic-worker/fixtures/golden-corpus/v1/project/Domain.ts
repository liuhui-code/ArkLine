export interface /*@definition.reexported-import-alias.target*/Account {
  accountName: string
  save(): void
}

export class Box<T> {
  value!: T
}

export async function loadAccount(): Promise<Account> {
  return { accountName: "Ada", save() {} }
}
