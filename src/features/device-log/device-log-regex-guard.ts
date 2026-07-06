export const DEVICE_LOG_RENDER_REGEX_INPUT_LIMIT = 4_096;

export function canRunDeviceLogRenderRegex(value: string) {
  return value.length <= DEVICE_LOG_RENDER_REGEX_INPUT_LIMIT;
}
