//! The pinned LiteRT-LM 0.18 embedding C ABI. No Python interpreter is needed.
//! All native handles stay behind the provider mutex; buffers are copied before
//! their response is deleted, and the library outlives every handle.
use libloading::Library;
use std::{
    ffi::{c_char, c_void, CString},
    path::Path,
    ptr,
};

type Handle = *mut c_void;
macro_rules! api {
    ($($field:ident: $ty:ty => $symbol:literal),+ $(,)?) => {
        struct Api { $($field: $ty,)+ _library: Library }
        impl Api {
            unsafe fn load(path: &Path) -> Result<Self, String> {
                let library = Library::new(path).map_err(|e| format!("Could not load LiteRT: {e}"))?;
                $(let $field = *library.get::<$ty>(concat!($symbol, "\0").as_bytes())
                    .map_err(|e| format!("LiteRT 0.18 API is incomplete: {e}"))?;)+
                Ok(Self { $($field,)+ _library: library })
            }
        }
    }
}
api! {
    settings_create: unsafe extern "C" fn(*const c_char, *const c_char, *const c_char, *const c_char) -> Handle => "litert_lm_embedding_engine_settings_create",
    settings_delete: unsafe extern "C" fn(Handle) -> () => "litert_lm_embedding_engine_settings_delete",
    settings_cache: unsafe extern "C" fn(Handle, *const c_char) -> () => "litert_lm_embedding_engine_settings_set_cache_dir",
    settings_min: unsafe extern "C" fn(Handle, i32) -> () => "litert_lm_embedding_engine_settings_set_min_input_length",
    settings_max: unsafe extern "C" fn(Handle, i32) -> () => "litert_lm_embedding_engine_settings_set_max_input_length",
    settings_vision: unsafe extern "C" fn(Handle, i32) -> () => "litert_lm_embedding_engine_settings_set_vision_tokens_per_image",
    settings_threads: unsafe extern "C" fn(Handle, i32) -> () => "litert_lm_embedding_engine_settings_set_num_threads",
    engine_create: unsafe extern "C" fn(Handle) -> Handle => "litert_lm_embedding_engine_create",
    engine_delete: unsafe extern "C" fn(Handle) -> () => "litert_lm_embedding_engine_delete",
    options_create: unsafe extern "C" fn() -> Handle => "litert_lm_embedding_options_create",
    options_delete: unsafe extern "C" fn(Handle) -> () => "litert_lm_embedding_options_delete",
    options_normalize: unsafe extern "C" fn(Handle, bool) -> () => "litert_lm_embedding_options_set_normalize",
    options_special: unsafe extern "C" fn(Handle, bool) -> () => "litert_lm_embedding_options_set_insert_special_tokens",
    options_overflow: unsafe extern "C" fn(Handle, i32) -> () => "litert_lm_embedding_options_set_input_overflow_strategy",
    options_size: unsafe extern "C" fn(Handle, i32) -> () => "litert_lm_embedding_options_set_output_size",
    options_vision: unsafe extern "C" fn(Handle, i32) -> () => "litert_lm_embedding_options_set_vision_tokens_per_image",
    input_create: unsafe extern "C" fn(i32, *const u8, usize) -> Handle => "litert_lm_input_data_create",
    input_delete: unsafe extern "C" fn(Handle) -> () => "litert_lm_input_data_delete",
    compute: unsafe extern "C" fn(Handle, *const Handle, usize, Handle) -> Handle => "litert_lm_embedding_engine_compute_embedding",
    response_size: unsafe extern "C" fn(Handle) -> usize => "litert_lm_embedding_response_get_size",
    response_values: unsafe extern "C" fn(Handle) -> *const f32 => "litert_lm_embedding_response_get_values",
    response_delete: unsafe extern "C" fn(Handle) -> () => "litert_lm_embedding_response_delete",
}

pub(super) struct Engine {
    api: Api,
    engine: Handle,
}
pub(super) fn verify_library(path: &Path) -> Result<(), String> {
    unsafe { Api::load(path).map(|_| ()) }
}
// Engine calls and destruction are serialized by GemmaLiteRtEmbeddingProvider.
// The C API has no thread-affine contract; its own executors own device threads.
unsafe impl Send for Engine {}

