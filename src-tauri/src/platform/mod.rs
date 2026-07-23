#[cfg(target_os = "macos")]
mod macos;
mod window;

pub fn apply_app_icon() {
    #[cfg(target_os = "macos")]
    macos::apply_app_icon();
}

pub use window::create_manual_windows;
