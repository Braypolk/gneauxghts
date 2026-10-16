//! Native, bounded loaded-capacity observations. No positive capacity cache or model loop.
use crate::pi_prototype_transport::NativeTransport;
use futures_util::StreamExt;
use serde_json::Value;
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
use tauri::Manager;

fn loaded_capacity(value: &Value, model: &str) -> Option<u64> {
    let mut found = Vec::new();
    for entry in value["models"].as_array()? {
        for instance in entry["loaded_instances"].as_array().into_iter().flatten() {
            if entry["key"] == model || instance["id"] == model {
                found.push(instance["config"]["context_length"].as_u64().filter(|n|*n>0));
            }
        }
    }
    if found.len()==1 {found[0]} else {None}
}
struct Probe {client:Option<reqwest::Client>, unavailable:Mutex<HashMap<String,Instant>>}
fn probe()-> &'static Probe {
    static PROBE:OnceLock<Probe>=OnceLock::new();
    PROBE.get_or_init(||Probe{client:reqwest::Client::builder().timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none()).build().ok(),unavailable:Mutex::new(HashMap::new())})
}
#[tauri::command]
pub(crate) async fn pi_context_capacity(app:tauri::AppHandle,admission_id:String)->Result<Option<u64>,String>{
    // Tuple stays native. Endpoints and credentials never enter the IPC return or diagnostics.
    let configuration=app.state::<NativeTransport>().metadata_configuration(&admission_id);
    let Some((base,model,credential))=configuration else{return Ok(None);};
    Ok(observe(base,model,credential).await)
}
async fn observe(base:String,model:String,credential:Option<String>)->Option<u64>{
    let probe=probe();let cache_key=format!("{base}\0{model}");let now=Instant::now();
    {
        let mut unavailable=probe.unavailable.lock().ok()?;
        unavailable.retain(|_,deadline|*deadline>now);
        if unavailable.contains_key(&cache_key){return None;}
    }
    let fetch=async{
        let mut url=url::Url::parse(&base).ok()?;
        if !matches!(url.scheme(),"http"|"https")||!url.username().is_empty()||url.password().is_some(){return None;}
        url.set_path("/api/v1/models");url.set_query(None);url.set_fragment(None);
        let mut request=probe.client.as_ref()?.get(url);
        if let Some(key)=credential{request=request.bearer_auth(key);}
        let mut stream=request.send().await.ok()?.error_for_status().ok()?.bytes_stream();let mut bytes=Vec::new();
        while let Some(chunk)=stream.next().await{let chunk=chunk.ok()?;if bytes.len().saturating_add(chunk.len())>256000{return None;}bytes.extend_from_slice(&chunk);}
        loaded_capacity(&serde_json::from_slice::<Value>(&bytes).ok()?,&model)
    }.await;
    let mut unavailable=probe.unavailable.lock().ok()?;
    if fetch.is_none(){if unavailable.len()>=128{unavailable.clear();}unavailable.insert(cache_key,now+Duration::from_secs(30));}
    else{unavailable.remove(&cache_key);}
    fetch
}

#[cfg(test)]
mod tests{
    use super::*;use serde_json::json;
    #[test]
    fn capacity_requires_one_exact_loaded_instance_and_never_advertised_maximum(){
        let single=json!({"models":[{"key":"m","max_context_length":999999,"loaded_instances":[{"id":"one","config":{"context_length":32768}}]}]});
        assert_eq!(loaded_capacity(&single,"m"),Some(32768));assert_eq!(loaded_capacity(&single,"different"),None);
        let ambiguous=json!({"models":[{"key":"m","loaded_instances":[{"id":"one","config":{"context_length":32768}},{"id":"two","config":{"context_length":65536}}]}]});
        assert_eq!(loaded_capacity(&ambiguous,"m"),None);assert_eq!(loaded_capacity(&ambiguous,"two"),Some(65536));
        assert_eq!(loaded_capacity(&json!({"models":[{"key":"m","max_context_length":999999}]}),"m"),None);
    }
}
