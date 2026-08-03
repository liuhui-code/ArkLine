@Entry
@Component
struct ArkuiProvider {
  build(): void {
    Column()./*@completion.arkui-column.query*/
    Column().width/*@definition.arkui-width.query*/(100)
  }
}
