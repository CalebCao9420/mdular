use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MENU_SHOW: &str = "tray-show";
const MENU_HIDE: &str = "tray-hide";
const MENU_ABOUT: &str = "tray-about";
const MENU_UPDATE: &str = "tray-update";
const MENU_OPEN_INSTALL: &str = "tray-open-install";
const MENU_QUIT: &str = "tray-quit";

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_name = app.package_info().name.clone();
    let show_i = MenuItem::with_id(app, MENU_SHOW, "显示主窗口", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, MENU_HIDE, "隐藏到托盘", true, None::<&str>)?;
    let about_i = MenuItem::with_id(
        app,
        MENU_ABOUT,
        format!("关于 {app_name}"),
        true,
        None::<&str>,
    )?;
    let update_i = MenuItem::with_id(app, MENU_UPDATE, "检查更新", true, None::<&str>)?;
    let open_install_i =
        MenuItem::with_id(app, MENU_OPEN_INSTALL, "打开安装目录", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_i,
            &hide_i,
            &sep1,
            &about_i,
            &update_i,
            &open_install_i,
            &sep2,
            &quit_i,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("missing default window icon for tray")?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip(app_name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_HIDE => hide_main_window(app),
            MENU_ABOUT => show_about(app),
            MENU_UPDATE => crate::updater::check_updates_from_tray(app),
            MENU_OPEN_INSTALL => open_install_dir(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

fn show_about(app: &AppHandle) {
    let package_info = app.package_info();
    let app_name = &package_info.name;
    let version = &package_info.version;
    let message = format!("{app_name}\n版本 {version}\n\n模块化、本地优先的 Markdown 编辑器。");
    app.dialog()
        .message(message)
        .title(format!("关于 {app_name}"))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

fn open_install_dir(app: &AppHandle) {
    let path = match std::env::current_exe() {
        Ok(exe) => match exe.parent() {
            Some(dir) => dir.to_path_buf(),
            None => {
                show_error(app, "无法解析安装目录。");
                return;
            }
        },
        Err(err) => {
            show_error(app, &format!("无法定位程序路径：\n{err}"));
            return;
        }
    };

    if let Err(err) = open_path_in_file_manager(&path) {
        show_error(app, &format!("无法打开安装目录：\n{err}"));
    }
}

fn open_path_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = path;
        Err("unsupported platform".into())
    }
}

fn show_error(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .title(app.package_info().name.clone())
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}
