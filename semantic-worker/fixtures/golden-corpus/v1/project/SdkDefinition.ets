import common from "@ohos.app.ability.common"

function useContext(value: common.UIAbility/*@definition.sdk-system-type.query*/Context): string {
  return value.filesDir
}
