//! Deterministic Save preparation. Pi owns origins, pending drafts and receipts;
//! this adapter only reads canonical notes and prepares ordinary-note previews.
use crate::{chat::{ChatSource, VaultAccess, structured_answer::CitationAssociation},
    index::AppState,
    proposal_policy::{SaveSelection, first_heading, place_addition, selected_content_with_associations}};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct SaveInput {
    conversation_id: String,
    message_id: String,
    markdown: String,
    #[serde(default)] sources: Vec<ChatSource>,
    // Some(empty) means an admitted answer without source associations, while
    // None preserves compatibility with older admitted ordinary-text answers.
    associations: Option<Vec<CitationAssociation>>,
    selection: Option<SaveSelection>,
    target_note_id: Option<String>,
    heading: Option<String>,
    copy_intent: Option<String>,
    title: Option<String>,
    access: VaultAccess,
    #[serde(default)] grants: Vec<String>,
}

fn valid_identity(value:&str,prefix:&str)->bool {
    value.strip_prefix(prefix).is_some_and(|tail| !tail.is_empty() && tail.bytes().all(|c|c.is_ascii_digit()) && tail.parse::<u64>().is_ok_and(|n|n>0))
}

fn target_base(app:&tauri::AppHandle,id:&str,access:&VaultAccess,grants:&[String])->Result<(String,String,String,String),String> {
    crate::pi_prototype_publication::require_access(&app.state::<crate::chat_domain::ChatDomain>(),access,Some(id),grants)?;
    let state=app.state::<AppState>();
    let path=state.notes_index.lock().map_err(|_|"Notes index unavailable")?
        .get_note_by_note_id(id).filter(|(_,note)|note.document_kind==crate::note::DocumentKind::Note)
        .map(|(path,_)|path.clone()).ok_or("Destination note unavailable")?;
    let path=crate::proposals::canonical_agent_commit_target(state.running_vault().root(),&path)?;
    let raw=std::fs::read_to_string(&path).map_err(|e|e.to_string())?;
    crate::note::reject_chat_projection_write(&raw)?;
    let fallback=path.file_stem().unwrap_or_default().to_string_lossy();
    let (title,body)=crate::note::extract_file_name_title_and_body(&raw,&fallback);
    let note_id=crate::note::note_id_from_path_or_markdown(Some(&path),&raw);
    // Identity follows moves; a caller-supplied path never chooses an update target.
    if note_id.as_deref()!=Some(id) {return Err("Destination identity changed".into());}
    Ok((path.to_string_lossy().into_owned(),title,body,crate::semantic::db::content_hash(&raw)))
}

