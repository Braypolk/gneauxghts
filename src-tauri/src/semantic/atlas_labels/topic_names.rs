//! Readable one-word cloud topics using cached local embeddings.
//! Inspired by topic representations: note-level term coverage, representative
//! content, readable umbrella candidates and joint assignment among siblings.
use super::*;

// A general, explicit vocabulary lets embeddings select umbrella concepts that
// are absent from the prose. This is deliberately inspectable, not generated.
pub(super) const TOPIC_NOUNS: &str = "academia adventure agriculture analytics applications architecture art astronomy athletics automation banking biology books business careers cars chemistry childhood cinema clients climate clothing coding collaboration commerce communication community computing conservation consulting cooking creativity culture cybersecurity data design development devops education electronics energy engineering entertainment entrepreneurship environment ethics family farming fashion fiction finance fitness food friendships gaming gardening geography government hardware health history hobbies housing humor infrastructure integration intelligence investing journalism language law leadership learning literature logistics love management marketing mathematics medicine meetings memories mentoring monitoring music nature networking nutrition operations parenting philosophy photography physics planning poetry politics productivity products projects psychology recruiting relationships religion reporting research retirement robotics roleplaying romance sales science security shopping software spirituality sports strategy support systems teaching technology theology training transportation travel vehicles volunteering weddings wellbeing workflows writing";
const NON_TOPICS: &str = "able actually almost already always anything around available away back based best better big call called come coming complete completed current daily day days done down enough even example examples existing feel find found getting give given going good got great help high include including information item items keep last later less like likely little look looking lot made make makes making many might must new next note notes now often okay old open part parts please point possible probably put really right said say says second see seen set show simple simply since small start started still sure take taken tell text think time times today together tomorrow try trying two update updates updated used useful uses using value values way ways week weeks well went work works working yes yet yesterday able needs needed wants wanted";

// Disambiguate broad or overloaded names in the embedding space while keeping
// the displayed label one word. These definitions are general, not vault-specific.
fn embedding_text(label: &str) -> &str {
    match label {
        "adventure" => "Outdoor adventures, hiking, camping, exploring nature and national parks",
        "analytics" => "Data analytics, metrics, dashboards, trends and business insights",
        "automation" => "Automating repetitive work, workflows, bots and integrations",
        "cars" => "Cars, car ownership, maintenance, buying and selling vehicles",
        "consulting" => {
            "Consulting engagements, client visits, discovery and business recommendations"
        }
        "design" => "Designing products, interfaces, visual layouts and user experiences",
        "devops" => "Software deployment, testing, containers, Kubernetes and cloud infrastructure",
        "food" => "Food, groceries, meals, snacks and eating",
        "gaming" => "Video games, game mechanics, game ideas and playing games",
        "geography" => "Geography, maps, countries, physical landscapes and the study of places",
        "intelligence" => {
            "Artificial intelligence, language models, machine learning and AI applications"
        }
        "love" => "Love, affection, romantic relationships and letters to a partner",
        "meetings" => "Meetings, agendas, discussion notes, one-on-ones and follow-up actions",
        "photography" => "Taking photographs, cameras, lenses, composition and editing photos",
        "products" => {
            "Product requirements, customer feedback, feature requests, bugs and product roadmaps"
        }
        "productivity" => "Personal productivity, to-do lists, organizing work and daily tasks",
        "projects" => "Projects, project plans, task lists, milestones and tracking progress",
        "recruiting" => {
            "Recruiting, hiring, candidates, interviews, onboarding and talent sourcing"
        }
        "relationships" => {
            "Personal relationships, partners, friendships, family and shared experiences"
        }
        "reporting" => {
            "Business reporting, reports, summaries, financial results and performance updates"
        }
        "roleplaying" => {
            "Tabletop roleplaying games, Dungeons and Dragons, characters, campaigns and dice"
        }
        "security" => {
            "Information security, cybersecurity, access controls, threats and risk assessments"
        }
        "systems" => {
            "Business systems, application architecture, integrations and information flows"
        }
        "theology" => "Theology, biblical studies, scripture, religious beliefs and interpretation",
        "training" => "Training, employee learning, skill development, instruction and practice",
        "travel" => "Travel plans, trips, itineraries, vacations, destinations and travel journals",
        _ => label,
    }
}

#[derive(Default)]
struct Evidence {
    notes: usize,
    titles: usize,
    tags: usize,
}
struct Topic {
    id: String,
    parent: Option<String>,
    displayed_name: Option<String>,
    centroid: Vec<f32>,
    terms: HashMap<String, Evidence>,
    members: usize,
    selected_chunks: usize,
    candidates: Vec<String>,
}

