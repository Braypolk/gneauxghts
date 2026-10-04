//! Private Atlas publication implementation; one semantic owner remains authoritative.
use crate::state::effective_open_count;
use rayon::prelude::*;
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
};
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasReadyPointer {
    format_version: u32,
    structural_generation: String,
    target_epoch: u64,
    published_at_millis: u64,
    artifact_file: String,
    dependencies: AtlasDependencies,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AtlasGenerationArtifact {
    response: VaultAtlasResponse,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasLabelReadyPointer {
    format_version: u32,
    structural_generation: String,
    membership_fingerprint: String,
    algorithm_version: String,
    model_fingerprint: String,
    label_generation: String,
    artifact_file: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasLabelGenerationArtifact {
    structural_generation: String,
    membership_fingerprint: String,
    algorithm_version: String,
    model_fingerprint: String,
    label_generation: String,
    labels: HashMap<String, AtlasPublishedLabel>,
    /// False while labels are still streaming in; true when the job finished.
    /// Missing on older artifacts — treat as complete.
    #[serde(default = "default_label_artifact_complete")]
    complete: bool,
}

fn default_label_artifact_complete() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AtlasPublishedLabel {
    label: String,
    confidence: f32,
    #[serde(default = "default_medoid_label_source")]
    source: String,
}

fn default_medoid_label_source() -> String {
    "medoid".to_string()
}

use super::*;

// Opening history is mutable device-local metadata, never a geometry input.
fn apply_opening_activity(
    nodes: &mut [AtlasNode],
    activity_by_note_id: &HashMap<String, NoteActivity>,
    now: u64,
) {
    for node in nodes {
        let activity = node
            .note_id
            .as_ref()
            .and_then(|id| activity_by_note_id.get(id));
        node.last_viewed_at_millis = activity.map(|item| item.last_viewed_at_millis);
        node.effective_open_count = activity
            .map(|item| effective_open_count(item.open_count, item.last_viewed_at_millis, now));
    }
}

fn atlas_root(cache_dir: &Path) -> PathBuf {
    cache_dir.join("atlas")
}

fn ready_pointer_path(cache_dir: &Path, key: AtlasGenerationKey) -> PathBuf {
    atlas_root(cache_dir).join(format!(
        "ready-{}.json",
        key.chat_visibility.signature_value()
    ))
}

fn label_ready_pointer_path(cache_dir: &Path, key: AtlasGenerationKey) -> PathBuf {
    atlas_root(cache_dir).join(format!(
        "label-ready-{}.json",
        key.chat_visibility.signature_value()
    ))
}

fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Atlas publication path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        current_time_millis()?
    ));
    let file = File::create(&temporary).map_err(|err| err.to_string())?;
    let mut writer = BufWriter::new(file);
    serde_json::to_writer(&mut writer, value).map_err(|err| err.to_string())?;
    writer.flush().map_err(|err| err.to_string())?;
    writer.get_ref().sync_all().map_err(|err| err.to_string())?;
    drop(writer);
    fs::rename(&temporary, path).map_err(|err| err.to_string())?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|err| err.to_string())
}

fn gc_unreferenced_generations(cache_dir: &Path) -> Result<(), String> {
    let root = atlas_root(cache_dir);
    let mut referenced = HashSet::new();
    for visibility in [
        AtlasChatVisibilityKey::Hidden,
        AtlasChatVisibilityKey::Remembered,
        AtlasChatVisibilityKey::All,
    ] {
        if let Ok(pointer) = read_json::<AtlasReadyPointer>(&ready_pointer_path(
            cache_dir,
            AtlasGenerationKey {
                chat_visibility: visibility,
            },
        )) {
            referenced.insert(pointer.artifact_file);
        }
        if let Ok(pointer) = read_json::<AtlasLabelReadyPointer>(&label_ready_pointer_path(
            cache_dir,
            AtlasGenerationKey {
                chat_visibility: visibility,
            },
        )) {
            referenced.insert(pointer.artifact_file);
        }
    }
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(());
    };
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if (name.starts_with("generation-") || name.starts_with("label-generation-"))
            && name.ends_with(".json")
            && !referenced.contains(&name)
        {
            fs::remove_file(entry.path()).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    serde_json::from_slice(&bytes).map_err(|err| err.to_string())
}

fn pointer_is_compatible(
    pointer: &AtlasReadyPointer,
    dependencies: &AtlasDependencies,
    revision: u64,
) -> bool {
    pointer.format_version == ATLAS_GENERATION_FORMAT_VERSION
        && pointer.dependencies == *dependencies
        && pointer.target_epoch >= revision
}