#[tauri::command]
pub(crate) async fn pi_prepare_save(app:tauri::AppHandle,input:SaveInput)->Result<Value,String> {
    if !valid_identity(&input.conversation_id,"pi-") || !valid_identity(&input.message_id,"pi-assistant-")
        || input.markdown.trim().is_empty() || input.markdown.len()>262144 || input.sources.len()>128
        || input.associations.as_ref().is_some_and(|a|a.len()>512)
        || input.copy_intent.as_ref().is_some_and(|c|c.trim().is_empty() || c.len()>200)
        || (input.heading.is_some() && input.target_note_id.is_none()) {
        return Err("Invalid completed answer Save intent".into());
    }
    if let Some(associations)=&input.associations {
        for a in associations {
            if a.start>a.end || !input.markdown.is_char_boundary(a.start) || !input.markdown.is_char_boundary(a.end)
                || a.links.len()>128 || a.links.iter().any(|link|link.len()>4096 || !input.markdown.contains(link)) {
                return Err("Recorded answer source associations are invalid".into());
            }
        }
    }
    let selected=input.selection.as_ref().map(|selection|
        selected_content_with_associations(&input.markdown,selection,input.associations.as_deref())).transpose()?;
    let chosen=selected.as_ref().map(|s|s.markdown.as_str()).unwrap_or(&input.markdown);
    let title=input.title.clone().or_else(||first_heading(chosen)).unwrap_or_else(||"Saved Pi answer".into());
    let root=app.state::<AppState>().running_vault().root().to_path_buf();
    let mut addition=crate::note_promotion::promote_links_with_lookup(chosen,&input.sources,&root,|id| {
        crate::pi_prototype_publication::require_access(&app.state::<crate::chat_domain::ChatDomain>(),&input.access,Some(id),&input.grants)?;
        let state=app.state::<AppState>();
        let index=state.notes_index.lock().map_err(|_|"Notes index unavailable")?;
        Ok(index.get_note_by_note_id(id).filter(|(_,note)|note.document_kind==crate::note::DocumentKind::Note).map(|(path,_)|path.clone()))
    })?;
    addition.push_str(&format!("\n\n[[Chats/Pi/{}/Origin#^msg_{}|Open in chat]]",input.conversation_id,input.message_id));
    let (title,markdown,path,promotion,base_hash)=if let Some(id)=&input.target_note_id {
        let (path,title,base,hash)=target_base(&app,id,&input.access,&input.grants)?;
        let (markdown,prefix,suffix)=place_addition(&base,&addition,input.heading.as_deref())?;
        (title,markdown,Some(path),Some(json!({"addition":addition,"heading":input.heading,"prefix":prefix,"suffix":suffix})),Some(hash))
    } else {(title,addition,None,None,None)};
    let mut prepared=crate::pi_prototype_publication::pi_prepare_review(app,title,markdown,input.target_note_id.clone(),input.access,path,Some(input.grants)).await?;
    if base_hash.as_deref().is_some_and(|hash|prepared["baseHash"].as_str()!=Some(hash)) {
        return Err("Destination changed while preparing the addition; Save again on the latest base".into());
    }
    prepared["payload"]["wholeAnswer"]=json!(input.selection.is_none());
    prepared["payload"]["originalSave"]=json!(input.copy_intent.is_none());
    prepared["payload"]["reviewIntent"]=json!("requested");
    if let Some(promotion)=promotion {prepared["payload"]["promotion"]=promotion;}
    prepared["payload"]["saveOrigin"]=json!({"conversationId":input.conversation_id,"messageId":input.message_id,
        "selection":input.selection,"range":selected.as_ref().map(|s|vec![s.range.start,s.range.end]),
        "occurrence":selected.as_ref().map(|s|s.occurrence),"targetNoteId":input.target_note_id,
        "heading":input.heading,"copyIntent":input.copy_intent});
    Ok(prepared)
}

#[tauri::command]
pub(crate) async fn pi_refresh_saved_addition(app:tauri::AppHandle,proposal:Value,markdown:String,access:VaultAccess,grants:Option<Vec<String>>,title:Option<String>,path:Option<String>)->Result<Value,String> {
    let intent=&proposal["payload"]["promotion"];
    let prefix=intent["prefix"].as_str().ok_or("Missing insertion base")?;
    let suffix=intent["suffix"].as_str().ok_or("Missing insertion base")?;
    let addition=crate::proposal_policy::isolated_addition(&markdown,prefix,suffix)?;
    let id=proposal["noteId"].as_str().ok_or("Missing destination identity")?;
    let grants=grants.unwrap_or_default();
    let (current_path,current_title,base,hash)=target_base(&app,id,&access,&grants)?;
    let (working,prefix,suffix)=place_addition(&base,&addition,intent["heading"].as_str())?;
    let mut prepared=crate::pi_prototype_publication::pi_prepare_review(app,title.unwrap_or(current_title),working,Some(id.into()),access,Some(path.unwrap_or(current_path)),Some(grants)).await?;
    if prepared["baseHash"].as_str()!=Some(hash.as_str()) {return Err("Destination changed while refreshing; review again".into());}
    let mut payload=proposal["payload"].clone();
    payload["markdown"]=prepared["payload"]["markdown"].clone();
    payload["promotion"]=json!({"addition":addition,"heading":intent["heading"],"prefix":prefix,"suffix":suffix});
    prepared["payload"]=payload;
    Ok(prepared)
}