fn tokens(text: &str) -> HashSet<String> {
    sanitize_label_text(text)
        .split_whitespace()
        .map(|word| word.to_lowercase())
        .filter(|word| {
            word.chars().all(char::is_alphabetic)
                && is_candidate_token(word)
                && !is_function_word(word)
                && !NON_TOPICS
                    .split_whitespace()
                    .any(|excluded| excluded == word)
        })
        .collect()
}

fn prepare_topic(
    cloud: &AtlasCloud,
    notes: &HashMap<String, AtlasLabelNote>,
    chunks: &HashMap<String, Vec<AtlasLabelChunk>>,
) -> Topic {
    let members = cloud
        .member_node_ids
        .iter()
        .filter_map(|id| notes.get(id))
        .collect::<Vec<_>>();
    let centroid = cloud_centroid(&members);
    let mut terms = HashMap::<String, Evidence>::new();
    let mut selected_chunks = 0;
    // Every member supplies evidence. Each note has the same chunk allowance,
    // so a long central note cannot displace the rest of the cloud.
    for note in &members {
        let title_terms = tokens(&note.title);
        let tag_terms = note
            .tags
            .iter()
            .flat_map(|tag| tokens(tag))
            .collect::<HashSet<_>>();
        let mut note_terms = title_terms
            .union(&tag_terms)
            .cloned()
            .collect::<HashSet<_>>();
        let mut ranked = chunks
            .get(&note.id)
            .into_iter()
            .flatten()
            .filter(|chunk| !chunk.section_label.eq_ignore_ascii_case("Title"))
            .map(|chunk| (cosine_similarity(&centroid, &chunk.embedding), chunk))
            .collect::<Vec<_>>();
        ranked.sort_by(|a, b| {
            b.0.total_cmp(&a.0)
                .then_with(|| a.1.ordinal.cmp(&b.1.ordinal))
        });
        for (_, chunk) in ranked.into_iter().take(2) {
            selected_chunks += 1;
            if !is_generic_section_label(&chunk.section_label) {
                note_terms.extend(tokens(&chunk.section_label));
            }
            note_terms.extend(tokens(&chunk.text));
        }
        for term in note_terms {
            let evidence = terms.entry(term.clone()).or_default();
            evidence.notes += 1;
            evidence.titles += usize::from(title_terms.contains(&term));
            evidence.tags += usize::from(tag_terms.contains(&term));
        }
    }
    // Name the broad topic, rather than promoting arbitrary prose tokens into
    // labels. Widely authored tags can extend the vocabulary with custom names.
    // This intentionally trades open vocabulary for readable one-word categories.
    let mut candidates = TOPIC_NOUNS
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    candidates.extend(
        terms
            .iter()
            .filter(|(_, evidence)| evidence.tags * 4 >= members.len().max(1))
            .map(|(term, _)| term.clone()),
    );
    candidates.sort();
    candidates.dedup();
    Topic {
        id: cloud.id.clone(),
        parent: cloud.parent_id.clone(),
        displayed_name: cloud.user_name.clone().or_else(|| {
            (cloud.label_source != "pending")
                .then(|| cloud.label.clone())
                .flatten()
        }),
        centroid,
        terms,
        members: members.len(),
        selected_chunks,
        candidates,
    }
}

