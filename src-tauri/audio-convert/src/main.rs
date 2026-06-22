use std::{
    env,
    error::Error,
    fs::File,
    path::{Path, PathBuf},
};

use symphonia::core::{
    audio::{AudioBufferRef, Signal, SignalSpec},
    codecs::{DecoderOptions, CODEC_TYPE_NULL},
    conv::FromSample,
    errors::Error as SymphoniaError,
    formats::FormatOptions,
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
};

const OUTPUT_SAMPLE_RATE: u32 = 16_000;

struct Args {
    input: PathBuf,
    output_dir: PathBuf,
    label: String,
    chunk_seconds: u32,
}

struct ChunkWriter {
    output_dir: PathBuf,
    label: String,
    chunk_samples: u64,
    chunk_index: u32,
    samples_in_chunk: u64,
    writer: Option<hound::WavWriter<std::io::BufWriter<File>>>,
    paths: Vec<PathBuf>,
}

impl ChunkWriter {
    fn new(output_dir: PathBuf, label: String, chunk_seconds: u32) -> Self {
        Self {
            output_dir,
            label,
            chunk_samples: u64::from(chunk_seconds.max(1)) * u64::from(OUTPUT_SAMPLE_RATE),
            chunk_index: 0,
            samples_in_chunk: 0,
            writer: None,
            paths: Vec::new(),
        }
    }

    fn ensure_writer(&mut self) -> Result<(), Box<dyn Error>> {
        if self.writer.is_some() {
            return Ok(());
        }
        std::fs::create_dir_all(&self.output_dir)?;
        let path = self
            .output_dir
            .join(format!("{}-part-{:03}.wav", self.label, self.chunk_index));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: OUTPUT_SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        self.writer = Some(hound::WavWriter::create(&path, spec)?);
        self.paths.push(path);
        Ok(())
    }

    fn write_sample(&mut self, sample: f32) -> Result<(), Box<dyn Error>> {
        self.ensure_writer()?;
        let clamped = sample.clamp(-1.0, 1.0);
        let value = (clamped * f32::from(i16::MAX)).round() as i16;
        if let Some(writer) = self.writer.as_mut() {
            writer.write_sample(value)?;
        }
        self.samples_in_chunk += 1;
        if self.samples_in_chunk >= self.chunk_samples {
            self.finish_current()?;
            self.chunk_index += 1;
            self.samples_in_chunk = 0;
        }
        Ok(())
    }

    fn finish_current(&mut self) -> Result<(), Box<dyn Error>> {
        if let Some(writer) = self.writer.take() {
            writer.finalize()?;
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<PathBuf>, Box<dyn Error>> {
        self.finish_current()?;
        Ok(self.paths)
    }
}

struct LinearResampler {
    input_rate: u32,
    step: f64,
    position: f64,
    pending: Vec<f32>,
}

impl LinearResampler {
    fn new(input_rate: u32) -> Self {
        Self {
            input_rate,
            step: f64::from(input_rate) / f64::from(OUTPUT_SAMPLE_RATE),
            position: 0.0,
            pending: Vec::new(),
        }
    }

    fn push(
        &mut self,
        samples: &[f32],
        writer: &mut ChunkWriter,
    ) -> Result<(), Box<dyn Error>> {
        self.pending.extend_from_slice(samples);
        while self.position + 1.0 < self.pending.len() as f64 {
            let base = self.position.floor() as usize;
            let frac = (self.position - base as f64) as f32;
            let sample = self.pending[base] * (1.0 - frac) + self.pending[base + 1] * frac;
            writer.write_sample(sample)?;
            self.position += self.step;
        }
        let drop_count = self.position.floor().max(1.0) as usize - 1;
        if drop_count > 0 {
            self.pending.drain(0..drop_count);
            self.position -= drop_count as f64;
        }
        Ok(())
    }

    fn finish(&mut self, writer: &mut ChunkWriter) -> Result<(), Box<dyn Error>> {
        while self.position < self.pending.len() as f64 {
            let index = self.position.floor() as usize;
            if let Some(sample) = self.pending.get(index) {
                writer.write_sample(*sample)?;
            }
            self.position += self.step;
        }
        Ok(())
    }
}

fn parse_args() -> Result<Args, Box<dyn Error>> {
    let mut input = None;
    let mut output_dir = None;
    let mut label = None;
    let mut chunk_seconds = 600;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--input" => input = args.next().map(PathBuf::from),
            "--output-dir" => output_dir = args.next().map(PathBuf::from),
            "--label" => label = args.next(),
            "--chunk-seconds" => {
                chunk_seconds = args
                    .next()
                    .ok_or("missing --chunk-seconds value")?
                    .parse::<u32>()?;
            }
            "--help" | "-h" => {
                println!(
                    "Usage: pillar-audio-convert --input FILE --output-dir DIR --label LABEL [--chunk-seconds 600]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}").into()),
        }
    }

