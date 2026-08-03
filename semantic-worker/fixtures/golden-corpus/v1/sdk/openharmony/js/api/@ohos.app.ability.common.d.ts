declare namespace common {
  export interface /*@definition.sdk-system-type.target*/UIAbilityContext {
    filesDir: string;
    terminateSelf(): Promise<void>;
  }
}

export default common;