pub(crate) fn generate_labels_progressive<F>(
    connection: &mut Connection,
    provider: &(dyn EmbeddingProvider + Sync),
    clouds: &[AtlasCloud],
    nodes: &[AtlasNode],
    note_embeddings: &HashMap<String, Vec<f32>>,
    mut publish: F,
) -> Result<(HashMap<String, CloudLabelAssignment>, LabelPipelineMetrics), String>
where
    F: FnMut(&str, &CloudLabelAssignment) -> Result<(), String>,
{
    let notes = nodes
        .iter()
        .filter_map(|node| {
            note_embeddings.get(&node.id).map(|embedding| {
                (
                    node.id.clone(),
                    AtlasLabelNote {
                        id: node.id.clone(),
                        title: node.title.clone(),
                        tags: node.tags.clone(),
                        embedding: embedding.clone(),
                    },
                )
            })
        })
        .collect::<HashMap<_, _>>();
    let mut paths = notes.keys().cloned().collect::<Vec<_>>();
    paths.sort();
    let chunks = load_chunks_for_note_paths(connection, &paths)?;
    let mut topics = clouds
        .par_iter()
        .map(|cloud| prepare_topic(cloud, &notes, &chunks))
        .collect::<Vec<_>>();
    topics.sort_by(|a, b| a.id.cmp(&b.id));
    let children = topics
        .iter()
        .map(|topic| {
            topics
                .iter()
                .enumerate()
                .filter_map(|(i, child)| (child.parent.as_ref() == Some(&topic.id)).then_some(i))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let depths = topics
        .iter()
        .map(|topic| {
            let mut depth = 0;
            let mut parent = topic.parent.as_ref();
            while let Some(ancestor) = parent.and_then(|id| topics.iter().find(|t| &t.id == id)) {
                depth += 1;
                if depth >= topics.len() {
                    break;
                }
                parent = ancestor.parent.as_ref();
            }
            depth
        })
        .collect::<Vec<_>>();
    let mut unique = topics
        .iter()
        .flat_map(|topic| topic.candidates.iter().cloned())
        .collect::<Vec<_>>();
    unique.sort();
    unique.dedup();
    let fingerprint = model_cache_fingerprint(provider);
    let mut embeddings =
        load_atlas_label_embeddings(connection, &unique, &fingerprint, LABEL_ALGORITHM_VERSION)?;
    let dimensions = provider.model_info().dimensions;
    embeddings.retain(|_, vector| valid_embedding(vector, dimensions));
    let cache_hits = embeddings.len();
    let missing = unique
        .iter()
        .filter(|word| !embeddings.contains_key(*word))
        .cloned()
        .collect::<Vec<_>>();
    for batch in missing.chunks(EMBEDDING_BATCH_SIZE) {
        let texts = batch
            .iter()
            .map(|word| embedding_text(word).to_string())
            .collect::<Vec<_>>();
        let vectors = provider.embed_texts(&texts, EmbeddingInputKind::Document)?;
        if vectors.len() != batch.len() {
            return Err("Atlas topic naming received an unexpected embedding count".into());
        }
        if vectors
            .iter()
            .any(|vector| !valid_embedding(vector, dimensions))
        {
            return Err("Atlas topic naming received an invalid embedding".into());
        }
        let rows = batch.iter().cloned().zip(vectors).collect::<Vec<_>>();
        save_atlas_label_embeddings(connection, &rows, &fingerprint, LABEL_ALGORITHM_VERSION)?;
        embeddings.extend(rows);
    }
    // Compute similarities once: competing-cloud comparison shares this matrix.
    let mut similarities = topics
        .iter()
        .map(|topic| {
            unique
                .iter()
                .map(|word| cosine_similarity(&topic.centroid, &embeddings[word]))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    // Each subtheme has an equal voice, regardless of note count. Reward words
    // that fit even the least similar child, rather than one dominant subcloud.
    let mut bottom_up = (0..topics.len()).collect::<Vec<_>>();
    bottom_up.sort_by_key(|i| std::cmp::Reverse(depths[*i]));
    for &i in &bottom_up {
        if children[i].is_empty() {
            continue;
        }
        for j in 0..unique.len() {
            let mean = children[i].iter().map(|k| similarities[*k][j]).sum::<f32>()
                / children[i].len() as f32;
            let minimum = children[i]
                .iter()
                .map(|k| similarities[*k][j])
                .fold(f32::INFINITY, f32::min);
            similarities[i][j] = (mean + minimum) * 0.5;
        }
    }
    let vocabulary = TOPIC_NOUNS.split_whitespace().collect::<HashSet<_>>();
    let mut scores = vec![vec![-10_000.0; unique.len()]; topics.len()];
    for (i, topic) in topics.iter().enumerate() {
        let candidates = topic.candidates.iter().collect::<HashSet<_>>();
        for (j, word) in unique.iter().enumerate() {
            if !candidates.contains(word) {
                continue;
            }
            let competitors = topics
                .iter()
                .enumerate()
                .filter(|(k, other)| *k != i && other.parent == topic.parent)
                .collect::<Vec<_>>();
            let competing_similarity = competitors
                .iter()
                .map(|(k, _)| similarities[*k][j])
                .fold(0.0_f32, f32::max);
            let evidence = topic.terms.get(word);
            let coverage = evidence.map_or(0.0, |e| e.notes as f32 / topic.members.max(1) as f32);
            let title_coverage =
                evidence.map_or(0.0, |e| e.titles as f32 / topic.members.max(1) as f32);
            let tag_coverage =
                evidence.map_or(0.0, |e| e.tags as f32 / topic.members.max(1) as f32);
            let other_members = competitors
                .iter()
                .map(|(_, other)| other.members)
                .sum::<usize>();
            let other_support = competitors
                .iter()
                .filter_map(|(_, other)| other.terms.get(word))
                .map(|e| e.notes)
                .sum::<usize>();
            let contrast = (coverage - other_support as f32 / other_members.max(1) as f32).max(0.0);
            let lexical_support = if children[i].is_empty() {
                coverage * 0.12 + title_coverage * 0.10 + tag_coverage * 0.08 + contrast * 0.08
            } else {
                // Note-level frequency must not reintroduce the largest-child bias.
                0.0
            };
            scores[i][j] = similarities[i][j] - competing_similarity * 0.65
                + lexical_support
                + if vocabulary.contains(word.as_str()) {
                    0.035
                } else {
                    0.0
                };
        }
    }
    // Assign siblings together, children before parents. Reserve descendant
    // names so the broader region receives a distinct umbrella word.
    let mut parents = topics
        .iter()
        .map(|topic| topic.parent.clone())
        .collect::<Vec<_>>();
    parents.sort_by_key(|parent| {
        let depth = parent
            .as_ref()
            .and_then(|id| topics.iter().position(|topic| &topic.id == id))
            .map_or(0, |i| depths[i] + 1);
        (std::cmp::Reverse(depth), parent.clone())
    });
    parents.dedup();
    let mut labels = HashMap::new();
    let mut reserved = vec![HashSet::<String>::new(); topics.len()];
    for parent in parents {
        let indices = topics
            .iter()
            .enumerate()
            .filter_map(|(i, topic)| (topic.parent == parent).then_some(i))
            .collect::<Vec<_>>();
        for &i in &indices {
            reserved[i] = children[i]
                .iter()
                .flat_map(|k| reserved[*k].iter().cloned())
                .collect();
            for (j, word) in unique.iter().enumerate() {
                if reserved[i].contains(word) && topics[i].candidates.contains(word) {
                    // Exhausted vocabularies can reuse words; ordinary families
                    // always prefer an unused, readable theme.
                    scores[i][j] -= 1_000.0;
                }
            }
        }
        let selected = maximum_assignment(
            &indices
                .iter()
                .map(|i| scores[*i].clone())
                .collect::<Vec<_>>(),
        );
        for (i, mut j) in indices.into_iter().zip(selected) {
            if !topics[i].candidates.contains(&unique[j]) {
                // Other families may contribute custom tags to the shared matrix.
                // If a group exhausts its own candidates, reuse its best readable
                // topic rather than assigning a tag belonging to another family.
                j = scores[i]
                    .iter()
                    .enumerate()
                    .max_by(|(a, left), (b, right)| left.total_cmp(right).then_with(|| b.cmp(a)))
                    .map(|(index, _)| index)
                    .expect("topic vocabulary is nonempty");
            }
            let assignment = CloudLabelAssignment {
                label: unique[j].clone(),
                confidence: scores[i][j],
                source: CloudLabelSource::Topic,
            };
            reserved[i].insert(assignment.label.to_lowercase());
            if let Some(name) = &topics[i].displayed_name {
                reserved[i].insert(name.trim().to_lowercase());
            }
            labels.insert(topics[i].id.clone(), assignment);
        }
    }
    // Publish deterministically through the existing generation/supersession seam.
    for topic in &topics {
        publish(&topic.id, &labels[&topic.id])?;
    }
    let metrics = LabelPipelineMetrics {
        cloud_count: clouds.len(),
        candidate_count: topics.iter().map(|topic| topic.candidates.len()).sum(),
        unique_candidate_count: unique.len(),
        chunk_count: chunks.values().map(Vec::len).sum(),
        selected_chunk_count: topics.iter().map(|topic| topic.selected_chunks).sum(),
        cache_hit_count: cache_hits,
        provider_text_count: missing.len(),
        provider_batch_count: missing.chunks(EMBEDDING_BATCH_SIZE).len(),
        topic_label_count: labels.len(),
    };
    Ok((labels, metrics))
}

fn valid_embedding(vector: &[f32], dimensions: usize) -> bool {
    dimensions > 0
        && vector.len() == dimensions
        && vector.iter().all(|value| value.is_finite())
        && vector.iter().any(|value| *value != 0.0)
}

// Rectangular Hungarian assignment. Input columns are sorted words, rows sorted
// cloud IDs: ties are deterministic. Large groups reuse words only when needed.
fn maximum_assignment(scores: &[Vec<f32>]) -> Vec<usize> {
    if scores.is_empty() {
        return Vec::new();
    }
    let n = scores.len();
    let m = scores[0].len();
    assert!(m > 0 && scores.iter().all(|row| row.len() == m));
    if n > m {
        // More siblings than words cannot all have distinct one-word names.
        // Penalized extra slots use the entire vocabulary before reusing a name.
        let expanded = scores
            .iter()
            .map(|row| {
                (0..n.div_ceil(m) * m)
                    .map(|j| row[j % m] - 1_000.0 * (j / m) as f32)
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        return maximum_assignment(&expanded)
            .into_iter()
            .map(|j| j % m)
            .collect();
    }
    let mut u = vec![0.0_f64; n + 1];
    let mut v = vec![0.0_f64; m + 1];
    let mut matched = vec![0_usize; m + 1];
    let mut previous = vec![0_usize; m + 1];
    for i in 1..=n {
        matched[0] = i;
        let mut column = 0;
        let mut minimum = vec![f64::INFINITY; m + 1];
        let mut used = vec![false; m + 1];
        loop {
            used[column] = true;
            let row = matched[column];
            let mut delta = f64::INFINITY;
            let mut next = 0;
            for j in 1..=m {
                if used[j] {
                    continue;
                }
                let cost = -f64::from(scores[row - 1][j - 1]) - u[row] - v[j];
                if cost < minimum[j] {
                    minimum[j] = cost;
                    previous[j] = column;
                }
                if minimum[j] < delta {
                    delta = minimum[j];
                    next = j;
                }
            }
            for j in 0..=m {
                if used[j] {
                    u[matched[j]] += delta;
                    v[j] -= delta;
                } else {
                    minimum[j] -= delta;
                }
            }
            column = next;
            if matched[column] == 0 {
                break;
            }
        }
        loop {
            let next = previous[column];
            matched[column] = matched[next];
            column = next;
            if column == 0 {
                break;
            }
        }
    }
    let mut assignment = vec![0; n];
    for j in 1..=m {
        if matched[j] > 0 {
            assignment[matched[j] - 1] = j - 1;
        }
    }
    assignment
}

#[cfg(test)]
#[test]
fn allocates_contested_name_to_cloud_that_needs_it_most() {
    // First cloud has an excellent alternative; second has a poor one.
    assert_eq!(
        maximum_assignment(&[vec![0.9, 0.85, 0.1], vec![0.89, 0.1, 0.2]]),
        vec![1, 0]
    );
}
#[cfg(test)]
#[test]
fn readable_candidates_exclude_markup_filler_and_keep_topics() {
    let words = tokens("## Today items: using **security** and [gardening](https://example.com)");
    assert!(words.contains("security") && words.contains("gardening"));
    assert!(!words.contains("today") && !words.contains("items") && !words.contains("using"));
}

#[cfg(test)]
#[test]
fn large_sibling_groups_reuse_readable_words_without_panicking() {
    let selected = maximum_assignment(&[vec![0.9, 0.1], vec![0.8, 0.2], vec![0.7, 0.3]]);
    assert_eq!(selected.len(), 3);
    assert_eq!(selected.iter().copied().collect::<HashSet<_>>().len(), 2);
}

#[cfg(test)]
#[test]
fn widely_authored_tags_extend_topics_but_prose_does_not() {
    let notes = HashMap::from([
        (
            "a".into(),
            AtlasLabelNote {
                id: "a".into(),
                title: "Bespoke filler".into(),
                tags: vec!["Mycology".into()],
                embedding: vec![1.0, 0.0],
            },
        ),
        (
            "b".into(),
            AtlasLabelNote {
                id: "b".into(),
                title: "Bespoke filler".into(),
                tags: vec![],
                embedding: vec![1.0, 0.0],
            },
        ),
    ]);
    let mut cloud = super::tests::cloud(&["a", "b"]);
    let topic = prepare_topic(&cloud, &notes, &HashMap::new());
    assert!(topic.candidates.iter().any(|word| word == "mycology"));
    assert!(!topic.candidates.iter().any(|word| word == "bespoke"));
    // A tag from a removed member cannot continue naming this cloud.
    cloud.member_node_ids = vec!["b".into()];
    let topic = prepare_topic(&cloud, &notes, &HashMap::new());
    assert!(!topic.candidates.iter().any(|word| word == "mycology"));
}