fn label_pointer_is_compatible(
    pointer: &AtlasLabelReadyPointer,
    structural_generation: &str,
    membership_fingerprint: &str,
    model_fingerprint: &str,
) -> bool {
    pointer.format_version == ATLAS_GENERATION_FORMAT_VERSION
        && pointer.structural_generation == structural_generation
        && pointer.membership_fingerprint == membership_fingerprint
        && pointer.algorithm_version == LABEL_ALGORITHM_VERSION
        && pointer.model_fingerprint == model_fingerprint
}

fn request_is_superseded(
    pending: &PendingIndexState,
    generation_key: AtlasGenerationKey,
    target_epoch: u64,
) -> bool {
    pending
        .atlas_requests
        .get(&generation_key)
        .is_some_and(|epoch| *epoch > target_epoch)
}

impl AtlasWorkerContext {
    pub(crate) fn build_and_publish(
        &self,
        generation_key: AtlasGenerationKey,
        revision: u64,
    ) -> Result<VaultAtlasResponse, String> {
        ensure_rayon_uses_all_cores();
        let activity_by_note_id: HashMap<String, NoteActivity> = HashMap::new();
        let request_started = Instant::now();
        self.debug.record_with_metrics(
            "atlas",
            "build_started",
            Some(format!(
                "chat_visibility={}",
                generation_key.chat_visibility.signature_value()
            )),
            None,
            |metrics| metrics.atlas_request_count += 1,
        );
        let load_started = Instant::now();
        let mut connection = open_database(&self.db_path)?;
        crate::semantic::ensure_schema(&connection)?;
        let PersistedAtlasInputs {
            metadata,
            hard_links,
            dependencies,
        } = persisted_atlas_inputs(&connection, generation_key)?;
        if dependencies.note_ann_generation.is_empty()
            || self.note_ann.generation_id().as_deref()
                != Some(dependencies.note_ann_generation.as_str())
        {
            return Err(ATLAS_DEPENDENCIES_NOT_READY.to_string());
        }
        let indexed_notes = visible_atlas_notes(
            load_atlas_note_embeddings(&connection)?,
            &metadata,
            self.dimensions,
        )
        .into_iter()
        .filter(|note| Path::new(&note.note_path).is_file())
        .collect::<Vec<_>>();
        if indexed_notes.is_empty() {
            record_atlas_phase(&self.debug, "load", load_started);
            let response = empty_atlas("empty", "No indexed notes are available yet.", revision)?;
            record_atlas_total(&self.debug, request_started, false);
            return Ok(response);
        }

        let layout_pull = DEFAULT_LAYOUT_PULL;
        let positions = load_atlas_positions(&connection)?
            .into_iter()
            .map(|position| (position.note_path, (position.x, position.y)))
            .collect::<HashMap<_, _>>();
        let has_all_cached_positions = indexed_notes
            .iter()
            .all(|note| positions.contains_key(&note.note_path));
        record_atlas_phase(&self.debug, "load", load_started);

        let mut nodes = indexed_notes
            .iter()
            .enumerate()
            .map(|(index, note)| {
                let meta = metadata.get(&note.note_path);
                let note_id = meta.and_then(|item| item.note_id.clone());
                let last_viewed = note_id
                    .as_ref()
                    .and_then(|id| activity_by_note_id.get(id))
                    .map(|activity| activity.last_viewed_at_millis);
                let (x, y) = positions
                    .get(&note.note_path)
                    .copied()
                    .unwrap_or_else(|| seeded_position(&note.note_path, index));
                let created_at_millis = crate::note::parse_rfc3339_millis(&note.created_at)
                    .unwrap_or(note.modified_millis);
                let updated_at_millis = crate::note::parse_rfc3339_millis(&note.updated_at)
                    .unwrap_or(note.modified_millis);
                WorkingNode {
                    id: note.note_path.clone(),
                    note_id,
                    note_path: note.note_path.clone(),
                    title: meta
                        .map(|item| item.title.clone())
                        .filter(|title| !title.trim().is_empty())
                        .unwrap_or_else(|| note.note_title.clone()),
                    file_name: meta
                        .map(|item| item.file_name.clone())
                        .unwrap_or_else(|| file_name_for_path(&note.note_path)),
                    preview: meta.map(|item| item.preview.clone()).unwrap_or_default(),
                    tags: meta.map(|item| item.tags.clone()).unwrap_or_default(),
                    created_at_millis,
                    updated_at_millis,
                    last_viewed_at_millis: last_viewed,
                    centrality: 0.0,
                    importance: 0.0,
                    embedding: normalized_embedding(note.embedding.clone()),
                    x,
                    y,
                    cloud_id: None,
                    parent_cloud_id: None,
                    child_cloud_id: None,
                    isolated: true,
                }
            })
            .collect::<Vec<_>>();

        let graph_started = Instant::now();
        let knn_rows = build_hnsw_knn_rows(&nodes);
        self.check_superseded(generation_key, revision)?;
        if !has_all_cached_positions {
            place_uncached_nodes_from_neighbors(&mut nodes, &positions, &knn_rows);
        }
        let mut links = collect_links(&nodes, &knn_rows, hard_links);
        boost_links(&mut links, &nodes);
        apply_centrality(&mut nodes, &links);
        let layout_edges = build_layout_graph(&nodes, &links);
        record_atlas_phase(&self.debug, "graph", graph_started);
        let cloud_started = Instant::now();
        let mut cloud_specs = assign_clouds(&mut nodes, &layout_edges);
        self.check_superseded(generation_key, revision)?;
        record_atlas_phase(&self.debug, "cloud", cloud_started);
        let layout_started = Instant::now();
        let umap_applied = apply_umap_layout(&mut nodes, &knn_rows);
        if umap_applied {
            separate_umap_clouds(&mut nodes, &layout_edges, &mut cloud_specs, layout_pull);
        } else {
            place_cloud_first_layout(&mut nodes, &layout_edges, &mut cloud_specs, layout_pull);
        }
        refresh_cloud_geometry(&mut cloud_specs, &nodes);
        self.check_superseded(generation_key, revision)?;
        record_atlas_phase(&self.debug, "layout", layout_started);
        let cloud_finalize_started = Instant::now();
        finalize_cloud_cores(&nodes, &layout_edges, &mut cloud_specs);
        let mut clouds = cloud_specs
            .par_iter()
            .map(|spec| build_cloud(spec, &nodes, &links))
            .collect::<Vec<_>>();
        clouds.sort_by(|left, right| {
            left.level
                .cmp(&right.level)
                .then_with(|| right.note_count.cmp(&left.note_count))
                .then_with(|| left.id.cmp(&right.id))
        });
        record_atlas_phase(&self.debug, "cloud", cloud_finalize_started);

        let persist_started = Instant::now();
        save_atlas_positions(
            &mut connection,
            &nodes
                .iter()
                .map(|node| StoredAtlasPosition {
                    note_path: node.note_path.clone(),
                    x: node.x,
                    y: node.y,
                })
                .collect::<Vec<_>>(),
        )?;

        let response_nodes = nodes
            .iter()
            .map(|node| AtlasNode {
                id: node.id.clone(),
                note_id: node.note_id.clone(),
                note_path: node.note_path.clone(),
                title: node.title.clone(),
                file_name: node.file_name.clone(),
                document_kind: metadata
                    .get(&node.note_path)
                    .map(|meta| meta.document_kind)
                    .unwrap_or_default(),
                x: node.x,
                y: node.y,
                radius: NOTE_RADIUS_MIN
                    + (NOTE_RADIUS_MAX - NOTE_RADIUS_MIN) * node.centrality.clamp(0.0, 1.0),
                cloud_id: node.cloud_id.clone(),
                parent_cloud_id: node.parent_cloud_id.clone(),
                child_cloud_id: node.child_cloud_id.clone(),
                cluster_id: node.cloud_id.clone(),
                subcluster_id: node.child_cloud_id.clone(),
                centrality: node.centrality,
                importance: node.importance,
                last_viewed_at_millis: node.last_viewed_at_millis,
                effective_open_count: None,
                created_at_millis: node.created_at_millis,
                updated_at_millis: node.updated_at_millis,
                preview: node.preview.clone(),
                tags: node.tags.clone(),
                isolated: node.isolated,
            })
            .collect::<Vec<_>>();
        let response_links = links
            .iter()
            .enumerate()
            .map(|(index, link)| AtlasLink {
                id: format!("{}:{}:{index}", link.source_id, link.target_id),
                source_id: link.source_id.clone(),
                target_id: link.target_id.clone(),
                kind: link.kind.clone(),
                score: link.score,
                strength: link.strength,
            })
            .collect::<Vec<_>>();

        record_atlas_phase(&self.debug, "persist", persist_started);

        let published_at_millis = current_time_millis()?;
        let structural_generation = format!(
            "{}-{}",
            revision,
            &blake3::hash(
                format!(
                    "{}\0{}\0{}",
                    dependencies.source_key, dependencies.input_hash, published_at_millis
                )
                .as_bytes()
            )
            .to_hex()[..16]
        );
        let response = VaultAtlasResponse {
            status: "ready".to_string(),
            reason: None,
            revision,
            generated_at_millis: published_at_millis,
            structural_generation: structural_generation.clone(),
            label_generation: None,
            published_at_millis,
            stale: false,
            publish_in_progress: false,
            nodes: response_nodes,
            links: response_links,
            clouds,
        };
        self.check_superseded(generation_key, revision)?;
        let current_inputs = persisted_atlas_inputs(&connection, generation_key)?;
        if current_inputs.dependencies != dependencies {
            return Err(ATLAS_SUPERSEDED.to_string());
        }
        let root = atlas_root(&self.cache_dir);
        fs::create_dir_all(&root).map_err(|err| err.to_string())?;
        let artifact_file = format!(
            "generation-{}-{}.json",
            generation_key.chat_visibility.signature_value(),
            structural_generation
        );
        atomic_write_json(
            &root.join(&artifact_file),
            &AtlasGenerationArtifact {
                response: response.clone(),
            },
        )?;
        self.check_superseded(generation_key, revision)?;
        let pointer = AtlasReadyPointer {
            format_version: ATLAS_GENERATION_FORMAT_VERSION,
            structural_generation,
            target_epoch: revision,
            published_at_millis,
            artifact_file: artifact_file.clone(),
            dependencies,
        };
        atomic_write_json(
            &ready_pointer_path(&self.cache_dir, generation_key),
            &pointer,
        )?;
        let membership_fingerprint =
            cloud_membership_fingerprint(&response.structural_generation, &response.clouds);
        if let Ok(mut pending) = self.pending.lock() {
            pending.atlas_label_requests.insert(
                generation_key,
                AtlasLabelRequest {
                    structural_generation: response.structural_generation.clone(),
                    membership_fingerprint,
                },
            );
        }
        gc_unreferenced_generations(&self.cache_dir)?;
        record_atlas_total(&self.debug, request_started, false);
        Ok(response)
    }

