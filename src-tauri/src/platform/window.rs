use tauri::WebviewWindowBuilder;

const WEBDRIVER_PORT_ENV: &str = "ARKLINE_WEBDRIVER_PORT";
const DEFAULT_WEBVIEW2_ARGUMENTS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
     --autoplay-policy=no-user-gesture-required";

pub fn create_manual_windows(app: &mut tauri::App) -> tauri::Result<()> {
    let configs = app.config().app.windows.clone();
    for config in configs.iter().filter(|config| !config.create) {
        let builder = WebviewWindowBuilder::from_config(app.handle(), config)?;
        #[cfg(target_os = "windows")]
        let builder = match webdriver_browser_arguments() {
            Some(arguments) => builder.additional_browser_args(&arguments),
            None => builder,
        };
        builder.build()?;
    }
    Ok(())
}

fn webdriver_browser_arguments() -> Option<String> {
    let port = std::env::var(WEBDRIVER_PORT_ENV)
        .ok()?
        .trim()
        .parse::<u16>()
        .ok()?;
    if port == 0 {
        return None;
    }
    Some(format!(
        "{DEFAULT_WEBVIEW2_ARGUMENTS} --remote-debugging-port={port}"
    ))
}

#[cfg(test)]
mod tests {
    use super::{webdriver_browser_arguments, WEBDRIVER_PORT_ENV};
    use std::sync::Mutex;

    static ENVIRONMENT_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn creates_controlled_webdriver_arguments_for_a_valid_port() {
        let _lock = ENVIRONMENT_LOCK.lock().unwrap();
        unsafe { std::env::set_var(WEBDRIVER_PORT_ENV, "9222") };

        let arguments = webdriver_browser_arguments().unwrap();

        assert!(arguments.contains("--disable-features="));
        assert!(arguments.contains("--autoplay-policy=no-user-gesture-required"));
        assert!(arguments.ends_with("--remote-debugging-port=9222"));
        unsafe { std::env::remove_var(WEBDRIVER_PORT_ENV) };
    }

    #[test]
    fn ignores_missing_or_invalid_webdriver_ports() {
        let _lock = ENVIRONMENT_LOCK.lock().unwrap();
        unsafe { std::env::remove_var(WEBDRIVER_PORT_ENV) };
        assert_eq!(webdriver_browser_arguments(), None);

        unsafe { std::env::set_var(WEBDRIVER_PORT_ENV, "not-a-port") };
        assert_eq!(webdriver_browser_arguments(), None);
        unsafe { std::env::remove_var(WEBDRIVER_PORT_ENV) };
    }
}
