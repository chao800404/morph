/**
 * Client-side video duration extraction utility
 * Extracts duration from video files before upload
 * Uses HTML5 video element as primary method, falls back to binary parsing
 */

/**
 * Extract video duration from a video file
 * Supports all video formats that the browser can decode
 */
export async function extractVideoDuration(
  file: File,
): Promise<number | undefined> {
  try {
    // Primary method: Use HTML5 video element (most reliable)
    let videoDuration = await extractDurationUsingVideoElement(file);
    if (videoDuration !== undefined) {
      console.log(`Extracted duration for ${file.name}: ${videoDuration}s`);
      return videoDuration;
    }

    console.warn(
      `Could not extract duration for ${file.name} using video element`,
    );

    // Fallback: Try binary parsing for common formats
    const buffer = await file.arrayBuffer();
    const view = new Uint8Array(buffer);
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".webm") || fileName.endsWith(".ogg")) {
      videoDuration = extractWebMDuration(view);
      if (videoDuration) {
        console.log(
          `Extracted duration for ${file.name} using WebM parser: ${videoDuration}s`,
        );
        return videoDuration;
      }
    } else {
      // Try MP4/MOV format for other extensions
      videoDuration = extractMP4Duration(view);
      if (videoDuration) {
        console.log(
          `Extracted duration for ${file.name} using MP4 parser: ${videoDuration}s`,
        );
        return videoDuration;
      }
    }

    console.warn(
      `Could not extract duration for ${file.name} using any method`,
    );
    return undefined;
  } catch (error) {
    console.warn("Error extracting video duration:", error);
    return undefined;
  }
}

/**
 * Extract duration using HTML5 video element
 * This is the most reliable method as it uses the browser's native video decoder
 */
function extractDurationUsingVideoElement(
  file: File,
): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";

      let resolved = false;

      // Set a timeout to avoid hanging
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(undefined);
        }
      }, 5000); // 5 second timeout

      const cleanup = () => {
        clearTimeout(timeout);
        video.pause();
        video.src = "";
        video.onloadedmetadata = null;
        video.onerror = null;
        URL.revokeObjectURL(url);
      };

      video.onloadedmetadata = () => {
        if (!resolved) {
          resolved = true;
          const duration = Math.round(video.duration);
          cleanup();
          resolve(duration > 0 ? duration : undefined);
        }
      };

      video.onerror = () => {
        if (!resolved) {
          resolved = true;
          console.warn("Video element error:", video.error);
          cleanup();
          resolve(undefined);
        }
      };

      video.src = url;
    } catch (error) {
      console.warn("Error using video element:", error);
      resolve(undefined);
    }
  });
}

/**
 * Extract duration from MP4 file by reading the moov atom
 */
function extractMP4Duration(data: Uint8Array): number | undefined {
  try {
    // Look for 'moov' atom
    const moovIndex = findAtom(data, "moov");
    if (moovIndex === -1) return undefined;

    // Look for 'mvhd' atom inside moov
    const mvhdIndex = findAtom(data, "mvhd", moovIndex);
    if (mvhdIndex === -1) return undefined;

    // Read duration and timescale from mvhd
    // mvhd structure: 8 bytes header + version/flags (4 bytes) + creation time (4 bytes) + modification time (4 bytes) + timescale (4 bytes) + duration (4 bytes)
    const timescaleOffset = mvhdIndex + 20;
    const durationOffset = mvhdIndex + 24;

    const timescale = readUInt32BE(data, timescaleOffset);
    const duration = readUInt32BE(data, durationOffset);

    if (timescale > 0) {
      return Math.round(duration / timescale);
    }

    return undefined;
  } catch (error) {
    console.warn("Error extracting MP4 duration:", error);
    return undefined;
  }
}

/**
 * Extract duration from WebM file by reading the EBML header
 */
function extractWebMDuration(data: Uint8Array): number | undefined {
  try {
    // Look for 'Duration' element (0x44 0x89)
    for (let i = 0; i < data.length - 8; i++) {
      if (data[i] === 0x44 && data[i + 1] === 0x89) {
        // Read the duration value (8 bytes, big-endian double)
        const durationBytes = data.slice(i + 3, i + 11);
        const duration = readDoubleBE(durationBytes);
        return Math.round(duration / 1000); // Convert milliseconds to seconds
      }
    }
    return undefined;
  } catch (error) {
    console.warn("Error extracting WebM duration:", error);
    return undefined;
  }
}

/**
 * Find an atom in MP4 file by its 4-character code
 */
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

/**
 * Read a 32-bit big-endian unsigned integer
 */
function readUInt32BE(data: Uint8Array, offset: number): number {
  return (
    (data[offset] << 24) |
    (data[offset + 1] << 16) |
    (data[offset + 2] << 8) |
    data[offset + 3]
  );
}

/**
 * Read a 64-bit big-endian double
 */
function readDoubleBE(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  return view.getFloat64(0, false);
}
