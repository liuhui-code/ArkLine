#[cfg(target_os = "macos")]
mod macos;

pub fn apply_app_icon() {
    #[cfg(target_os = "macos")]
    macos::apply_app_icon();
}