    pub(crate) fn build_and_publish_labels(
        &self,
        generation_key: AtlasGenerationKey,
        request: &AtlasLabelRequest,
    ) -> Result<(), String> {
        ensure_rayon_uses_all_cores();
        let started = Instant::now();
        let pointer_path = ready_pointer_path(&self.cache_dir, generation_key);
        let structural_pointer = read_json::<AtlasReadyPointer>(&pointer_path)?;
        if structural_pointer.structural_generation != request.structural_generation {
            return Err(ATLAS_SUPERSEDED.to_string());
        }
        let root = atlas_root(&self.cache_dir);
        let structural =
            read_json::<AtlasGenerationArtifact>(&root.join(&structural_pointer.artifact_file))?;
        let membership = cloud_membership_fingerprint(
            &structural.response.structural_generation,
            &structural.response.clouds,
        );
        if membership != request.membership_fingerprint {
            return Err(ATLAS_SUPERSEDED.to_string());
        }

        let mut connection = open_database(&self.db_path)?;
        crate::semantic::ensure_schema(&connection)?;
        let metadata = persisted_atlas_inputs(&connection, generation_key)?.metadata;
        let note_embeddings = visible_atlas_notes(
            load_atlas_note_embeddings(&connection)?,
            &metadata,
            self.dimensions,
        )
        .into_iter()
        .map(|note| (note.note_path, normalized_embedding(note.embedding)))
        .collect::<HashMap<_, _>>();

        let generated_at = current_time_millis()?;
        let model_fingerprint = self.provider.model_info().fingerprint();
        let label_generation = format!(
            "{}-{}",
            generated_at,
            &blake3::hash(
                format!(
                    "{}\0{}\0{}\0{}",
                    request.structural_generation,
                    request.membership_fingerprint,
                    model_fingerprint,
                    LABEL_ALGORITHM_VERSION
                )
                .as_bytes()
            )
            .to_hex()[..16]
        );
        let artifact_file = format!(
            "label-generation-{}-{}.json",
            generation_key.chat_visibility.signature_value(),
            label_generation
        );
        let artifact_path = root.join(&artifact_file);
        let published = std::sync::Mutex::new(HashMap::<String, AtlasPublishedLabel>::new());
        let write_artifact = |labels: &HashMap<String, AtlasPublishedLabel>, complete: bool| {
            atomic_write_json(
                &artifact_path,
                &AtlasLabelGenerationArtifact {
                    structural_generation: request.structural_generation.clone(),
                    membership_fingerprint: request.membership_fingerprint.clone(),
                    algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
                    model_fingerprint: model_fingerprint.clone(),
                    label_generation: label_generation.clone(),
                    labels: labels.clone(),
                    complete,
                },
            )
        };
        write_artifact(&HashMap::new(), false)?;
        atomic_write_json(
            &label_ready_pointer_path(&self.cache_dir, generation_key),
            &AtlasLabelReadyPointer {
                format_version: ATLAS_GENERATION_FORMAT_VERSION,
                structural_generation: request.structural_generation.clone(),
                membership_fingerprint: request.membership_fingerprint.clone(),
                algorithm_version: LABEL_ALGORITHM_VERSION.to_string(),
                model_fingerprint: model_fingerprint.clone(),
                label_generation: label_generation.clone(),
                artifact_file: artifact_file.clone(),
            },
        )?;

        let metrics = {
            let (_, metrics) = generate_labels_progressive(
                &mut connection,
                self.provider.as_ref(),
                &structural.response.clouds,
                &structural.response.nodes,
                &note_embeddings,
                |cloud_id, assignment| {
                    let latest_pointer = read_json::<AtlasReadyPointer>(&pointer_path)?;
                    if latest_pointer.structural_generation != request.structural_generation {
                        let _ = fs::remove_file(&artifact_path);
                        return Err(ATLAS_SUPERSEDED.to_string());
                    }
                    let mut labels = published
                        .lock()
                        .map_err(|_| "Atlas label publish lock poisoned".to_string())?;
                    labels.insert(
                        cloud_id.to_string(),
                        AtlasPublishedLabel {
                            label: assignment.label.clone(),
                            confidence: assignment.confidence,
                            source: assignment.source.as_str().to_string(),
                        },
                    );
                    write_artifact(&labels, false)?;
                    Ok(())
                },
            )?;
            metrics
        };

        let latest_pointer = read_json::<AtlasReadyPointer>(&pointer_path)?;
        if latest_pointer.structural_generation != request.structural_generation {
            let _ = fs::remove_file(&artifact_path);
            return Err(ATLAS_SUPERSEDED.to_string());
        }
        let final_labels = published
            .into_inner()
            .map_err(|_| "Atlas label publish lock poisoned".to_string())?;
        write_artifact(&final_labels, true)?;
        gc_unreferenced_generations(&self.cache_dir)?;
        self.debug.record_timing(
            "atlas_labels",
            "published",
            Some(format!(
                "clouds={} candidates={} unique={} chunks={} selected={} cache_hits={} provider_texts={} batches={} keybert={} medoid_fallbacks={}",
                metrics.cloud_count,
                metrics.candidate_count,
                metrics.unique_candidate_count,
                metrics.chunk_count,
                metrics.selected_chunk_count,
                metrics.cache_hit_count,
                metrics.provider_text_count,
                metrics.provider_batch_count,
                metrics.keybert_label_count,
                metrics.medoid_fallback_count
            )),
            started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
            |debug_metrics| {
                debug_metrics.atlas_label_job_count += 1;
                debug_metrics.atlas_label_candidate_total += metrics.candidate_count as u64;
                debug_metrics.atlas_label_cache_hit_total += metrics.cache_hit_count as u64;
                debug_metrics.atlas_label_provider_text_total += metrics.provider_text_count as u64;
            },
        );
        Ok(())
    }

