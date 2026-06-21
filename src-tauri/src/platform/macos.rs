use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;

const APP_ICON_PNG_BYTES: &[u8] = include_bytes!("../../icons/icon.png");

pub fn apply_app_icon() {
  let icon_data = NSData::with_bytes(APP_ICON_PNG_BYTES);
  let Some(icon_image) = NSImage::initWithData(NSImage::alloc(), &icon_data) else {
    return;
  };

  // Tauri / Tao do not expose a macOS window-icon path because macOS ignores it.
  // For local `tauri dev`, set the Dock app icon directly instead.
  let mtm = unsafe { MainThreadMarker::new_unchecked() };
  let app = NSApplication::sharedApplication(mtm);
  unsafe {
    app.setApplicationIconImage(Some(&icon_image));
  }
}

#[cfg(test)]
mod tests {
  use super::APP_ICON_PNG_BYTES;

  #[test]
  fn embeds_a_png_source_for_the_macos_dock_icon() {
    assert!(APP_ICON_PNG_BYTES.len() > 8);
    assert_eq!(&APP_ICON_PNG_BYTES[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
  }
}
