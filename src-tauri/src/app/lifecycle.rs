use crate::{chat::ChatService, index::AppState, vault_watcher::VaultWatcherHandle};
use serde::Serialize;
use std::sync::{Condvar, Mutex};
use tauri::Manager;

#[cfg(test)]
static BEFORE_TERMINAL_RESTART: Mutex<Option<Box<dyn FnOnce() + Send>>> = Mutex::new(None);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareRestartReceipt {
    pub(crate) status: &'static str,
    pub(crate) ready: bool,
    pub(crate) timeline_portable: bool,
    pub(crate) can_resume: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

impl PrepareRestartReceipt {
    pub(crate) fn ready() -> Self {
        Self {
            status: "ready",
            ready: true,
            timeline_portable: true,
            can_resume: false,
            error: None,
        }
    }

    fn failed(error: String, timeline_portable: bool, can_resume: bool) -> Self {
        Self {
            status: "failed",
            ready: false,
            timeline_portable,
            can_resume,
            error: Some(error),
        }
    }
}

#[derive(Default)]
struct RestartState {
    preparing: bool,
    ready: bool,
    attempt: u64,
    completed_attempt: u64,
    result: Option<PrepareRestartReceipt>,
    #[cfg(test)]
    joiners: usize,
}

/// Sole backend owner for releasing one running vault before process restart.
/// Its public surface is deliberately one joining operation plus watcher
/// installation, which is private composition bookkeeping.
pub(crate) struct AppLifecycle {
    restart: Mutex<RestartState>,
    settled: Condvar,
    watcher: Mutex<Option<VaultWatcherHandle>>,
}

impl AppLifecycle {
    pub(crate) fn new() -> Self {
        Self {
            restart: Mutex::new(RestartState::default()),
            settled: Condvar::new(),
            watcher: Mutex::new(None),
        }
    }

    pub(crate) fn install_watcher(&self, mut watcher: VaultWatcherHandle) {
        // Keep the restart gate held until the watcher is installed. Otherwise
        // preparation could observe an empty slot between this check and the
        // installation, then a late watcher would outlive the ready receipt.
        let Ok(restart) = self.restart.lock() else {
            let _ = watcher.stop_and_join();
            return;
        };
        if restart.preparing || restart.ready {
            drop(restart);
            let _ = watcher.stop_and_join();
            return;
        }
        match self.watcher.lock() {
            Ok(mut current) => *current = Some(watcher),
            Err(_) => {
                drop(restart);
                let _ = watcher.stop_and_join();
            }
        }
    }

    pub(crate) fn is_ready(&self) -> bool {
        self.restart
            .lock()
            .map(|state| state.ready)
            .unwrap_or(false)
    }

    pub(crate) fn prepare_restart<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
    ) -> PrepareRestartReceipt {
        let attempt = {
            let mut state = match self.restart.lock() {
                Ok(state) => state,
                Err(_) => {
                    return PrepareRestartReceipt::failed(
                        "Application restart lifecycle lock poisoned".to_string(),
                        false,
                        false,
                    )
                }
            };
            if state.ready {
                return state
                    .result
                    .clone()
                    .unwrap_or_else(PrepareRestartReceipt::ready);
            }
            if state.preparing {
                let joined_attempt = state.attempt;
                #[cfg(test)]
                {
                    state.joiners += 1;
                    self.settled.notify_all();
                }
                while state.preparing && state.attempt == joined_attempt {
                    state = match self.settled.wait(state) {
                        Ok(state) => state,
                        Err(_) => {
                            return PrepareRestartReceipt::failed(
                                "Application restart lifecycle lock poisoned".to_string(),
                                false,
                                false,
                            )
                        }
                    };
                }
                #[cfg(test)]
                {
                    state.joiners = state.joiners.saturating_sub(1);
                }
                if state.completed_attempt == joined_attempt {
                    return state.result.clone().unwrap_or_else(|| {
                        PrepareRestartReceipt::failed(
                            "Restart preparation finished without an outcome".to_string(),
                            false,
                            false,
                        )
                    });
                }
            }
            state.attempt = state.attempt.wrapping_add(1);
            state.preparing = true;
            state.attempt
        };

        let result = self.run_prepare(app);
        if let Ok(mut state) = self.restart.lock() {
            state.preparing = false;
            state.ready = result.ready;
            state.completed_attempt = attempt;
            state.result = Some(result.clone());
            self.settled.notify_all();
        }
        result
    }

    #[cfg(test)]
    fn wait_for_joiner(&self) {
        let state = self.restart.lock().expect("restart state");
        let (state, _) = self
            .settled
            .wait_timeout_while(state, std::time::Duration::from_secs(1), |state| {
                state.joiners == 0
            })
            .expect("restart joiner");
        assert!(state.joiners > 0, "restart caller did not join");
    }

    fn run_prepare<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>) -> PrepareRestartReceipt {
        let Some(state) = app.try_state::<AppState>() else {
            return PrepareRestartReceipt::failed(
                "Application state unavailable".to_string(),
                false,
                false,
            );
        };
        let Some(chat) = app.try_state::<ChatService>() else {
            return PrepareRestartReceipt::failed(
                "Chat service unavailable".to_string(),
                false,
                false,
            );
        };

        if let Err(error) = chat.quiesce_for_restart() {
            let can_resume = chat.resume_after_failed_restart().is_ok();
            return PrepareRestartReceipt::failed(error, false, can_resume);
        }
        if let Err(error) = state.semantic.quiesce_for_restart() {
            let can_resume = chat.resume_after_failed_restart().is_ok()
                && state.semantic.resume_after_failed_restart().is_ok();
            return PrepareRestartReceipt::failed(error, false, can_resume);
        }

        #[cfg(test)]
        if let Some(hook) = BEFORE_TERMINAL_RESTART
            .lock()
            .expect("restart test hook")
            .take()
        {
            hook();
        }

        // From this point resources are released terminally. A later failure
        // remains a closed retry state; editing is never re-enabled against a
        // partially released running vault.
        let mut timeline_portable = false;
        let terminal_result = (|| -> Result<(), String> {
            if let Some(mut watcher) = self
                .watcher
                .lock()
                .map_err(|_| "Vault watcher lifecycle lock poisoned".to_string())?
                .take()
            {
                watcher.stop_and_join()?;
            }
            state.settle_restart_writes()?;
            state.stop_rebuildable_projection_work()?;
            state
                .note_timeline()
                .clean_close(state.running_vault().root())
                .map_err(|error| error.to_string())?;
            timeline_portable = true;
            state.semantic.finish_restart_shutdown()?;
            Ok(())
        })();

        match terminal_result {
            Ok(()) => PrepareRestartReceipt::ready(),
            Err(error) => PrepareRestartReceipt::failed(error, timeline_portable, false),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::EventBus, semantic::SemanticState, state::RunningVault};
    use std::sync::mpsc;

    fn app_with_disposable_vault(
        with_chat: bool,
    ) -> (
        tauri::App<tauri::test::MockRuntime>,
        crate::test_support::TestDir,
        crate::test_support::TestDir,
    ) {
        let app_data = crate::test_support::TestDir::new("restart-lifecycle-app-data");
        crate::state::initialize_app_data_dir(app_data.path().to_path_buf()).unwrap();
        let notes = crate::test_support::TestDir::new("restart-lifecycle-vault");
        crate::state::set_notes_root_override(Some(notes.path().to_path_buf())).unwrap();
        crate::state::ensure_vault_scaffold(notes.path()).unwrap();
        let running = RunningVault::resolve(app_data.path().to_path_buf()).unwrap();
        let running_root = running.root().to_path_buf();
        let running_data = running.data_dir().to_path_buf();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        app.manage(AppLifecycle::new());
        app.manage(
            AppState::new_with_running_vault(
                running,
                SemanticState::new_disabled("disabled"),
                EventBus::disabled(),
            )
            .unwrap(),
        );
        if with_chat {
            app.manage(ChatService::new(running_root, running_data).unwrap());
        }
        (app, app_data, notes)
    }

    #[test]
    fn missing_app_state_cannot_claim_the_running_workspace_is_resumable() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();

        let receipt = AppLifecycle::new().prepare_restart(app.handle());

        assert!(!receipt.ready);
        assert!(!receipt.timeline_portable);
        assert!(!receipt.can_resume);
        assert_eq!(
            receipt.error.as_deref(),
            Some("Application state unavailable")
        );
    }

    #[test]
    fn missing_chat_service_cannot_claim_the_running_workspace_is_resumable() {
        let _guard = crate::test_support::lock_test_env();
        let (app, _app_data, _notes) = app_with_disposable_vault(false);

        let receipt = app.state::<AppLifecycle>().prepare_restart(app.handle());

        assert!(!receipt.ready);
        assert!(!receipt.timeline_portable);
        assert!(!receipt.can_resume);
        assert_eq!(receipt.error.as_deref(), Some("Chat service unavailable"));
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn concurrent_restart_preparations_join_one_ready_transition() {
        let _guard = crate::test_support::lock_test_env();
        let (app, _app_data, _notes) = app_with_disposable_vault(true);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        *BEFORE_TERMINAL_RESTART.lock().unwrap() = Some(Box::new(move || {
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        }));

        let first_app = app.handle().clone();
        let second_app = app.handle().clone();
        std::thread::scope(|scope| {
            let first = scope.spawn(move || {
                first_app
                    .state::<AppLifecycle>()
                    .prepare_restart(&first_app)
            });
            entered_rx
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap();
            let (joined_tx, joined_rx) = mpsc::channel();
            let second = scope.spawn(move || {
                let receipt = second_app
                    .state::<AppLifecycle>()
                    .prepare_restart(&second_app);
                joined_tx.send(()).unwrap();
                receipt
            });
            app.state::<AppLifecycle>().wait_for_joiner();
            assert!(joined_rx.try_recv().is_err());
            release_tx.send(()).unwrap();
            let first = first.join().unwrap();
            let second = second.join().unwrap();
            assert!(first.ready, "{first:?}");
            assert!(second.ready, "{second:?}");
            assert!(first.timeline_portable);
            assert!(second.timeline_portable);
        });
        crate::state::set_notes_root_override(None).unwrap();
    }

    #[test]
    fn terminal_close_failure_stays_closed_and_retry_reaches_ready() {
        let _guard = crate::test_support::lock_test_env();
        let (app, _app_data, _notes) = app_with_disposable_vault(true);
        crate::services::note_timeline::inject_history_clean_close_failure_once();

        let first = app.state::<AppLifecycle>().prepare_restart(app.handle());
        assert!(!first.ready, "{first:?}");
        assert!(!first.timeline_portable);
        assert!(!first.can_resume);
        assert!(!app.state::<AppLifecycle>().is_ready());

        let retry = app.state::<AppLifecycle>().prepare_restart(app.handle());
        assert!(retry.ready, "{retry:?}");
        assert!(retry.timeline_portable);
        assert!(!retry.can_resume);
        assert!(app.state::<AppLifecycle>().is_ready());
        crate::state::set_notes_root_override(None).unwrap();
    }
}
