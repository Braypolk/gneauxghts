> Future reference only. Audio weights may be downloaded with the projector, but audio implementation is outside the current text/image round.

# EmbeddingGemma 2 audio runtime feasibility

Verified 2026-10-06 against upstream commit `4fbc76dec51d0add466f0210855c0596589b60d4` and first-party model cards. Addendum to [runtime-research.md](runtime-research.md). Planning only: no model downloads, installs, or inference runs.

## Concrete request contract

The merged server routes accept structured media entries on `/v1/embeddings`, including audio; each entry yields one pooled, L2-normalized vector. This is an extension to the OpenAI embedding shape, rather than the standard API contract. Keep `--embeddings --pooling mean --mmproj MATCHING_PROJECTOR`. Use the same text GGUF and combined vision/audio projector already proposed for images. [Server README at the pinned upstream commit](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/server/README.md#post-v1embeddings-openai-compatible-embeddings-api).

```json
{
  "input": [{
    "content": [{
      "type": "input_audio",
      "input_audio": {
        "data": "data:audio/wav;base64,...",
        "format": "wav"
      }
    }]
  }],
  "encoding_format": "float"
}
```

`data` may contain raw base64 or a media data URI. The converter checks audio capability and inserts the media marker itself. `format` is ignored: actual bytes determine decoding. App-owned, validated local bytes should use this payload; avoid enabling the server's separate `file://` access or URL fetching. [Content converter and media loader](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/server/server-common.cpp).

Audio-only corpus segments and audio queries receive no task prefix. Text search queries retain `task: search result | query: ...`; text documents retain the document format. Google specifies mono 16 kHz audio, a 25-token/second rate, and a shared 8,192-token budget. The theoretical audio-only limit is about 327 seconds before accompanying text and special tokens. It is a model budget, not a safe application request size. Google reports speech and environmental-sound training and paired cross-modal data in one 768-dimensional space. [Google model card](https://huggingface.co/google/embeddinggemma-2#best-practices).

## Decoding, segmentation, and actual request limits

The byte decoder recognizes WAV (RIFF/WAVE), MP3 (ID3/MPEG sync), and FLAC. `miniaudio` requests float32 output with one channel at the encoder's sample rate, so runtime decoding performs downmix/resampling. This path does not establish AAC/M4A, OGG/Opus, or WebM support; additional app decoding would be required. It reads a whole decoded clip into memory, which is another reason to bound source size and duration before dispatch. [MTMD helper decoder](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/mtmd/mtmd-helper.cpp).

The EmbeddingGemma 2 converter inherits Gemma 4's `GEMMA4A` audio projector, not the separate `GEMMA4UA` raw-frame encoder. [Model conversion](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/conversion/gemma.py#L1055). Its preprocessor divides audio into chunks of at most 30 seconds, roughly 750 soft tokens for a full chunk. Short clips are **not padded to 30 seconds**: frame count follows actual samples, with local spectral padding and trimming. This internal split does not create separate searchable embeddings or timestamps. [Audio preprocessor](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/mtmd/mtmd-audio.cpp#L1101). The loader explicitly sets `audio_chunk_len = 0` (no fixed padding) and 16 kHz; two stride-2 convolutions reduce approximately 100 spectral frames/second to 25 output tokens/second. Thus a 15-second clip is approximately 375 audio tokens plus media markers/BOS, rather than 750. Confirm exact encoded counts in the runtime spike. [Audio metadata and output-token accounting](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/mtmd/clip.cpp#L1983).

Noncausal pooled embedding work cannot split its full request over transformer microbatches. The server rejects input exceeding `n_ubatch` or available slot context; increasing `--ctx-size` alone is insufficient. For example, a nominal 512-token microbatch does not accommodate 30 seconds at 25 tokens/second. Configure explicit batch/microbatch/context limits, count the actual encoded tokens and special-token overhead, and reject rather than silently truncate. [Request scheduling checks](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/server/server-context.cpp#L3395).

Recommended application policy, subject to measured runtime validation: index bounded 15-second segments with 2-second overlap, retain source-relative start/end timestamps, and return the strongest segment per asset/note rather than averaging an entire recording. Include decoding/resampling, segment duration, overlap, and encoder/runtime revisions in representation identity. Serialize background audio encoding, give interactive search priority, and cap decoded samples, request bytes, queued work, and timeouts. These are design recommendations, not upstream defaults.

## LiteRT alternative

The full 740M LiteRT bundle supports text, vision, and audio with on-demand modality loading and streamed audio. The documented CPU/GPU download is 485 MB; audio weights use mixed INT2/INT4/INT8 quantization. The table's 12-audio-soft-token signature does not imply a 12-token cap on a complete clip because streaming supports different lengths. A desktop bridge still needs source-level API verification and platform packaging. Google's MacBook Pro M5 results report text+audio at 314 ms CPU / 195 ms GPU for a 10-second clip, averaged over five iterations using the 128-text signature; these are not llama.cpp measurements or latency promises for this app. [LiteRT full-model card](https://huggingface.co/litert-community/embeddinggemma-2-740m-litert-lm).

## Remaining gates

- Run fixed WAV/MP3/FLAC, stereo, non-16-kHz, silence, malformed, and long-file fixtures against the exact packaged runtime and matching artifacts.
- Check that audio content affects the 768-dimensional finite normalized vector and compare against Google's reference; request acceptance is insufficient.
- Evaluate text→speech, text→environmental sound, audio→text, and audio→audio separately. Shared space makes them possible; no source checked establishes this app's quality or equal performance across all modality pairs. Treat image↔audio relevance as experimental until validated.
- Verify packaged runtime reports audio capability and quantify peak memory, cancellation latency, and interactive search contention. MTMD's audio initialization explicitly warns that audio remains experimental. [MTMD audio initialization](https://github.com/ggml-org/llama.cpp/blob/4fbc76d/tools/mtmd/mtmd.cpp#L928).
- Embeddings do not supply transcripts, speaker attribution, or exact spoken quotations. Retrieval results should expose a playable, timestamped source segment; transcription and agent audio evidence require separate contracts.
