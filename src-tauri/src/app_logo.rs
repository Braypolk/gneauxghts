use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogoTheme {
    Light,
    Dark,
}

fn icon_bytes(theme: LogoTheme) -> &'static [u8] {
    match theme {
        LogoTheme::Light => include_bytes!("../icons/icon.png"),
        LogoTheme::Dark => include_bytes!("../icons/icon-dark.png"),
    }
}

#[tauri::command]
pub fn get_system_logo_theme() -> Option<LogoTheme> {
    #[cfg(target_os = "macos")]
    return Some(macos::system_theme());
    #[cfg(not(target_os = "macos"))]
    None
}

#[tauri::command]
pub async fn set_app_logo(app: tauri::AppHandle, theme: LogoTheme) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(apply(&handle, theme));
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

fn apply<R: tauri::Runtime>(_app: &tauri::AppHandle<R>, theme: LogoTheme) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return macos::apply(theme);
    #[cfg(any(windows, target_os = "linux"))]
    {
        use tauri::Manager;
        let image = image::load_from_memory(icon_bytes(theme))
            .map_err(|error| error.to_string())?
            .into_rgba8();
        let (width, height) = image.dimensions();
        let icon = tauri::image::Image::new_owned(image.into_raw(), width, height);
        for window in _app.webview_windows().values() {
            window
                .set_icon(icon.clone())
                .map_err(|error| error.to_string())?;
        }
    }
    // Mobile launchers own Home Screen icon appearance through the asset catalog.
    #[cfg(mobile)]
    let _ = theme;
    #[cfg(not(target_os = "macos"))]
    Ok(())
}

pub fn initialize<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    macos::observe_system_theme(_app)?;
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{icon_bytes, LogoTheme};
    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::ProtocolObject, AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{
        ns_string, NSData, NSDistributedNotificationCenter, NSNotification, NSObjectProtocol,
        NSUserDefaults,
    };
    use std::{cell::RefCell, ptr::NonNull};
    use tauri::Emitter;

    struct Observer(Retained<ProtocolObject<dyn NSObjectProtocol>>);
    impl Drop for Observer {
        fn drop(&mut self) {
            let observer: &objc2::runtime::AnyObject = (*self.0).as_ref();
            // SAFETY: this token came from this center and is removed on the main thread.
            unsafe { NSDistributedNotificationCenter::defaultCenter().removeObserver(observer) };
        }
    }
    thread_local! {
        static OBSERVER: RefCell<Option<Observer>> = const { RefCell::new(None) };
    }

    pub fn system_theme() -> LogoTheme {
        let style =
            NSUserDefaults::standardUserDefaults().stringForKey(ns_string!("AppleInterfaceStyle"));
        if style.is_some_and(|style| style.to_string() == "Dark") {
            LogoTheme::Dark
        } else {
            LogoTheme::Light
        }
    }

    pub fn apply(theme: LogoTheme) -> Result<(), String> {
        let main = MainThreadMarker::new().ok_or("App icon must be updated on the main thread")?;
        let data = NSData::with_bytes(icon_bytes(theme));
        let image =
            NSImage::initWithData(NSImage::alloc(), &data).ok_or("Cannot decode app logo")?;
        // SAFETY: the image is valid and AppKit is called on the main thread.
        unsafe { NSApplication::sharedApplication(main).setApplicationIconImage(Some(&image)) };
        Ok(())
    }

    pub fn observe_system_theme<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
    ) -> Result<(), String> {
        MainThreadMarker::new()
            .ok_or("System appearance observer must start on the main thread")?;
        let app = app.clone();
        let callback = RcBlock::new(move |_: NonNull<NSNotification>| {
            if let Err(error) = app.emit("app://system-logo-theme-changed", system_theme()) {
                eprintln!("System logo appearance notification failed: {error}");
            }
        });
        // SAFETY: the callback captures a thread-safe AppHandle; the center retains it.
        let token = unsafe {
            NSDistributedNotificationCenter::defaultCenter()
                .addObserverForName_object_queue_usingBlock(
                    Some(ns_string!("AppleInterfaceThemeChangedNotification")),
                    None,
                    None,
                    &callback,
                )
        };
        OBSERVER.with(|observer| *observer.borrow_mut() = Some(Observer(token)));
        Ok(())
    }
}
