import { checkAbort, DataError } from "./errors.js";

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function readLimited(stream, limit, signal) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  const abort = () => reader.cancel(signal.reason).catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      checkAbort(signal);
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new DataError(
          "An XLSX archive entry expands beyond the import size limit.",
          "data-limit",
        );
      }
      chunks.push(value);
    }
    checkAbort(signal);
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Read-only ZIP container with bounded, lazy decompression and CRC validation. */
export function openZip(
  buffer,
  {
    maxEntries = 10_000,
    maxEntryBytes = 64 * 1024 * 1024,
    maxTotalBytes = 128 * 1024 * 1024,
    signal,
  } = {},
) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bound = (offset, length) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > bytes.length
    )
      throw new DataError(
        "The XLSX ZIP archive is truncated or corrupt.",
        "invalid-xlsx",
      );
  };
  const u16 = (offset) => {
    bound(offset, 2);
    return view.getUint16(offset, true);
  };
  const u32 = (offset) => {
    bound(offset, 4);
    return view.getUint32(offset, true);
  };
  let end = -1;
  for (
    let index = bytes.length - 22, minimum = Math.max(0, bytes.length - 65_557);
    index >= minimum;
    index--
  ) {
    if (
      u32(index) === 0x06054b50 &&
      index + 22 + u16(index + 20) === bytes.length
    ) {
      end = index;
      break;
    }
  }
  if (end < 0)
    throw new DataError(
      "This is not a readable XLSX ZIP archive. Older .xls and password-protected workbooks are not supported.",
      "invalid-xlsx",
    );
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
    throw new DataError(
      "Multipart ZIP archives are not supported.",
      "unsupported-xlsx",
    );
  const count = u16(end + 10);
  const centralSize = u32(end + 12);
  const centralOffset = u32(end + 16);
  if (
    count === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  )
    throw new DataError(
      "ZIP64 workbooks are not supported. Export the needed worksheet as CSV.",
      "unsupported-xlsx",
    );
  if (count > maxEntries)
    throw new DataError(
      `This workbook contains more than ${maxEntries.toLocaleString()} archive entries.`,
      "data-limit",
    );
  bound(centralOffset, centralSize);
  if (centralOffset + centralSize > end)
    throw new DataError(
      "The XLSX central directory overlaps the archive footer.",
      "invalid-xlsx",
    );
  const entries = new Map();
  const decoder = new TextDecoder("utf-8");
  let position = centralOffset;
  for (let index = 0; index < count; index++) {
    checkAbort(signal);
    bound(position, 46);
    if (u32(position) !== 0x02014b50)
      throw new DataError(
        "The XLSX ZIP directory contains an invalid entry.",
        "invalid-xlsx",
      );
    const nameLength = u16(position + 28);
    const extraLength = u16(position + 30);
    const commentLength = u16(position + 32);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    bound(position, recordLength);
    const name = decoder.decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    if (entries.has(name))
      throw new DataError(
        `The workbook has duplicate ZIP entry ${name}.`,
        "invalid-xlsx",
      );
    const entry = {
      name,
      flags: u16(position + 8),
      method: u16(position + 10),
      crc: u32(position + 16),
      compressedSize: u32(position + 20),
      size: u32(position + 24),
      offset: u32(position + 42),
    };
    if (
      entry.size === 0xffffffff ||
      entry.compressedSize === 0xffffffff ||
      entry.offset === 0xffffffff
    )
      throw new DataError(
        "ZIP64 workbook entries are not supported.",
        "unsupported-xlsx",
      );
    if (u16(position + 34))
      throw new DataError(
        "Multipart workbook entries are not supported.",
        "unsupported-xlsx",
      );
    entries.set(name, entry);
    position += recordLength;
  }
  if (position !== centralOffset + centralSize)
    throw new DataError(
      "The XLSX ZIP directory size is inconsistent.",
      "invalid-xlsx",
    );
  const cache = new Map();
  let totalRead = 0;
  const read = async (name) => {
    checkAbort(signal);
    if (cache.has(name)) return cache.get(name);
    const entry = entries.get(name);
    if (!entry)
      throw new DataError(`The workbook is missing ${name}.`, "invalid-xlsx");
    const task = (async () => {
      if (entry.flags & 1)
        throw new DataError(
          "Encrypted workbooks are not supported. Save an unencrypted copy to import.",
          "unsupported-xlsx",
        );
      if (entry.size > maxEntryBytes || totalRead + entry.size > maxTotalBytes)
        throw new DataError(
          "The uncompressed workbook exceeds the import size limit.",
          "data-limit",
        );
      totalRead += entry.size;
      const start = entry.offset;
      bound(start, 30);
      if (u32(start) !== 0x04034b50)
        throw new DataError(
          `Workbook entry ${name} has an invalid header.`,
          "invalid-xlsx",
        );
      if (u16(start + 8) !== entry.method)
        throw new DataError(
          `Workbook entry ${name} has inconsistent compression metadata.`,
          "invalid-xlsx",
        );
      const dataOffset = start + 30 + u16(start + 26) + u16(start + 28);
      bound(dataOffset, entry.compressedSize);
      if (dataOffset + entry.compressedSize > centralOffset)
        throw new DataError(
          `Workbook entry ${name} overlaps the ZIP directory.`,
          "invalid-xlsx",
        );
      const compressed = bytes.subarray(
        dataOffset,
        dataOffset + entry.compressedSize,
      );
      let output;
      if (entry.method === 0) output = compressed.slice();
      else if (entry.method === 8) {
        let inflater;
        try {
          inflater = new DecompressionStream("deflate-raw");
        } catch {
          throw new DataError(
            "This browser cannot decompress XLSX files. Use a current browser or export the worksheet as CSV.",
            "compression-unavailable",
          );
        }
        try {
          output = await readLimited(
            new Blob([compressed]).stream().pipeThrough(inflater),
            Math.min(maxEntryBytes, entry.size),
            signal,
          );
        } catch (error) {
          if (error instanceof DataError || signal?.aborted) throw error;
          throw new DataError(
            `Workbook entry ${name} cannot be decompressed: ${error.message}`,
            "invalid-xlsx",
          );
        }
      } else
        throw new DataError(
          `ZIP compression method ${entry.method} is not supported for XLSX files.`,
          "unsupported-xlsx",
        );
      if (output.length !== entry.size || crc32(output) !== entry.crc)
        throw new DataError(
          `Workbook entry ${name} failed its integrity check.`,
          "invalid-xlsx",
        );
      return output;
    })();
    cache.set(name, task);
    return task;
  };
  return {
    entries,
    has: (name) => entries.has(name),
    read,
    async text(name) {
      const data = await read(name);
      if (data[0] === 0xff && data[1] === 0xfe)
        return new TextDecoder("utf-16le", { fatal: true }).decode(data);
      if (data[0] === 0xfe && data[1] === 0xff)
        return new TextDecoder("utf-16be", { fatal: true }).decode(data);
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        throw new DataError(
          `Workbook XML part ${name} has invalid text encoding.`,
          "invalid-xlsx",
        );
      }
    },
  };
}
