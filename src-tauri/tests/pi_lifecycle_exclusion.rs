//! Compile the real application with --features pi-prototype as well as these
//! source checks: construction-only checks cannot prove runtime exclusion.
use quote_tokens::Compact;
use std::{
    fs,
    path::{Path, PathBuf},
};

mod quote_tokens {
    pub trait Compact {
        fn compact(&self) -> String;
    }
    impl Compact for str {
        fn compact(&self) -> String {
            self.chars().filter(|c| !c.is_whitespace()).collect()
        }
    }
}
fn source(path: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap()
}
fn cfg_is_pi_enabled(meta: &syn::Meta) -> bool {
    match meta {
        syn::Meta::Path(path) => !path.is_ident("test"),
        syn::Meta::NameValue(value) if value.path.is_ident("feature") => {
            matches!(&value.value,syn::Expr::Lit(syn::ExprLit{lit:syn::Lit::Str(value),..}) if value.value()=="pi-prototype")
        }
        syn::Meta::List(list) if list.path.is_ident("cfg") || list.path.is_ident("all") => {
            use syn::parse::Parser;
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated
                .parse2(list.tokens.clone())
                .unwrap()
                .iter()
                .all(cfg_is_pi_enabled)
        }
        syn::Meta::List(list) if list.path.is_ident("any") => {
            use syn::parse::Parser;
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated
                .parse2(list.tokens.clone())
                .unwrap()
                .iter()
                .any(cfg_is_pi_enabled)
        }
        syn::Meta::List(list) if list.path.is_ident("not") => {
            !cfg_is_pi_enabled(&syn::parse2(list.tokens.clone()).unwrap())
        }
        _ => true,
    }
}
fn pi_modules(path: &Path, found: &mut Vec<PathBuf>) {
    found.push(path.to_owned());
    let parsed = syn::parse_file(&fs::read_to_string(path).unwrap()).unwrap();
    let parent = path.parent().unwrap();
    let stem = path.file_stem().unwrap().to_str().unwrap();
    let base = if matches!(stem, "lib" | "mod") {
        parent.to_owned()
    } else {
        parent.join(stem)
    };
    for item in parsed.items {
        let syn::Item::Mod(module) = item else {
            continue;
        };
        if module.content.is_some()
            || module
                .attrs
                .iter()
                .any(|attr| attr.path().is_ident("cfg") && !cfg_is_pi_enabled(&attr.meta))
        {
            continue;
        }
        let explicit = module.attrs.iter().find_map(|attr| {
            if let syn::Meta::NameValue(value) = &attr.meta {
                if value.path.is_ident("path") {
                    if let syn::Expr::Lit(syn::ExprLit {
                        lit: syn::Lit::Str(path),
                        ..
                    }) = &value.value
                    {
                        return Some(parent.join(path.value()));
                    }
                }
            }
            None
        });
        let child = explicit.unwrap_or_else(|| {
            let file = base.join(format!("{}.rs", module.ident));
            if file.exists() {
                file
            } else {
                base.join(module.ident.to_string()).join("mod.rs")
            }
        });
        pi_modules(&child, found);
    }
}
#[test]
fn evaluation_module_graph_excludes_entire_legacy_runtime() {
    let mut modules = Vec::new();
    pi_modules(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
        &mut modules,
    );
    for excluded in [
        "agent_run_coordinator.rs",
        "agent_runtime.rs",
        "agent_tools.rs",
        "agent_permissions.rs",
        "chat.rs",
        "chat_commands.rs",
        "proposal_commands.rs",
    ] {
        assert!(
            !modules
                .iter()
                .any(|path| path.file_name().unwrap() == excluded),
            "legacy module {excluded} reachable in Pi graph"
        );
    }
    assert!(modules.iter().any(|path| path.ends_with("pi_chat.rs")));
    assert!(modules
        .iter()
        .any(|path| path.ends_with("pi_chat_commands.rs")));
    assert!(modules.iter().any(|path| path.ends_with("chat_domain.rs")));
}
#[test]
fn retained_domain_never_stores_pi_lifecycle_state() {
    let domain = source("src/chat_domain.rs");
    for forbidden in [
        "CREATE TABLE IF NOT EXISTS chat_conversations",
        "chat_agent_runs",
        "chat_messages",
        "chat_agent_proposals",
        "ChatService",
        "AgentRunCoordinator",
        "AgentRuntime",
    ] {
        assert!(
            if forbidden.contains(' ') {
                !domain.contains(forbidden)
            } else {
                !domain.split(|c: char| !c.is_alphanumeric() && c != '_').any(|token| token == forbidden)
            },
            "retained domain contains {forbidden}"
        );
    }
    let facade = source("src/pi_chat.rs");
    for forbidden in [
        "mod runtime",
        "mod store",
        "mod recovery",
        "AgentRuntime",
        "ChatService",
    ] {
        assert!(!facade.contains(forbidden));
    }
}
#[test]
fn pi_dispatch_has_only_retained_domain_commands() {
    let commands = source("src/commands/pi_chat_commands.rs");
    for forbidden in [
        "chat_send_message",
        "chat_retry_message",
        "chat_decide_permission",
        "AgentRuntime",
        "ChatService",
        "chat_agent_runs",
        "chat_conversations",
    ] {
        assert!(!commands.contains(forbidden));
    }
    let composition = source("src/lib.rs").compact();
    assert!(composition.contains(
        "#[cfg(not(feature=\"pi-prototype\"))]{letchat_service=ChatService::new_managed"
    ));
    let lifecycle = source("src/app/lifecycle.rs").compact();
    let close = lifecycle
        .find("database.finish_restart_shutdown()?")
        .unwrap();
    let timeline = lifecycle
        .find(".clean_close(state.running_vault().root())")
        .unwrap();
    assert!(
        close < timeline,
        "Pi database must close before NoteTimeline portable receipt"
    );
    assert!(lifecycle.contains("database.quiesce_for_restart(app)"));
    assert!(lifecycle.contains("transport.quiesce_for_restart()"));
}