impl Engine {
    #[cfg(test)]
    pub(super) fn new(
        library: &Path,
        model: &Path,
        cache: &Path,
        backend: &str,
        tokens: u16,
    ) -> Result<Self, String> {
        Self::new_with_vision(library, model, cache, backend, tokens, true)
    }
    pub(super) fn new_with_vision(
        library: &Path,
        model: &Path,
        cache: &Path,
        backend: &str,
        tokens: u16,
        vision: bool,
    ) -> Result<Self, String> {
        let model = CString::new(model.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let cache = CString::new(cache.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        let backend = CString::new(backend).map_err(|e| e.to_string())?;
        // SAFETY: signatures match the pinned 0.18 C ABI. All strings remain
        // alive through creation; settings and engine own their copied values.
        unsafe {
            let api = Api::load(library)?;
            let settings = (api.settings_create)(
                model.as_ptr(),
                backend.as_ptr(),
                if vision {
                    backend.as_ptr()
                } else {
                    ptr::null()
                },
                ptr::null(),
            );
            if settings.is_null() {
                return Err("Could not configure LiteRT embedding engine.".into());
            }
            (api.settings_cache)(settings, cache.as_ptr());
            (api.settings_min)(settings, 128);
            (api.settings_max)(settings, 1024);
            (api.settings_vision)(settings, i32::from(tokens));
            (api.settings_threads)(
                settings,
                std::thread::available_parallelism()
                    .map(|n| n.get() as i32)
                    .unwrap_or(4),
            );
            let engine = (api.engine_create)(settings);
            (api.settings_delete)(settings);
            if engine.is_null() {
                return Err("LiteRT embedding engine could not initialize.".into());
            }
            Ok(Self { api, engine })
        }
    }

    #[cfg(test)]
    pub(super) fn embed(
        &mut self,
        bytes: &[u8],
        image: bool,
        tokens: u16,
    ) -> Result<Vec<f32>, String> {
        self.embed_with_text(bytes, image, tokens, None)
    }
    pub(super) fn embed_with_text(
        &mut self,
        bytes: &[u8],
        image: bool,
        tokens: u16,
        text: Option<&str>,
    ) -> Result<Vec<f32>, String> {
        unsafe {
            let input =
                (self.api.input_create)(if image { 1 } else { 0 }, bytes.as_ptr(), bytes.len());
            if input.is_null() {
                return Err("Could not prepare embedding input.".into());
            }
            let mut inputs = vec![input];
            if let Some(text) = text {
                let context = (self.api.input_create)(0, text.as_ptr(), text.len());
                if context.is_null() {
                    (self.api.input_delete)(input);
                    return Err("Could not prepare image search text.".into());
                }
                inputs.push(context);
            }
            let options = (self.api.options_create)();
            if options.is_null() {
                for input in inputs {
                    (self.api.input_delete)(input);
                }
                return Err("Could not prepare embedding options.".into());
            }
            (self.api.options_normalize)(options, true);
            (self.api.options_special)(options, true);
            // Native chunk-and-average preserves all tokens in long remembered passages.
            (self.api.options_overflow)(options, 0);
            (self.api.options_size)(options, 768);
            (self.api.options_vision)(options, i32::from(tokens));
            let response = (self.api.compute)(self.engine, inputs.as_ptr(), inputs.len(), options);
            (self.api.options_delete)(options);
            for input in inputs {
                (self.api.input_delete)(input);
            }
            if response.is_null() {
                return Err("Could not embed input. It may exceed the 1,024-token limit or contain unsupported image data.".into());
            }
            let size = (self.api.response_size)(response);
            let values = (self.api.response_values)(response);
            let result = if size == 768 && !values.is_null() {
                let vector = std::slice::from_raw_parts(values, size).to_vec();
                validate_vector(&vector).map(|()| vector)
            } else {
                Err("LiteRT returned an invalid embedding shape.".into())
            };
            (self.api.response_delete)(response);
            result
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        unsafe {
            (self.api.engine_delete)(self.engine);
        }
    }
}

fn validate_vector(vector: &[f32]) -> Result<(), String> {
    let norm = vector
        .iter()
        .map(|v| f64::from(*v).powi(2))
        .sum::<f64>()
        .sqrt();
    if vector.len() != 768 || vector.iter().any(|v| !v.is_finite()) || (norm - 1.0).abs() > 0.002 {
        Err("LiteRT returned a non-finite or unnormalized embedding.".into())
    } else {
        Ok(())
    }
}
