import { Box } from "./Barrel"
import type { UserAccount } from "./Barrel"

const accountBox = {} as Box<UserAccount>
accountBox.value./*@completion.generic-member-chain.query*/
