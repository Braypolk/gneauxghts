//! Versioned, bounded preprocessing shared by indexed images and query images.
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader};
use std::io::Cursor;

pub(super) const POLICY: &str = "png-jpeg-staticwebp-exif-white-v1";
pub(crate) const MAX_ENCODED_BYTES: usize = 20 * 1024 * 1024;

pub(super) fn decode(bytes: &[u8]) -> Result<image::RgbImage, String> {
    if bytes.is_empty() || bytes.len() > MAX_ENCODED_BYTES {
        return Err("Image must be nonempty and smaller than 20 MiB.".into());
    }
    let format =
        image::guess_format(bytes).map_err(|_| "Image is not a valid PNG, JPEG or static WebP.")?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err("[unsupported] Image search supports PNG, JPEG and static WebP.".into());
    }
    if animated(bytes, format)? {
        return Err("[unsupported] Animated images are not supported for image search.".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| format!("Could not decode image: {e}"))?;
    let (width, height) = decoder.dimensions();
    if u64::from(width) * u64::from(height) > 8_000_000 {
        return Err("Image exceeds the 8-megapixel search limit.".into());
    }
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    image.apply_orientation(orientation);
    let rgba = image.to_rgba8();
    drop(image);
    let rgb = image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let p = rgba.get_pixel(x, y).0;
        let alpha = u16::from(p[3]);
        image::Rgb(
            [0, 1, 2].map(|i| ((u16::from(p[i]) * alpha + 255 * (255 - alpha) + 127) / 255) as u8),
        )
    });
    drop(rgba);
    Ok(rgb)
}

pub(super) fn prepare(bytes: &[u8]) -> Result<Vec<u8>, String> {
    encode(&decode(bytes)?)
}

pub(crate) fn thumbnail(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let rgb = DynamicImage::ImageRgb8(decode(bytes)?)
        .thumbnail(160, 128)
        .to_rgb8();
    encode(&rgb)
}

fn encode(rgb: &image::RgbImage) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new_with_quality(
        &mut png,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::NoFilter,
    );
    use image::ImageEncoder;
    encoder
        .write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| e.to_string())?;
    Ok(png)
}

// Inspect container chunk headers, never coincidental bytes inside compressed pixels.
fn animated(bytes: &[u8], format: ImageFormat) -> Result<bool, String> {
    let (mut at, header, pad) = match format {
        ImageFormat::Png => (8usize, 12usize, false),
        ImageFormat::WebP => (12usize, 8usize, true),
        _ => return Ok(false),
    };
    while at.checked_add(header).is_some_and(|end| end <= bytes.len()) {
        let (name, len) = if pad {
            (
                &bytes[at..at + 4],
                u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize,
            )
        } else {
            (
                &bytes[at + 4..at + 8],
                u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize,
            )
        };
        if name == b"acTL" || name == b"ANIM" || name == b"ANMF" {
            return Ok(true);
        }
        at = at
            .checked_add(header)
            .and_then(|a| a.checked_add(len))
            .and_then(|a| a.checked_add(if pad { len % 2 } else { 0 }))
            .ok_or("Invalid image chunk length")?;
        if at > bytes.len() {
            return Err("Truncated image chunk".into());
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn animation_detection_checks_chunk_names_and_thumbnails_are_bounded() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend(4u32.to_be_bytes());
        png.extend(b"tEXtacTL");
        png.extend([0; 4]);
        assert!(!animated(&png, ImageFormat::Png).unwrap());
        png[12..16].copy_from_slice(b"acTL");
        assert!(animated(&png, ImageFormat::Png).unwrap());
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(image::RgbImage::new(400, 300))
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        let small = image::load_from_memory(&thumbnail(encoded.get_ref()).unwrap()).unwrap();
        assert!(small.width() <= 160 && small.height() <= 128);
    }
    #[test]
    fn transparent_input_uses_white_and_unsupported_or_corrupt_inputs_fail() {
        let mut png = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            2,
            2,
            image::Rgba([0, 0, 0, 0]),
        ))
        .write_to(&mut png, ImageFormat::Png)
        .unwrap();
        let prepared = prepare(png.get_ref()).unwrap();
        assert_eq!(
            image::load_from_memory(&prepared)
                .unwrap()
                .to_rgb8()
                .get_pixel(0, 0)
                .0,
            [255, 255, 255]
        );
        assert!(prepare(b"corrupt").is_err());
        assert!(prepare(b"GIF89a").is_err());
    }
}
