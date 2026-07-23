/**
 * Client-side video duration extraction utility
 * Extracts duration from video files before upload
 */

export async function extractVideoDuration(
  file: File,
): Promise<number | undefined> {
  try {
    // Primary method: Use HTML5 video element (most reliable)
    const videoDuration = await extractDurationUsingVideoElement(file);
    if (videoDuration !== undefined && Number.isFinite(videoDuration) && videoDuration > 0) {
      return videoDuration;
    }

    // Fallback: Try binary parsing for common formats
    const buffer = await file.arrayBuffer();
    const view = new Uint8Array(buffer);
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".webm") || fileName.endsWith(".ogg")) {
      const parsedWebm = extractWebMDuration(view);
      if (parsedWebm && Number.isFinite(parsedWebm) && parsedWebm > 0) {
        return parsedWebm;
      }
    } else {
      const parsedMp4 = extractMP4Duration(view);
      if (parsedMp4 && Number.isFinite(parsedMp4) && parsedMp4 > 0) {
        return parsedMp4;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract duration using HTML5 video element safely
 */
function extractDurationUsingVideoElement(
  file: File,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve(undefined);
      return;
    }

    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;

      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(undefined);
        }
      }, 3000);

      const cleanup = () => {
        clearTimeout(timeout);
        video.pause();
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      };

      video.onloadedmetadata = () => {
        if (!resolved) {
          resolved = true;
          const duration = Math.round(video.duration);
          cleanup();
          resolve(Number.isFinite(duration) && duration > 0 ? duration : undefined);
        }
      };

      video.onerror = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(undefined);
        }
      };

      video.src = url;
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Extract duration from MP4 file by reading the moov/mvhd atom
 */
function extractMP4Duration(data: Uint8Array): number | undefined {
  try {
    const moovIndex = findAtom(data, "moov");
    if (moovIndex === -1) return undefined;

    const mvhdIndex = findAtom(data, "mvhd", moovIndex);
    if (mvhdIndex === -1) return undefined;

    const version = data[mvhdIndex + 8];

    let timescaleOffset: number;
    let durationOffset: number;

    if (version === 1) {
      timescaleOffset = mvhdIndex + 28;
      durationOffset = mvhdIndex + 32;
    } else {
      timescaleOffset = mvhdIndex + 20;
      durationOffset = mvhdIndex + 24;
    }

    const timescale = readUInt32BE(data, timescaleOffset);
    const duration = readUInt32BE(data, durationOffset);

    if (timescale > 0 && duration > 0) {
      return Math.round(duration / timescale);
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract duration from WebM file by reading EBML header
 */
function extractWebMDuration(data: Uint8Array): number | undefined {
  try {
    for (let i = 0; i < data.length - 8; i++) {
      if (data[i] === 0x44 && data[i + 1] === 0x89) {
        const durationBytes = data.slice(i + 3, i + 11);
        const duration = readDoubleBE(durationBytes);
        return Math.round(duration / 1000);
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function findAtom(data: Uint8Array, atomName: string, startOffset = 0): number {
  const atomCode = new TextEncoder().encode(atomName);
  for (let i = startOffset; i < data.length - 4; i++) {
    if (
      data[i] === atomCode[0] &&
      data[i + 1] === atomCode[1] &&
      data[i + 2] === atomCode[2] &&
      data[i + 3] === atomCode[3]
    ) {
      return i;
    }
  }
  return -1;
}

function readUInt32BE(data: Uint8Array, offset: number): number {
  if (offset + 3 >= data.length) return 0;
  return (
    (data[offset] << 24) |
    (data[offset + 1] << 16) |
    (data[offset + 2] << 8) |
    data[offset + 3]
  );
}

function readDoubleBE(data: Uint8Array): number {
  if (data.length < 8) return 0;
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  return view.getFloat64(0, false);
}