    Ok(Args {
        input: input.ok_or("missing --input")?,
        output_dir: output_dir.ok_or("missing --output-dir")?,
        label: label.ok_or("missing --label")?,
        chunk_seconds,
    })
}

fn hint_for_path(path: &Path) -> Hint {
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(extension);
    }
    hint
}

fn decode_to_mono_f32(decoded: AudioBufferRef<'_>) -> (SignalSpec, Vec<f32>) {
    let spec = *decoded.spec();
    let channels = spec.channels.count().max(1);
    let frames = decoded.frames();
    let mut mono = vec![0.0_f32; frames];

    macro_rules! mix {
        ($buffer:expr, $sample_type:ty) => {{
            for channel in 0..channels {
                let channel_samples = $buffer.chan(channel);
                for (frame, sample) in channel_samples.iter().enumerate().take(frames) {
                    mono[frame] += f32::from_sample(*sample) / channels as f32;
                }
            }
        }};
    }

    match decoded {
        AudioBufferRef::U8(buffer) => mix!(buffer, u8),
        AudioBufferRef::U16(buffer) => mix!(buffer, u16),
        AudioBufferRef::U24(buffer) => mix!(buffer, symphonia::core::sample::u24),
        AudioBufferRef::U32(buffer) => mix!(buffer, u32),
        AudioBufferRef::S8(buffer) => mix!(buffer, i8),
        AudioBufferRef::S16(buffer) => mix!(buffer, i16),
        AudioBufferRef::S24(buffer) => mix!(buffer, symphonia::core::sample::i24),
        AudioBufferRef::S32(buffer) => mix!(buffer, i32),
        AudioBufferRef::F32(buffer) => mix!(buffer, f32),
        AudioBufferRef::F64(buffer) => mix!(buffer, f64),
    }

    (spec, mono)
}

fn run() -> Result<Vec<PathBuf>, Box<dyn Error>> {
    let args = parse_args()?;
    let source = Box::new(File::open(&args.input)?);
    let mss = MediaSourceStream::new(source, Default::default());
    let probed = symphonia::default::get_probe().format(
        &hint_for_path(&args.input),
        mss,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("no supported audio track found")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())?;
    let mut chunk_writer = ChunkWriter::new(args.output_dir, args.label, args.chunk_seconds);
    let mut resampler: Option<LinearResampler> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::ResetRequired) => {
                return Err("audio stream reset is not supported".into());
            }
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(error) => return Err(Box::new(error)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                let (spec, mono) = decode_to_mono_f32(decoded);
                let active = resampler.get_or_insert_with(|| LinearResampler::new(spec.rate));
                if active.input_rate != spec.rate {
                    return Err("audio sample-rate changes mid-stream are not supported".into());
                }
                active.push(&mono, &mut chunk_writer)?;
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(Box::new(error)),
        }
    }

    if let Some(active) = resampler.as_mut() {
        active.finish(&mut chunk_writer)?;
    }

    chunk_writer.finish()
}

fn main() {
    match run() {
        Ok(paths) => {
            let rendered = paths
                .iter()
                .map(|path| format!("\"{}\"", path.display().to_string().replace('\\', "\\\\").replace('"', "\\\"")))
                .collect::<Vec<_>>()
                .join(",");
            println!("{{\"ok\":true,\"chunks\":[{}]}}", rendered);
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