    fn check_superseded(
        &self,
        generation_key: AtlasGenerationKey,
        target_epoch: u64,
    ) -> Result<(), String> {
        let superseded = self
            .pending
            .lock()
            .map(|pending| request_is_superseded(&pending, generation_key, target_epoch))
            .unwrap_or(true);
        if superseded {
            Err(ATLAS_SUPERSEDED.to_string())
        } else {
            Ok(())
        }
    }
}

impl ActiveSemanticState {
    pub(in crate::semantic) fn vault_atlas(
        &self,
        generation_key: AtlasGenerationKey,
        activity_by_note_id: HashMap<String, NoteActivity>,
        revision: u64,
    ) -> Result<VaultAtlasResponse, String> {
        let connection = open_database(&self.db_path)?;
        crate::semantic::ensure_schema(&connection)?;
        let dependencies = persisted_atlas_inputs(&connection, generation_key)?.dependencies;
        let pointer_path = ready_pointer_path(&self.atlas_cache_dir, generation_key);
        let pointer = read_json::<AtlasReadyPointer>(&pointer_path).ok();
        let mut published = pointer.as_ref().and_then(|pointer| {
            if pointer.format_version != ATLAS_GENERATION_FORMAT_VERSION {
                return None;
            }
            read_json::<AtlasGenerationArtifact>(
                &atlas_root(&self.atlas_cache_dir).join(&pointer.artifact_file),
            )
            .ok()
            .map(|artifact| artifact.response)
        });
        let compatible = pointer
            .as_ref()
            .is_some_and(|pointer| pointer_is_compatible(pointer, &dependencies, revision));
        let mut label_compatible = false;
        let mut label_complete = false;
        let mut label_request = None;
        let expected_label_model = self.provider.model_info().fingerprint();
        if let Some(response) = &mut published {
            suppress_missing_atlas_nodes(response);
            let membership =
                cloud_membership_fingerprint(&response.structural_generation, &response.clouds);
            label_request = Some(AtlasLabelRequest {
                structural_generation: response.structural_generation.clone(),
                membership_fingerprint: membership.clone(),
            });
            if let Ok(label_pointer) = read_json::<AtlasLabelReadyPointer>(
                &label_ready_pointer_path(&self.atlas_cache_dir, generation_key),
            ) {
                if label_pointer_is_compatible(
                    &label_pointer,
                    &response.structural_generation,
                    &membership,
                    &expected_label_model,
                ) {
                    if let Ok(labels) = read_json::<AtlasLabelGenerationArtifact>(
                        &atlas_root(&self.atlas_cache_dir).join(&label_pointer.artifact_file),
                    ) {
                        if labels.structural_generation == response.structural_generation
                            && labels.membership_fingerprint == membership
                            && labels.algorithm_version == LABEL_ALGORITHM_VERSION
                            && labels.model_fingerprint == expected_label_model
                            && labels.label_generation == label_pointer.label_generation
                        {
                            for cloud in &mut response.clouds {
                                if let Some(published) = labels.labels.get(&cloud.id) {
                                    cloud.label = Some(published.label.clone());
                                    cloud.label_source = published.source.clone();
                                }
                            }
                            response.label_generation = Some(labels.label_generation);
                            label_compatible = true;
                            label_complete = labels.complete;
                        }
                    }
                }
            }
        }
        let (building, label_building, queued, label_queued, enqueued) =
            self.work_queue.stage(|pending| {
                let building = pending
                    .atlas_building
                    .get(&generation_key)
                    .is_some_and(|epoch| *epoch >= revision);
                let mut enqueued = false;
                if !compatible && !building {
                    pending
                        .atlas_requests
                        .entry(generation_key)
                        .and_modify(|epoch| *epoch = (*epoch).max(revision))
                        .or_insert(revision);
                    enqueued = true;
                }
                let label_building = pending.atlas_label_building.contains(&generation_key);
                // Re-run labeling when missing/incompatible, or when a partial artifact
                // was left incomplete (e.g. interrupted progressive publish).
                if compatible && !(label_compatible && label_complete) && !label_building {
                    if let Some(request) = label_request {
                        pending.atlas_label_requests.insert(generation_key, request);
                        enqueued = true;
                    }
                }
                (
                    building,
                    label_building,
                    pending.atlas_requests.contains_key(&generation_key),
                    pending.atlas_label_requests.contains_key(&generation_key),
                    enqueued,
                )
            })?;
        if enqueued {
            self.work_queue.request_wake()?;
        }
        if let Some(mut response) = published.take() {
            let now = current_time_millis()?;
            apply_opening_activity(&mut response.nodes, &activity_by_note_id, now);
            response.status = "ready".to_string();
            response.stale = !compatible;
            response.publish_in_progress = building || queued || label_building || label_queued;
            return Ok(response);
        }
        let mut response =
            empty_atlas("building", "Atlas is building in the background.", revision)?;
        response.publish_in_progress = true;
        Ok(response)
    }
}

#[cfg(test)]
#[path = "publication_tests.rs"]
mod tests;
