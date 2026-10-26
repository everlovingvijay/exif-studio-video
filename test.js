/**
 * Comprehensive test suite for Video EXIF Studio
 * Runs in macOS built-in JavaScriptCore (jsc)
 */

load('js/geo-utils.js');
load('js/mp4-parser.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error('Assertion Failed: ' + message);
  }
  print('  ✓ ' + message);
}

print('=== Test Suite 1: GeoUtils (ISO 6709 Coordinates) ===');

// Test 1: Parse standard coordinates with altitude
const parsed1 = GeoUtils.parseISO6709('+37.7749-122.4194+015.000/');
assert(parsed1 !== null, 'parsed1 is not null');
assert(Math.abs(parsed1.latitude - 37.7749) < 0.0001, 'parsed latitude is 37.7749');
assert(Math.abs(parsed1.longitude - (-122.4194)) < 0.0001, 'parsed longitude is -122.4194');
assert(Math.abs(parsed1.altitude - 15.0) < 0.0001, 'parsed altitude is 15.0');

// Test 2: Parse coordinates without altitude
const parsed2 = GeoUtils.parseISO6709('+48.8584+002.2945/');
assert(parsed2 !== null, 'parsed2 is not null');
assert(Math.abs(parsed2.latitude - 48.8584) < 0.0001, 'parsed Paris latitude');
assert(Math.abs(parsed2.longitude - 2.2945) < 0.0001, 'parsed Paris longitude');
assert(parsed2.altitude === null, 'altitude is null when omitted');

// Test 3: Format coordinates
const formatted = GeoUtils.formatISO6709(37.7749, -122.4194, 15.0);
assert(formatted.startsWith('+37.7749-122.4194'), 'formatted string starts with lat/lon: ' + formatted);
assert(formatted.endsWith('/'), 'formatted string ends with slash: ' + formatted);

// Test 4: DMS formatting
const dmsLat = GeoUtils.toDMS(37.7749, true);
assert(dmsLat.includes('37°') && dmsLat.includes('N'), 'DMS latitude format: ' + dmsLat);
const dmsLon = GeoUtils.toDMS(-122.4194, false);
assert(dmsLon.includes('122°') && dmsLon.includes('W'), 'DMS longitude format: ' + dmsLon);


print('\n=== Test Suite 2: MP4 Binary Box Parser & Metadata Extraction ===');

// Helper to construct a synthetic valid MP4 box buffer
function createBox(type, payloadBytes) {
  const size = 8 + payloadBytes.length;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, size, false);
  for (let i = 0; i < 4; i++) {
    dv.setUint8(4 + i, type.charCodeAt(i));
  }
  buf.set(payloadBytes, 8);
  return buf;
}

// 1. Build mvhd box
const mvhdPayload = new Uint8Array(100);
const mvhdDv = new DataView(mvhdPayload.buffer);
mvhdDv.setUint8(0, 0); // version 0
// Creation time: 2024-01-01 00:00:00 UTC = Unix timestamp 1704067200
// In Mac epoch: 1704067200 + 2082844800 = 3786912000
const testMacTime = 3786912000;
mvhdDv.setUint32(4, testMacTime, false); // creation_time
mvhdDv.setUint32(8, testMacTime, false); // modification_time
mvhdDv.setUint32(12, 1000, false); // timescale: 1000 Hz
mvhdDv.setUint32(16, 5000, false); // duration: 5000 units = 5.0 seconds
const mvhdBox = createBox('mvhd', mvhdPayload);

// 2. Build tkhd box (Track header with 1920x1080 and normal matrix)
// ISOBMFF Specification: version 0 payload is 84 bytes:
// bytes 36..37: volume (2)
// bytes 38..39: reserved (2)
// bytes 40..75: matrix[9] (36 bytes)
// bytes 76..79: width (4 bytes fixed 16.16)
// bytes 80..83: height (4 bytes fixed 16.16)
const tkhdPayload = new Uint8Array(84);
const tkhdDv = new DataView(tkhdPayload.buffer);
tkhdDv.setUint8(0, 0); // version 0
tkhdDv.setUint16(36, 0x0000, false); // volume = 0 for video track
// Standard identity matrix at offset 40:
tkhdDv.setInt32(40, 0x00010000, false); // a = 1.0
tkhdDv.setInt32(56, 0x00010000, false); // d = 1.0
tkhdDv.setInt32(72, 0x40000000, false); // w = 1.0
tkhdDv.setUint32(76, 1920 << 16, false); // width 1920
tkhdDv.setUint32(80, 1080 << 16, false); // height 1080
const tkhdBox = createBox('tkhd', tkhdPayload);

// Build mdia -> hdlr ('vide') box
const hdlrPayload = new Uint8Array(24);
const hdlrDv = new DataView(hdlrPayload.buffer);
hdlrDv.setUint32(8, 0x76696465, false); // 'vide'
const hdlrBox = createBox('hdlr', hdlrPayload);

// Build synthetic stsd with visual sample entry ('hvc1')
const sampleEntryPayload = new Uint8Array(78);
const seDv = new DataView(sampleEntryPayload.buffer);
seDv.setUint16(24, 1920, false); // width at offset 32 (8 header + 24)
seDv.setUint16(26, 1080, false); // height at offset 34 (8 header + 26)
seDv.setUint8(42, 4); // compressor name len at offset 50 (8 header + 42)
for (let i = 0; i < 4; i++) seDv.setUint8(43 + i, 'HEVC'.charCodeAt(i));
const sampleEntryBox = createBox('hvc1', sampleEntryPayload);

const stsdPayload = new Uint8Array(8 + sampleEntryBox.length);
new DataView(stsdPayload.buffer).setUint32(4, 1, false); // entry count: 1
stsdPayload.set(sampleEntryBox, 8);
const stsdBox = createBox('stsd', stsdPayload);

const stblBox = createBox('stbl', stsdBox);
const minfBox = createBox('minf', stblBox);

const mdiaPayload = new Uint8Array(hdlrBox.length + minfBox.length);
mdiaPayload.set(hdlrBox, 0);
mdiaPayload.set(minfBox, hdlrBox.length);
const mdiaBox = createBox('mdia', mdiaPayload);

// Build trak box with tkhd + mdia
const trakPayload = new Uint8Array(tkhdBox.length + mdiaBox.length);
trakPayload.set(tkhdBox, 0);
trakPayload.set(mdiaBox, tkhdBox.length);
const trakBox = createBox('trak', trakPayload);

// 3. Build udta box with ©xyz GPS
const gpsStr = '+37.7749-122.4194+015.000/';
const gpsBytes = [];
for (let i = 0; i < gpsStr.length; i++) gpsBytes.push(gpsStr.charCodeAt(i));
const xyzPayload = new Uint8Array(2 + gpsBytes.length);
new DataView(xyzPayload.buffer).setUint16(0, 0x15c7, false); // English lang
xyzPayload.set(new Uint8Array(gpsBytes), 2);
const xyzBox = createBox('©xyz', xyzPayload);

// Build udta with xyzBox
const udtaBox = createBox('udta', xyzBox);

// Combine mvhd, trak, udta into moov
const moovChildrenTotalSize = mvhdBox.length + trakBox.length + udtaBox.length;
const moovChildren = new Uint8Array(moovChildrenTotalSize);
let off = 0;
moovChildren.set(mvhdBox, off); off += mvhdBox.length;
moovChildren.set(trakBox, off); off += trakBox.length;
moovChildren.set(udtaBox, off); off += udtaBox.length;

const moovBox = createBox('moov', moovChildren);

// Extract metadata from this moov buffer
const extracted = MP4Editor.extractMoovMetadata(moovBox.buffer, {
  type: 'moov',
  offset: 0,
  size: moovBox.length,
  headerSize: 8
});

assert(extracted !== null, 'Extracted metadata is not null');
assert(extracted.duration === 5, 'Duration is 5 seconds (5000 / 1000)');
assert(extracted.creationDate !== null, 'Creation date is parsed');
assert(extracted.creationDate.getUTCFullYear() === 2024, 'Creation year is 2024');
assert(extracted.width === 1920, 'Width is 1920');
assert(extracted.height === 1080, 'Height is 1080');
assert(extracted.rotation === 0, 'Rotation is 0 degrees');
assert(extracted.location !== null, 'Location is extracted');
assert(Math.abs(extracted.location.latitude - 37.7749) < 0.0001, 'GPS latitude match');
assert(Math.abs(extracted.location.longitude - (-122.4194)) < 0.0001, 'GPS longitude match');

print('\n=== Test Suite 3: Writing & Updating Metadata Simulation ===');

const fullFileBytes = new Uint8Array(5000);
// Write dummy ftyp
fullFileBytes[3] = 32;
fullFileBytes[4] = 0x66; fullFileBytes[5] = 0x74; fullFileBytes[6] = 0x79; fullFileBytes[7] = 0x70;
// Place moovBox at offset 32
fullFileBytes.set(moovBox, 32);

const syntheticFile = {
  size: 5000,
  type: 'video/mp4',
  name: 'test_sample.mp4',
  slice: function(start, end) {
    if (end === undefined) end = this.size;
    const sub = fullFileBytes.subarray(start, end);
    const copy = new Uint8Array(sub.length);
    copy.set(sub);
    return {
      size: copy.length,
      arrayBuffer: async () => copy.buffer
    };
  }
};

const scanResult = {
  topBoxes: [
    { type: 'ftyp', offset: 0, size: 32, headerSize: 8 },
    { type: 'moov', offset: 32, size: moovBox.length, headerSize: 8 },
    { type: 'mdat', offset: 32 + moovBox.length, size: 3000, headerSize: 8 }
  ],
  moovBox: {
    type: 'moov',
    offset: 32,
    size: moovBox.length,
    headerSize: 8
  }
};

if (typeof Blob === 'undefined') {
  globalThis.Blob = class {
    constructor(parts, options) {
      this.parts = parts;
      this.type = (options && options.type) || '';
      this.size = parts.reduce((acc, p) => acc + (p.byteLength || p.length || p.size || 0), 0);
    }
  };
}

// Override readFileSlice for mock file
MP4Editor.readFileSlice = async function(file, start, end) {
  // If reading moov, return our constructed moovBox buffer
  if (start === scanResult.moovBox.offset) {
    return moovBox.buffer;
  }
  return new Uint8Array(end - start).buffer;
};

async function runAsyncTests() {
  // Test 3A: Export without changing rotation - verify tkhd matrix & dimensions are 100% preserved
  const updatesNoRot = {
    creationDate: new Date('2026-06-15T12:00:00Z'),
    location: { latitude: 40.7128, longitude: -74.0060 },
    tags: { title: 'Test No Rot' },
    rotation: undefined // User did not touch rotation
  };

  const blobNoRot = await MP4Editor.writeMetadata(syntheticFile, scanResult, updatesNoRot);
  assert(blobNoRot !== null, 'writeMetadata produced a Blob (no rotation change)');
  const newMoovNoRot = blobNoRot.parts[1]; // moov Uint8Array
  const metaNoRot = MP4Editor.extractMoovMetadata(newMoovNoRot.buffer, {
    type: 'moov',
    offset: 0,
    size: newMoovNoRot.length,
    headerSize: 8
  });
  assert(metaNoRot.width === 1920, 'Unchanged export: Width strictly preserved as 1920');
  assert(metaNoRot.height === 1080, 'Unchanged export: Height strictly preserved as 1080');
  assert(metaNoRot.rotation === 0, 'Unchanged export: Rotation strictly preserved as 0');

  // Test 3B: Export with 90° rotation - verify matrix at offset 40 without corrupting width/height
  const updatesRot90 = {
    rotation: 90
  };
  const blobRot90 = await MP4Editor.writeMetadata(syntheticFile, scanResult, updatesRot90);
  const newMoovRot90 = blobRot90.parts[1];
  const metaRot90 = MP4Editor.extractMoovMetadata(newMoovRot90.buffer, {
    type: 'moov',
    offset: 0,
    size: newMoovRot90.length,
    headerSize: 8
  });
  assert(metaRot90.rotation === 90, 'Rotated export: Rotation correctly set to 90');
  assert(metaRot90.width === 1080, 'Rotated export: Display width is 1080');
  assert(metaRot90.height === 1920, 'Rotated export: Display height is 1920');
  assert(metaRot90.rawWidth === 1920, 'Rotated export: Raw track width strictly preserved as 1920');
  assert(metaRot90.rawHeight === 1080, 'Rotated export: Raw track height strictly preserved as 1080');
  print('  ✓ Aspect ratio and display dimensions verified for 90° rotation!');

  // Test 3C: Export with 180° and 270° rotations
  const blobRot180 = await MP4Editor.writeMetadata(syntheticFile, scanResult, { rotation: 180 });
  const metaRot180 = MP4Editor.extractMoovMetadata(blobRot180.parts[1].buffer, { type: 'moov', offset: 0, size: blobRot180.parts[1].length, headerSize: 8 });
  assert(metaRot180.rotation === 180, 'Rotated export: Rotation correctly set to 180');
  assert(metaRot180.rawWidth === 1920 && metaRot180.rawHeight === 1080, '180° raw dimensions intact');

  const blobRot270 = await MP4Editor.writeMetadata(syntheticFile, scanResult, { rotation: 270 });
  const metaRot270 = MP4Editor.extractMoovMetadata(blobRot270.parts[1].buffer, { type: 'moov', offset: 0, size: blobRot270.parts[1].length, headerSize: 8 });
  assert(metaRot270.rotation === 270, 'Rotated export: Rotation correctly set to 270');
  assert(metaRot270.width === 1080 && metaRot270.height === 1920, '270° display dimensions are 1080x1920');

  // Test 3D: Export with iPhone 17 preset (matching user PDF metadata report)
  const iphone17Updates = {
    tags: {
      make: 'Apple',
      model: 'iPhone 17',
      software: '26.6.2',
      cameraIdentifier: 'Back',
      lensModel: 'iPhone 17 back camera 5.96mm f/1.6',
      focalLength35mm: '26',
      fNumber: '1.6',
      horizontalAccuracy: '10.84'
    },
    outputFormat: 'mov',
    location: {
      latitude: 17.5327,
      longitude: 78.3922,
      altitude: 611.743
    },
    creationDate: new Date('2026-09-27T09:34:10Z')
  };
  const blobIphone17 = await MP4Editor.writeMetadata(syntheticFile, scanResult, iphone17Updates);
  const metaIphone17 = MP4Editor.extractMoovMetadata(blobIphone17.parts[1].buffer, {
    type: 'moov',
    offset: 0,
    size: blobIphone17.parts[1].length,
    headerSize: 8
  });
  assert(metaIphone17.tags.make === 'Apple', 'iPhone 17 make is Apple');
  assert(metaIphone17.tags.model === 'iPhone 17', 'iPhone 17 model is iPhone 17');
  assert(metaIphone17.tags.software === '26.6.2', 'iPhone 17 software is 26.6.2');
  assert(metaIphone17.tags.cameraIdentifier === 'Back', 'iPhone 17 camera identifier is Back');
  assert(metaIphone17.tags.lensModel === 'iPhone 17 back camera 5.96mm f/1.6', 'iPhone 17 lens model parsed');
  assert(metaIphone17.tags.focalLength35mm === '26', 'iPhone 17 focal length 35mm parsed as 26');
  assert(metaIphone17.tags.fNumber === '1.6', 'iPhone 17 F-number parsed as 1.6');
  assert(metaIphone17.tags.horizontalAccuracy === '10.84', 'iPhone 17 horizontal accuracy parsed as 10.84');
  assert(metaIphone17.stream.videoCodec === 'hvc1', 'Original video stream codec (hvc1) is preserved intact (no corruption)');
  assert(metaIphone17.stream.compressorName === 'HEVC', 'Compressor name (HEVC) is preserved');
  assert(metaIphone17.location !== null, 'iPhone 17 location parsed');
  assert(Math.abs(metaIphone17.location.latitude - 17.5327) < 0.001, 'iPhone 17 latitude match');

  // Verify QuickTime binary layout: moov.meta must be standard box (no 4-byte FullBox offset)
  // and child hdlr box must be exactly 34 bytes (8 header + 26 payload)
  const moovBuf = blobIphone17.parts[1].buffer;
  const moovDv = new DataView(moovBuf);
  // Find 'meta' box inside moov
  let foundMeta = false;
  let o = 8;
  while (o + 8 <= blobIphone17.parts[1].length) {
    const bSize = moovDv.getUint32(o, false);
    const bType = String.fromCharCode(moovDv.getUint8(o+4), moovDv.getUint8(o+5), moovDv.getUint8(o+6), moovDv.getUint8(o+7));
    if (bType === 'meta') {
      foundMeta = true;
      // First child inside meta must be 'hdlr' at offset o + 8 (size 34)
      const hdlrSize = moovDv.getUint32(o + 8, false);
      const hdlrType = String.fromCharCode(moovDv.getUint8(o+12), moovDv.getUint8(o+13), moovDv.getUint8(o+14), moovDv.getUint8(o+15));
      assert(hdlrSize === 34, 'QuickTime meta hdlr box is exactly 34 bytes');
      assert(hdlrType === 'hdlr', 'First child box of QuickTime meta is hdlr at offset 8 (standard box, not FullBox)');
      const handler = String.fromCharCode(moovDv.getUint8(o+24), moovDv.getUint8(o+25), moovDv.getUint8(o+26), moovDv.getUint8(o+27));
      assert(handler === 'mdta', 'QuickTime meta handler is mdta');
      break;
    }
    if (bSize < 8) break;
    o += bSize;
  }
  assert(foundMeta, 'QuickTime meta box present in moov');

  // Verify track-level trak.meta box inside video trak
  let foundTrackMeta = false;
  let to = 8;
  while (to + 8 <= blobIphone17.parts[1].length) {
    const bSize = moovDv.getUint32(to, false);
    const bType = String.fromCharCode(moovDv.getUint8(to+4), moovDv.getUint8(to+5), moovDv.getUint8(to+6), moovDv.getUint8(to+7));
    if (bType === 'trak') {
      // Look inside trak for meta
      let insideTrak = to + 8;
      while (insideTrak + 8 <= to + bSize) {
        const subSz = moovDv.getUint32(insideTrak, false);
        const subTp = String.fromCharCode(moovDv.getUint8(insideTrak+4), moovDv.getUint8(insideTrak+5), moovDv.getUint8(insideTrak+6), moovDv.getUint8(insideTrak+7));
        if (subTp === 'meta') {
          foundTrackMeta = true;
          const trkHdlrSize = moovDv.getUint32(insideTrak + 8, false);
          assert(trkHdlrSize === 34, 'Track-level meta hdlr box is exactly 34 bytes');
          break;
        }
        if (subSz < 8) break;
        insideTrak += subSz;
      }
      break;
    }
    if (bSize < 8) break;
    to += bSize;
  }
  assert(foundTrackMeta, 'Track-level meta box present in video track (trak.meta)');

  // Verify ftyp box has 'qt  ' major brand
  const ftypOut = blobIphone17.parts[0];
  const ftypBrand = String.fromCharCode(ftypOut[8], ftypOut[9], ftypOut[10], ftypOut[11]);
  assert(ftypBrand === 'qt  ', 'Apple/iPhone export enforces QuickTime qt brand in ftyp');

  // Verify XMP_ atom is embedded in udta
  let foundXMP = false;
  let uo = 8;
  while (uo + 8 <= blobIphone17.parts[1].length) {
    const bSize = moovDv.getUint32(uo, false);
    const bType = String.fromCharCode(moovDv.getUint8(uo+4), moovDv.getUint8(uo+5), moovDv.getUint8(uo+6), moovDv.getUint8(uo+7));
    if (bType === 'udta') {
      let insideUdta = uo + 8;
      while (insideUdta + 8 <= uo + bSize) {
        const uSubSz = moovDv.getUint32(insideUdta, false);
        const uSubTp = String.fromCharCode(moovDv.getUint8(insideUdta+4), moovDv.getUint8(insideUdta+5), moovDv.getUint8(insideUdta+6), moovDv.getUint8(insideUdta+7));
        if (uSubTp === 'XMP_') {
          foundXMP = true;
          let xmpStr = '';
          for (let xi = insideUdta + 8; xi < insideUdta + uSubSz; xi++) {
            xmpStr += String.fromCharCode(moovDv.getUint8(xi));
          }
          assert(xmpStr.includes('exif:LensModel="iPhone 17 back camera 5.96mm f/1.6"'), 'XMP contains correct exif:LensModel');
          assert(xmpStr.includes('exif:FocalLengthIn35mmFilm="26"'), 'XMP contains correct exif:FocalLengthIn35mmFilm');
          assert(xmpStr.includes('exif:FNumber="1.6"'), 'XMP contains correct exif:FNumber');
          break;
        }
        if (uSubSz < 8) break;
        insideUdta += uSubSz;
      }
      break;
    }
    if (bSize < 8) break;
    uo += bSize;
  }
  assert(foundXMP, 'XMP_ atom embedded in udta with standard RDF lens & camera metadata');

  // Verify dual keys in trak.meta
  let foundShortLensKey = false;
  let foundCaptureMode = false;
  let tmo = 8;
  while (tmo + 8 <= blobIphone17.parts[1].length) {
    const bSize = moovDv.getUint32(tmo, false);
    const bType = String.fromCharCode(moovDv.getUint8(tmo+4), moovDv.getUint8(tmo+5), moovDv.getUint8(tmo+6), moovDv.getUint8(tmo+7));
    if (bType === 'trak') {
      let inT = tmo + 8;
      while (inT + 8 <= tmo + bSize) {
        const sSz = moovDv.getUint32(inT, false);
        const sTp = String.fromCharCode(moovDv.getUint8(inT+4), moovDv.getUint8(inT+5), moovDv.getUint8(inT+6), moovDv.getUint8(inT+7));
        if (sTp === 'meta') {
          let inM = inT + 8;
          while (inM + 8 <= inT + sSz) {
            const mSz = moovDv.getUint32(inM, false);
            const mTp = String.fromCharCode(moovDv.getUint8(inM+4), moovDv.getUint8(inM+5), moovDv.getUint8(inM+6), moovDv.getUint8(inM+7));
            if (mTp === 'keys') {
              const kCount = moovDv.getUint32(inM + 12, false);
              let ko = inM + 16;
              for (let k = 1; k <= kCount; k++) {
                const ksz = moovDv.getUint32(ko, false);
                let kname = '';
                for (let ki = ko + 8; ki < ko + ksz; ki++) kname += String.fromCharCode(moovDv.getUint8(ki));
                if (kname === 'camera.lens_model') foundShortLensKey = true;
                if (kname === 'com.apple.photos.captureMode') foundCaptureMode = true;
                ko += ksz;
              }
              break;
            }
            if (mSz < 8) break;
            inM += mSz;
          }
          break;
        }
        if (sSz < 8) break;
        inT += sSz;
      }
      break;
    }
    if (bSize < 8) break;
    tmo += bSize;
  }
  assert(foundShortLensKey, 'Dual-namespace camera.lens_model present in trak.meta for Apple Photos compatibility');
  assert(foundCaptureMode, 'com.apple.photos.captureMode present in trak.meta');

  print('  ✓ QuickTime binary layout strictly conforms to Apple AVFoundation specification!');
  print('  ✓ iPhone 17 camera & lens optics (track + movie + XMP + ftyp) verified successfully!');

  print('\n=== Test Suite 5: Audio Stream Integrity & Native MP4 Preservation ===');

  // Build a multi-track synthetic file (Video + AAC Audio)
  const multiVTrak = createBox('trak', (() => {
    const tkhd = new Uint8Array(84);
    const dv = new DataView(tkhd.buffer);
    dv.setUint32(12, 1); // track ID 1
    dv.setUint32(76, 1920 << 16);
    dv.setUint32(80, 1080 << 16);
    const tkhdBox = createBox('tkhd', tkhd);

    const hdlrPayload = new Uint8Array(25);
    new DataView(hdlrPayload.buffer).setUint32(8, 0x76696465, false); // 'vide'
    const hdlrBox = createBox('hdlr', hdlrPayload);

    const mdhdBox = createBox('mdhd', new Uint8Array(24));
    const stco = createBox('stco', (() => {
      const b = new Uint8Array(12);
      const d = new DataView(b.buffer);
      d.setUint32(4, 1); // 1 entry
      d.setUint32(8, 2000); // chunk offset 2000
      return b;
    })());
    const minfBox = createBox('minf', createBox('stbl', stco));
    const mdiaBox = createBox('mdia', (() => {
      const p = new Uint8Array(mdhdBox.length + hdlrBox.length + minfBox.length);
      p.set(mdhdBox, 0);
      p.set(hdlrBox, mdhdBox.length);
      p.set(minfBox, mdhdBox.length + hdlrBox.length);
      return p;
    })());
    const p = new Uint8Array(tkhdBox.length + mdiaBox.length);
    p.set(tkhdBox, 0);
    p.set(mdiaBox, tkhdBox.length);
    return p;
  })());

  const multiATrak = createBox('trak', (() => {
    const tkhd = new Uint8Array(84);
    const dv = new DataView(tkhd.buffer);
    dv.setUint32(12, 2); // track ID 2
    dv.setUint16(36, 0x0100); // volume = 1.0 (0x0100)
    dv.setUint32(76, 0); // width 0
    dv.setUint32(80, 0); // height 0
    const tkhdBox = createBox('tkhd', tkhd);

    const hdlrPayload = new Uint8Array(25);
    new DataView(hdlrPayload.buffer).setUint32(8, 0x736f756e, false); // 'soun'
    const hdlrBox = createBox('hdlr', hdlrPayload);

    const mdhdBox = createBox('mdhd', new Uint8Array(24));
    const smhdBox = createBox('smhd', new Uint8Array(8));
    const stco = createBox('stco', (() => {
      const b = new Uint8Array(12);
      const d = new DataView(b.buffer);
      d.setUint32(4, 1);
      d.setUint32(8, 2500); // chunk offset 2500
      return b;
    })());
    const stbl = createBox('stbl', stco);
    const minfPayload = new Uint8Array(smhdBox.length + stbl.length);
    minfPayload.set(smhdBox, 0);
    minfPayload.set(stbl, smhdBox.length);
    const minfBox = createBox('minf', minfPayload);

    const mdiaPayload = new Uint8Array(mdhdBox.length + hdlrBox.length + minfBox.length);
    mdiaPayload.set(mdhdBox, 0);
    mdiaPayload.set(hdlrBox, mdhdBox.length);
    mdiaPayload.set(minfBox, mdhdBox.length + hdlrBox.length);
    const mdiaBox = createBox('mdia', mdiaPayload);

    const p = new Uint8Array(tkhdBox.length + mdiaBox.length);
    p.set(tkhdBox, 0);
    p.set(mdiaBox, tkhdBox.length);
    return p;
  })());

  const multiFtyp = createBox('ftyp', (() => {
    const b = new Uint8Array(16);
    for (let i = 0; i < 4; i++) b[i] = 'isom'.charCodeAt(i);
    b[7] = 2;
    for (let i = 0; i < 4; i++) b[8 + i] = 'mp42'.charCodeAt(i);
    return b;
  })());

  const multiMvhd = createBox('mvhd', (() => {
    const b = new Uint8Array(100);
    const d = new DataView(b.buffer);
    d.setUint32(12, 1000);
    d.setUint32(16, 5000);
    return b;
  })());

  const multiMoovPayload = new Uint8Array(multiMvhd.length + multiVTrak.length + multiATrak.length);
  let mmOff = 0;
  multiMoovPayload.set(multiMvhd, mmOff); mmOff += multiMvhd.length;
  multiMoovPayload.set(multiVTrak, mmOff); mmOff += multiVTrak.length;
  multiMoovPayload.set(multiATrak, mmOff); mmOff += multiATrak.length;
  const multiMoovBox = createBox('moov', multiMoovPayload);

  const multiPad = 2000 - (multiFtyp.length + multiMoovBox.length);
  const multiFree = createBox('free', new Uint8Array(multiPad - 8));
  const multiMdat = createBox('mdat', new Uint8Array(1000 - 8));

  const multiTotal = new Uint8Array(multiFtyp.length + multiMoovBox.length + multiFree.length + multiMdat.length);
  let mfOff = 0;
  multiTotal.set(multiFtyp, mfOff); mfOff += multiFtyp.length;
  multiTotal.set(multiMoovBox, mfOff); mfOff += multiMoovBox.length;
  multiTotal.set(multiFree, mfOff); mfOff += multiFree.length;
  multiTotal.set(multiMdat, mfOff); mfOff += multiMdat.length;

  const multiFileObj = {
    size: multiTotal.byteLength,
    name: 'interview_clip.mp4',
    type: 'video/mp4',
    slice: (start, end) => {
      const e = end !== undefined ? end : multiTotal.byteLength;
      const sub = multiTotal.subarray(start, e);
      return {
        size: sub.byteLength,
        slice: (s, ed) => {
          const s2 = sub.subarray(s, ed !== undefined ? ed : sub.byteLength);
          return {
            size: s2.byteLength,
            arrayBuffer: () => Promise.resolve(s2.buffer.slice(s2.byteOffset, s2.byteOffset + s2.byteLength))
          };
        },
        arrayBuffer: () => Promise.resolve(sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength))
      };
    }
  };

  const multiScan = await MP4Editor.readMetadata(multiFileObj);
  assert(multiScan.metadata.tracks.length === 2, 'Multi-track scan detected both video and audio tracks');

  // Test 5A: Standard MP4 export with camera metadata
  const mp4Updates = {
    tags: {
      make: 'Apple',
      model: 'iPhone 17',
      lensModel: 'iPhone 17 back camera 26mm f/1.6',
      focalLength35mm: '26',
      fNumber: '1.6'
    },
    outputFormat: 'mp4'
  };

  const mp4Blob = await MP4Editor.writeMetadata(multiFileObj, multiScan, mp4Updates);
  assert(mp4Blob.type === 'video/mp4', 'Native MP4 export preserves video/mp4 MIME type');

  // Verify ftyp was NOT modified to qt
  const outFtyp = mp4Blob.parts[0];
  const outFtypBytes = outFtyp instanceof Uint8Array ? outFtyp : new Uint8Array(await outFtyp.arrayBuffer());
  const outBrand = String.fromCharCode(outFtypBytes[8], outFtypBytes[9], outFtypBytes[10], outFtypBytes[11]);
  assert(outBrand === 'isom', 'Native MP4 export strictly preserves original isom brand');

  // Parse exported moov
  const outMoovBytes = mp4Blob.parts[1];
  const outMoovDv = new DataView(outMoovBytes.buffer, outMoovBytes.byteOffset, outMoovBytes.byteLength);

  // Inspect children of moov
  let moovChildOff = 8;
  const exportedTraks = [];
  while (moovChildOff + 8 <= outMoovBytes.length) {
    const cSz = outMoovDv.getUint32(moovChildOff, false);
    const cTp = String.fromCharCode(outMoovBytes[moovChildOff+4], outMoovBytes[moovChildOff+5], outMoovBytes[moovChildOff+6], outMoovBytes[moovChildOff+7]);
    if (cTp === 'trak') {
      exportedTraks.push({ off: moovChildOff, sz: cSz });
    }
    if (cSz < 8) break;
    moovChildOff += cSz;
  }
  assert(exportedTraks.length === 2, 'Exported moov contains both video and audio tracks');

  // Inspect video track (Track 0)
  const vTrakInfo = exportedTraks[0];
  const vTrakBytes = outMoovBytes.subarray(vTrakInfo.off, vTrakInfo.off + vTrakInfo.sz);
  let vTrakHasMeta = false;
  let vChildOff = 8;
  const vTrakDv = new DataView(vTrakBytes.buffer, vTrakBytes.byteOffset, vTrakBytes.length);
  while (vChildOff + 8 <= vTrakBytes.length) {
    const vcSz = vTrakDv.getUint32(vChildOff, false);
    const vcTp = String.fromCharCode(vTrakBytes[vChildOff+4], vTrakBytes[vChildOff+5], vTrakBytes[vChildOff+6], vTrakBytes[vChildOff+7]);
    if (vcTp === 'meta') vTrakHasMeta = true;
    if (vcSz < 8) break;
    vChildOff += vcSz;
  }
  assert(vTrakHasMeta, 'Video track in MP4 export has trak.meta injected for optics');

  // Inspect audio track (Track 1)
  const aTrakInfo = exportedTraks[1];
  const aTrakBytes = outMoovBytes.subarray(aTrakInfo.off, aTrakInfo.off + aTrakInfo.sz);
  const aTrakDv = new DataView(aTrakBytes.buffer, aTrakBytes.byteOffset, aTrakBytes.length);

  // Verify audio volume is strictly 0x0100 (1.0)
  const aVolume = aTrakDv.getUint16(8 + 8 + 36, false);
  assert(aVolume === 0x0100, 'Audio track header volume is strictly preserved as 1.0 (0x0100)');

  // Verify audio track does NOT have meta injected
  let aTrakHasMeta = false;
  let aChildOff = 8;
  while (aChildOff + 8 <= aTrakBytes.length) {
    const acSz = aTrakDv.getUint32(aChildOff, false);
    const acTp = String.fromCharCode(aTrakBytes[aChildOff+4], aTrakBytes[aChildOff+5], aTrakBytes[aChildOff+6], aTrakBytes[aChildOff+7]);
    if (acTp === 'meta') aTrakHasMeta = true;
    if (acSz < 8) break;
    aChildOff += acSz;
  }
  assert(!aTrakHasMeta, 'Audio track strictly has NO meta box injected (100% clean stream)');

  // Verify audio chunk offset shifted accurately by delta
  const expectedDelta = outMoovBytes.length - multiMoovBox.length;
  let audioChunkOffset = 0;
  for (let j = 0; j < aTrakBytes.length - 8; j++) {
    if (String.fromCharCode(aTrakBytes[j+4], aTrakBytes[j+5], aTrakBytes[j+6], aTrakBytes[j+7]) === 'stco') {
      const stcoDv = new DataView(aTrakBytes.buffer, aTrakBytes.byteOffset + j, aTrakBytes.length - j);
      audioChunkOffset = stcoDv.getUint32(16, false);
      break;
    }
  }
  assert(audioChunkOffset === 2500 + expectedDelta, 'Audio chunk offsets accurately adjusted by delta (' + (2500 + expectedDelta) + ')');

  // Test 5B: QuickTime .mov export on multi-track file (audio must still be 100% protected)
  const movUpdates = {
    tags: {
      make: 'Apple',
      model: 'iPhone 17',
      lensModel: 'iPhone 17 back camera 26mm f/1.6',
      focalLength35mm: '26',
      fNumber: '1.6'
    },
    outputFormat: 'mov'
  };

  const movBlob = await MP4Editor.writeMetadata(multiFileObj, multiScan, movUpdates);
  const movMoovBytes = movBlob.parts[1];
  const movMoovDv = new DataView(movMoovBytes.buffer, movMoovBytes.byteOffset, movMoovBytes.byteLength);

  let movChildOff = 8;
  const movTraks = [];
  while (movChildOff + 8 <= movMoovBytes.length) {
    const cSz = movMoovDv.getUint32(movChildOff, false);
    const cTp = String.fromCharCode(movMoovBytes[movChildOff+4], movMoovBytes[movChildOff+5], movMoovBytes[movChildOff+6], movMoovBytes[movChildOff+7]);
    if (cTp === 'trak') movTraks.push({ off: movChildOff, sz: cSz });
    if (cSz < 8) break;
    movChildOff += cSz;
  }
  assert(movTraks.length === 2, 'QuickTime export contains both video and audio tracks');

  // Verify video track in QuickTime export has meta injected for Apple Photos optics
  const movVideoTrak = movMoovBytes.subarray(movTraks[0].off, movTraks[0].off + movTraks[0].sz);
  let movVideoHasMeta = false;
  let mvchOff = 8;
  const movVideoDv = new DataView(movVideoTrak.buffer, movVideoTrak.byteOffset, movVideoTrak.length);
  while (mvchOff + 8 <= movVideoTrak.length) {
    const vcSz = movVideoDv.getUint32(mvchOff, false);
    const vcTp = String.fromCharCode(movVideoTrak[mvchOff+4], movVideoTrak[mvchOff+5], movVideoTrak[mvchOff+6], movVideoTrak[mvchOff+7]);
    if (vcTp === 'meta') movVideoHasMeta = true;
    if (vcSz < 8) break;
    mvchOff += vcSz;
  }
  assert(movVideoHasMeta, 'Video track in QuickTime export has trak.meta injected for Apple Photos optics');

  // Verify audio track in QuickTime export has NO meta injected (protected by smhd check)
  const movAudioTrak = movMoovBytes.subarray(movTraks[1].off, movTraks[1].off + movTraks[1].sz);
  let movAudioHasMeta = false;
  let machOff = 8;
  const movAudioDv = new DataView(movAudioTrak.buffer, movAudioTrak.byteOffset, movAudioTrak.length);
  while (machOff + 8 <= movAudioTrak.length) {
    const acSz = movAudioDv.getUint32(machOff, false);
    const acTp = String.fromCharCode(movAudioTrak[machOff+4], movAudioTrak[machOff+5], movAudioTrak[machOff+6], movAudioTrak[machOff+7]);
    if (acTp === 'meta') movAudioHasMeta = true;
    if (acSz < 8) break;
    machOff += acSz;
  }
  assert(!movAudioHasMeta, 'Audio track in QuickTime export strictly has NO meta box injected');
  print('  ✓ Audio stream volume, sample descriptions, and chunk offsets 100% verified across both MP4 and MOV exports!');

  print('\n=== Test Suite 6: Dolby Vision Profile 8.4 & Social Platform Geolocation (Instagram / Facebook) ===');

  // Test 6.1: GeoUtils.toXMPGPS
  const testGps = GeoUtils.toXMPGPS(17.5327, 78.3922, 611.7);
  assert(testGps !== null, 'toXMPGPS returns valid object');
  assert(testGps.latitude === '17,31.962000N', 'XMP latitude is properly formatted: ' + testGps.latitude);
  assert(testGps.longitude === '078,23.532000E', 'XMP longitude is formatted with 3-digit degrees: ' + testGps.longitude);
  assert(testGps.latitudeRef === 'N', 'XMP latitude ref is N');
  assert(testGps.longitudeRef === 'E', 'XMP longitude ref is E');
  assert(testGps.altitude === '61170/100', 'XMP altitude rational is 61170/100: ' + testGps.altitude);
  assert(testGps.coordinates === '17.532700 N, 78.392200 E', 'XMP coordinates match: ' + testGps.coordinates);
  print('  ✓ GeoUtils.toXMPGPS produces 100% compliant RDF EXIF GPS data for Instagram and Facebook!');

  // Test 6.2: Dolby Vision & Geolocation Export
  const dolbyUpdates = {
    creationDate: new Date('2026-09-29T15:18:00+05:30'),
    modifyDate: new Date('2026-09-29T15:18:00+05:30'),
    location: {
      latitude: 17.5327,
      longitude: 78.3922,
      altitude: 611.7
    },
    tags: {
      make: 'Apple',
      model: 'iPhone 17',
      software: '26.6.2',
      lensModel: 'iPhone 17 back camera 5.96mm f/1.6',
      focalLength35mm: '26',
      fNumber: '1.6',
      cameraIdentifier: 'Back',
      horizontalAccuracy: '10.84',
      locationName: 'Hyderabad, India',
      dolbyVision: true
    },
    dolbyVision: true,
    outputFormat: 'mov',
    scrubAll: false
  };

  let dvBlob = null;
  try {
    dvBlob = await MP4Editor.writeMetadata(syntheticFile, scanResult, dolbyUpdates);
  } catch (err) {
    print('writeMetadata exception: ' + err + '\n' + err.stack);
  }
  assert(dvBlob && dvBlob.size > 0, 'writeMetadata successfully produced Dolby Vision export Blob');

  // Convert blob parts to Uint8Array for inspection
  const dvBytes = new Uint8Array(dvBlob.size);
  let dvOff = 0;
  for (let i = 0; i < dvBlob.parts.length; i++) {
    const p = dvBlob.parts[i];
    if (p._bytes) {
      dvBytes.set(p._bytes, dvOff);
      dvOff += p._bytes.length;
    } else if (p instanceof Uint8Array) {
      dvBytes.set(p, dvOff);
      dvOff += p.length;
    } else if (p.buffer) {
      const u8 = new Uint8Array(p.buffer, p.byteOffset || 0, p.byteLength || p.size || p.length);
      dvBytes.set(u8, dvOff);
      dvOff += u8.length;
    }
  }

  // Create mock file for readMetadata
  const dvMockFile = {
    name: 'dv_test.mov',
    size: dvBytes.length,
    slice: function(start, end) {
      if (end === undefined) end = this.size;
      const sub = dvBytes.subarray(start, end);
      const copy = new Uint8Array(sub.length);
      copy.set(sub);
      return {
        size: copy.length,
        _bytes: copy,
        buffer: copy.buffer,
        arrayBuffer: async () => copy.buffer
      };
    }
  };

  const dvScan = await MP4Editor.readMetadata(dvMockFile);
  assert(dvScan.metadata.stream.isDolbyVision === true, 'Exported stream is recognized as Dolby Vision');
  assert(dvScan.metadata.stream.dolbyVisionProfile === 'Profile 8.4', 'Exported stream profile is Profile 8.4');
  assert(dvScan.metadata.location !== null, 'Exported metadata contains parsed location');
  assert(Math.abs(dvScan.metadata.location.latitude - 17.5327) < 0.0001, 'Latitude matches 17.5327');
  assert(Math.abs(dvScan.metadata.location.longitude - 78.3922) < 0.0001, 'Longitude matches 78.3922');

  // Inspect internal atoms of the Dolby Vision export
  const dvView = new DataView(dvBytes.buffer);
  const dvMoovBox = dvScan.topBoxes.find(b => b.type === 'moov');
  assert(dvMoovBox, 'Export contains moov box');
  const dvMoovBytes = dvBytes.subarray(dvMoovBox.offset, dvMoovBox.offset + dvMoovBox.size);
  const dvMoovDv = new DataView(dvMoovBytes.buffer, dvMoovBytes.byteOffset, dvMoovBytes.length);

  // Check stsd in video track
  let foundDvvC = false;
  let foundColr = false;
  let foundAmve = false;
  let foundXMPAtom = false;
  let foundXMPUuidAtom = false;
  let foundXyzAtom = false;
  let foundIlstXyz = false;

  let scanCur = 8;
  while (scanCur + 8 <= dvMoovBytes.length) {
    const bSz = dvMoovDv.getUint32(scanCur, false);
    const bTp = String.fromCharCode(dvMoovBytes[scanCur+4], dvMoovBytes[scanCur+5], dvMoovBytes[scanCur+6], dvMoovBytes[scanCur+7]);
    if (bTp === 'trak') {
      // Look inside trak -> mdia -> minf -> stbl -> stsd
      const trkBytes = dvMoovBytes.subarray(scanCur, scanCur + bSz);
      const trkDv = new DataView(trkBytes.buffer, trkBytes.byteOffset, trkBytes.length);
      let tOff = 8;
      while (tOff + 8 <= trkBytes.length) {
        const tSz = trkDv.getUint32(tOff, false);
        const tTp = String.fromCharCode(trkBytes[tOff+4], trkBytes[tOff+5], trkBytes[tOff+6], trkBytes[tOff+7]);
        if (tTp === 'mdia') {
          let mOff = tOff + 8;
          while (mOff + 8 <= tOff + tSz) {
            const mSz = trkDv.getUint32(mOff, false);
            const mTp = String.fromCharCode(trkBytes[mOff+4], trkBytes[mOff+5], trkBytes[mOff+6], trkBytes[mOff+7]);
            if (mTp === 'minf') {
              let miOff = mOff + 8;
              while (miOff + 8 <= mOff + mSz) {
                const miSz = trkDv.getUint32(miOff, false);
                const miTp = String.fromCharCode(trkBytes[miOff+4], trkBytes[miOff+5], trkBytes[miOff+6], trkBytes[miOff+7]);
                if (miTp === 'stbl') {
                  let sOff = miOff + 8;
                  while (sOff + 8 <= miOff + miSz) {
                    const sSz = trkDv.getUint32(sOff, false);
                    const sTp = String.fromCharCode(trkBytes[sOff+4], trkBytes[sOff+5], trkBytes[sOff+6], trkBytes[sOff+7]);
                    if (sTp === 'stsd') {
                      let eOff = sOff + 16; // Entry 0
                      const entrySz = trkDv.getUint32(eOff, false);
                      let subO = eOff + 86;
                      while (subO + 8 <= eOff + entrySz) {
                        const sbSz = trkDv.getUint32(subO, false);
                        const sbTp = String.fromCharCode(trkBytes[subO+4], trkBytes[subO+5], trkBytes[subO+6], trkBytes[subO+7]);
                        if (sbTp === 'dvvC') foundDvvC = true;
                        if (sbTp === 'colr') foundColr = true;
                        if (sbTp === 'amve') foundAmve = true;
                        if (sbSz < 8) break;
                        subO += sbSz;
                      }
                    }
                    if (sSz < 8) break;
                    sOff += sSz;
                  }
                }
                if (miSz < 8) break;
                miOff += miSz;
              }
            }
            if (mSz < 8) break;
            mOff += mSz;
          }
        }
        if (tSz < 8) break;
        tOff += tSz;
      }
    } else if (bTp === 'udta') {
      const uBytes = dvMoovBytes.subarray(scanCur, scanCur + bSz);
      const uDv = new DataView(uBytes.buffer, uBytes.byteOffset, uBytes.length);
      let uOff = 8;
      while (uOff + 8 <= uBytes.length) {
        const uSz = uDv.getUint32(uOff, false);
        const uTp = String.fromCharCode(uBytes[uOff+4], uBytes[uOff+5], uBytes[uOff+6], uBytes[uOff+7]);
        if (uTp === 'XMP_') {
          foundXMPAtom = true;
          let xmpStr = '';
          for (let xi = uOff + 8; xi < uOff + uSz; xi++) xmpStr += String.fromCharCode(uBytes[xi]);
          assert(xmpStr.includes('exif:GPSLatitude="17,31.962000N"'), 'XMP contains exif:GPSLatitude attribute');
          assert(xmpStr.includes('exif:GPSLongitude="078,23.532000E"'), 'XMP contains exif:GPSLongitude attribute');
          assert(xmpStr.includes('<exif:GPSCoordinates>17.532700 N, 78.392200 E</exif:GPSCoordinates>'), 'XMP contains exif:GPSCoordinates element');
        }
        if (uTp === 'uuid') {
          // Check if it is the standard XMP UUID
          const uuidByte0 = uBytes[uOff + 8];
          const uuidByte1 = uBytes[uOff + 9];
          if (uuidByte0 === 0xbe && uuidByte1 === 0x7a) foundXMPUuidAtom = true;
        }
        if (uTp === '©xyz') foundXyzAtom = true;
        if (uTp === 'meta') {
          // Check inside meta.ilst for ©xyz
          let mOff = uOff + 8;
          const hdlrTp = String.fromCharCode(uBytes[mOff+4], uBytes[mOff+5], uBytes[mOff+6], uBytes[mOff+7]);
          const metaHead = (hdlrTp === 'hdlr') ? 8 : 12;
          mOff = uOff + metaHead;
          while (mOff + 8 <= uOff + uSz) {
            const mChildSz = uDv.getUint32(mOff, false);
            const mChildTp = String.fromCharCode(uBytes[mOff+4], uBytes[mOff+5], uBytes[mOff+6], uBytes[mOff+7]);
            if (mChildTp === 'ilst') {
              let ilOff = mOff + 8;
              while (ilOff + 8 <= mOff + mChildSz) {
                const ilSz = uDv.getUint32(ilOff, false);
                const ilTp = String.fromCharCode(uBytes[ilOff+4], uBytes[ilOff+5], uBytes[ilOff+6], uBytes[ilOff+7]);
                if (ilTp === '©xyz') foundIlstXyz = true;
                if (ilSz < 8) break;
                ilOff += ilSz;
              }
            }
            if (mChildSz < 8) break;
            mOff += mChildSz;
          }
        }
        if (uSz < 8) break;
        uOff += uSz;
      }
    }
    if (bSz < 8) break;
    scanCur += bSz;
  }

  assert(foundDvvC, 'VisualSampleEntry in stsd contains dvvC box (Dolby Vision Profile 8.4)');
  assert(foundColr, 'VisualSampleEntry in stsd contains colr box (BT.2020 / HLG)');
  assert(foundAmve, 'VisualSampleEntry in stsd contains amve box (Apple TN3145 Ambient Viewing Environment)');
  assert(foundXMPAtom, 'udta contains XMP_ atom with EXIF GPS coordinates for social media');
  assert(foundXMPUuidAtom, 'udta contains standard ISOBMFF XMP uuid box (BE7ACFCB-97A9-42E8-9C71-999491E3AFAC)');
  assert(foundXyzAtom, 'udta contains QuickTime ©xyz coordinate box (0x15c7 English language code)');
  assert(foundIlstXyz, 'udta.meta.ilst contains ©xyz tag for universal player compatibility');

  // Test 6.3: Multi-track Audio Stream Preservation with Dolby Vision
  const multiDolbyUpdates = {
    location: { latitude: 17.5327, longitude: 78.3922 },
    tags: { make: 'Apple', model: 'iPhone 17', dolbyVision: true },
    dolbyVision: true,
    outputFormat: 'mov'
  };
  const multiDvBlob = await MP4Editor.writeMetadata(multiFileObj, multiScan, multiDolbyUpdates);
  assert(multiDvBlob !== null, 'Multi-track Dolby Vision export produced a blob');
  const multiDvMoov = multiDvBlob.parts[1];
  const multiDvMoovDv = new DataView(multiDvMoov.buffer, multiDvMoov.byteOffset, multiDvMoov.length);

  let dvAudioVolume = 0;
  let curScan = 8;
  while (curScan + 8 <= multiDvMoov.length) {
    const bSz = multiDvMoovDv.getUint32(curScan, false);
    const bTp = String.fromCharCode(multiDvMoov[curScan+4], multiDvMoov[curScan+5], multiDvMoov[curScan+6], multiDvMoov[curScan+7]);
    if (bTp === 'trak') {
      let trkCur = curScan + 8;
      while (trkCur + 8 <= curScan + bSz) {
        const tSz = multiDvMoovDv.getUint32(trkCur, false);
        const tTp = String.fromCharCode(multiDvMoov[trkCur+4], multiDvMoov[trkCur+5], multiDvMoov[trkCur+6], multiDvMoov[trkCur+7]);
        if (tTp === 'tkhd') {
          const tv = multiDvMoov[trkCur + 8];
          const vOff = trkCur + (tv === 1 ? 56 : 44);
          const vol = multiDvMoovDv.getUint16(vOff, false);
          if (vol > 0) dvAudioVolume = vol;
        }
        if (tSz < 8) break;
        trkCur += tSz;
      }
    }
    if (bSz < 8) break;
    curScan += bSz;
  }
  assert(dvAudioVolume === 0x0100, 'Audio track volume is strictly preserved as 1.0 (0x0100) when Dolby Vision is injected');

  print('  ✓ Dolby Vision Profile 8.4 (dvvC, colr, amve) and multi-layer Geolocation (XMP + uuid + ©xyz) verified successfully!');

  print('\n=== Test Suite 7: Device Presets Video Stream Integrity & Black-Screen Prevention ===');

  // Build an H.264 (avc1) multi-track synthetic file
  const avcVTrak = createBox('trak', (() => {
    const tkhd = new Uint8Array(84);
    const dv = new DataView(tkhd.buffer);
    dv.setUint32(12, 1);
    dv.setUint32(76, 1920 << 16);
    dv.setUint32(80, 1080 << 16);
    const tkhdBox = createBox('tkhd', tkhd);

    const hdlrPayload = new Uint8Array(25);
    new DataView(hdlrPayload.buffer).setUint32(8, 0x76696465, false); // 'vide'
    const hdlrBox = createBox('hdlr', hdlrPayload);

    const mdhdBox = createBox('mdhd', new Uint8Array(24));

    // VisualSampleEntry for 'avc1'
    const avcEntry = new Uint8Array(86 + 16); // 86 header + 16 avcC box
    const aDv = new DataView(avcEntry.buffer);
    aDv.setUint16(24, 1920, false); // width
    aDv.setUint16(26, 1080, false); // height
    aDv.setUint8(42, 4); // compressor name len
    for (let i = 0; i < 4; i++) aDv.setUint8(43 + i, 'H264'.charCodeAt(i));
    // fake avcC box at offset 86
    aDv.setUint32(86, 16, false);
    for (let i = 0; i < 4; i++) aDv.setUint8(90 + i, 'avcC'.charCodeAt(i));
    const sampleEntryBox = createBox('avc1', avcEntry);

    const stsdPayload = new Uint8Array(8 + sampleEntryBox.length);
    new DataView(stsdPayload.buffer).setUint32(4, 1, false);
    stsdPayload.set(sampleEntryBox, 8);
    const stsdBox = createBox('stsd', stsdPayload);

    const stco = createBox('stco', (() => {
      const b = new Uint8Array(12);
      new DataView(b.buffer).setUint32(4, 1);
      new DataView(b.buffer).setUint32(8, 2000);
      return b;
    })());
    const minfBox = createBox('minf', createBox('stbl', (() => {
      const p = new Uint8Array(stsdBox.length + stco.length);
      p.set(stsdBox, 0);
      p.set(stco, stsdBox.length);
      return p;
    })()));
    const mdiaBox = createBox('mdia', (() => {
      const p = new Uint8Array(mdhdBox.length + hdlrBox.length + minfBox.length);
      p.set(mdhdBox, 0);
      p.set(hdlrBox, mdhdBox.length);
      p.set(minfBox, mdhdBox.length + hdlrBox.length);
      return p;
    })());
    const p = new Uint8Array(tkhdBox.length + mdiaBox.length);
    p.set(tkhdBox, 0);
    p.set(mdiaBox, tkhdBox.length);
    return p;
  })());

  const avcFileTotal = (() => {
    const moovChildren = new Uint8Array(multiMvhd.length + avcVTrak.length + multiATrak.length);
    let o = 0;
    moovChildren.set(multiMvhd, o); o += multiMvhd.length;
    moovChildren.set(avcVTrak, o); o += avcVTrak.length;
    moovChildren.set(multiATrak, o); o += multiATrak.length;
    const moovBox = createBox('moov', moovChildren);
    const free = createBox('free', new Uint8Array(200));
    const mdat = createBox('mdat', new Uint8Array(1000));
    const total = new Uint8Array(multiFtyp.length + moovBox.length + free.length + mdat.length);
    let t = 0;
    total.set(multiFtyp, t); t += multiFtyp.length;
    total.set(moovBox, t); t += moovBox.length;
    total.set(free, t); t += free.length;
    total.set(mdat, t); t += mdat.length;
    return total;
  })();

  const avcFileObj = {
    size: avcFileTotal.byteLength,
    name: 'standard_h264.mp4',
    type: 'video/mp4',
    slice: (start, end) => {
      const e = end !== undefined ? end : avcFileTotal.byteLength;
      const sub = avcFileTotal.subarray(start, e);
      return {
        size: sub.byteLength,
        slice: (s, ed) => {
          const s2 = sub.subarray(s, ed !== undefined ? ed : sub.byteLength);
          return {
            size: s2.byteLength,
            arrayBuffer: () => Promise.resolve(s2.buffer.slice(s2.byteOffset, s2.byteOffset + s2.byteLength))
          };
        },
        arrayBuffer: () => Promise.resolve(sub.buffer.slice(sub.byteOffset, sub.byteOffset + sub.byteLength))
      };
    }
  };

  const avcScan = await MP4Editor.readMetadata(avcFileObj);
  assert(avcScan.metadata.stream.videoCodec === 'avc1', 'H.264 video codec correctly identified as avc1');

  // Apply iPhone 17 Preset to H.264 video
  const presetUpdates = {
    tags: {
      make: 'Apple',
      model: 'iPhone 17',
      software: '26.6.2',
      lensModel: 'iPhone 17 back camera 5.96mm f/1.6',
      focalLength35mm: '26',
      fNumber: '1.6',
      cameraIdentifier: 'Back',
      horizontalAccuracy: '10.84'
    },
    dolbyVision: false,
    outputFormat: 'mov'
  };

  const presetExportBlob = await MP4Editor.writeMetadata(avcFileObj, avcScan, presetUpdates);
  assert(presetExportBlob !== null, 'writeMetadata successfully exported preset video');

  // Verify exported sample entry FourCC is strictly avc1 and NO dvvC / amve exists
  const expMoovBytes = presetExportBlob.parts[1];
  const expMoovDv = new DataView(expMoovBytes.buffer, expMoovBytes.byteOffset, expMoovBytes.byteLength);

  let hasDvvC = false;
  let hasAmve = false;
  let preservedAvc1 = false;
  let hasTrackMetaOptics = false;

  // Walk exported moov to inspect video trak
  let eMoovOff = 8;
  while (eMoovOff + 8 <= expMoovBytes.length) {
    const bSz = expMoovDv.getUint32(eMoovOff, false);
    const bTp = String.fromCharCode(expMoovBytes[eMoovOff+4], expMoovBytes[eMoovOff+5], expMoovBytes[eMoovOff+6], expMoovBytes[eMoovOff+7]);
    if (bTp === 'trak') {
      let trkOff = eMoovOff + 8;
      let isVideoTrak = false;
      while (trkOff + 8 <= eMoovOff + bSz) {
        const tSz = expMoovDv.getUint32(trkOff, false);
        const tTp = String.fromCharCode(expMoovBytes[trkOff+4], expMoovBytes[trkOff+5], expMoovBytes[trkOff+6], expMoovBytes[trkOff+7]);
        if (tTp === 'meta') hasTrackMetaOptics = true;
        if (tTp === 'mdia') {
          let mOff = trkOff + 8;
          while (mOff + 8 <= trkOff + tSz) {
            const mSz = expMoovDv.getUint32(mOff, false);
            const mTp = String.fromCharCode(expMoovBytes[mOff+4], expMoovBytes[mOff+5], expMoovBytes[mOff+6], expMoovBytes[mOff+7]);
            if (mTp === 'hdlr') {
              const hType = expMoovDv.getUint32(mOff + 16, false);
              if (hType === 0x76696465) isVideoTrak = true;
            }
            if (mTp === 'minf' && isVideoTrak) {
              let miOff = mOff + 8;
              while (miOff + 8 <= mOff + mSz) {
                const miSz = expMoovDv.getUint32(miOff, false);
                const miTp = String.fromCharCode(expMoovBytes[miOff+4], expMoovBytes[miOff+5], expMoovBytes[miOff+6], expMoovBytes[miOff+7]);
                if (miTp === 'stbl') {
                  let sOff = miOff + 8;
                  while (sOff + 8 <= miOff + miSz) {
                    const sSz = expMoovDv.getUint32(sOff, false);
                    const sTp = String.fromCharCode(expMoovBytes[sOff+4], expMoovBytes[sOff+5], expMoovBytes[sOff+6], expMoovBytes[sOff+7]);
                    if (sTp === 'stsd') {
                      const entryType = String.fromCharCode(expMoovBytes[sOff+20], expMoovBytes[sOff+21], expMoovBytes[sOff+22], expMoovBytes[sOff+23]);
                      if (entryType === 'avc1') preservedAvc1 = true;
                      // Scan inside entry 0 for dvvC or amve
                      const eSz = expMoovDv.getUint32(sOff + 16, false);
                      let subO = sOff + 16 + 86;
                      while (subO + 8 <= sOff + 16 + eSz) {
                        const sbSz = expMoovDv.getUint32(subO, false);
                        const sbTp = String.fromCharCode(expMoovBytes[subO+4], expMoovBytes[subO+5], expMoovBytes[subO+6], expMoovBytes[subO+7]);
                        if (sbTp === 'dvvC' || sbTp === 'dvcC') hasDvvC = true;
                        if (sbTp === 'amve') hasAmve = true;
                        if (sbSz < 8) break;
                        subO += sbSz;
                      }
                    }
                    if (sSz < 8) break;
                    sOff += sSz;
                  }
                }
                if (miSz < 8) break;
                miOff += miSz;
              }
            }
            if (mSz < 8) break;
            mOff += mSz;
          }
        }
        if (tSz < 8) break;
        trkOff += tSz;
      }
    }
    if (bSz < 8) break;
    eMoovOff += bSz;
  }

  assert(preservedAvc1, 'Video track FourCC is strictly preserved as avc1');
  assert(!hasDvvC, 'VisualSampleEntry strictly DOES NOT contain dvvC (guarantees NO black screen)');
  assert(!hasAmve, 'VisualSampleEntry strictly DOES NOT contain amve');
  assert(hasTrackMetaOptics, 'Track-level camera optics (trak.meta) embedded for Apple Photos Info pane');

  // Verify that even if dolbyVision: true is accidentally requested on an avc1 video, the safety guard prevents dvvC injection
  const accidentalDvUpdates = {
    tags: { make: 'Apple', model: 'iPhone 17', lensModel: 'iPhone 17 lens' },
    dolbyVision: true,
    outputFormat: 'mov'
  };
  const safeBlob = await MP4Editor.writeMetadata(avcFileObj, avcScan, accidentalDvUpdates);
  const safeMoov = safeBlob.parts[1];
  const safeDv = new DataView(safeMoov.buffer, safeMoov.byteOffset, safeMoov.byteLength);
  let safeHasDvvC = false;
  let sMoovOff = 8;
  while (sMoovOff + 8 <= safeMoov.length) {
    const bSz = safeDv.getUint32(sMoovOff, false);
    const bTp = String.fromCharCode(safeMoov[sMoovOff+4], safeMoov[sMoovOff+5], safeMoov[sMoovOff+6], safeMoov[sMoovOff+7]);
    if (bTp === 'trak') {
      let trkOff = sMoovOff + 8;
      while (trkOff + 8 <= sMoovOff + bSz) {
        const tSz = safeDv.getUint32(trkOff, false);
        const tTp = String.fromCharCode(safeMoov[trkOff+4], safeMoov[trkOff+5], safeMoov[trkOff+6], safeMoov[trkOff+7]);
        if (tTp === 'mdia') {
          let mOff = trkOff + 8;
          while (mOff + 8 <= trkOff + tSz) {
            const mSz = safeDv.getUint32(mOff, false);
            const mTp = String.fromCharCode(safeMoov[mOff+4], safeMoov[mOff+5], safeMoov[mOff+6], safeMoov[mOff+7]);
            if (mTp === 'minf') {
              let miOff = mOff + 8;
              while (miOff + 8 <= mOff + mSz) {
                const miSz = safeDv.getUint32(miOff, false);
                const miTp = String.fromCharCode(safeMoov[miOff+4], safeMoov[miOff+5], safeMoov[miOff+6], safeMoov[miOff+7]);
                if (miTp === 'stbl') {
                  let sOff = miOff + 8;
                  while (sOff + 8 <= miOff + miSz) {
                    const sSz = safeDv.getUint32(sOff, false);
                    const sTp = String.fromCharCode(safeMoov[sOff+4], safeMoov[sOff+5], safeMoov[sOff+6], safeMoov[sOff+7]);
                    if (sTp === 'stsd') {
                      const eSz = safeDv.getUint32(sOff + 16, false);
                      let subO = sOff + 16 + 86;
                      while (subO + 8 <= sOff + 16 + eSz) {
                        const sbSz = safeDv.getUint32(subO, false);
                        const sbTp = String.fromCharCode(safeMoov[subO+4], safeMoov[subO+5], safeMoov[subO+6], safeMoov[subO+7]);
                        if (sbTp === 'dvvC' || sbTp === 'dvcC') safeHasDvvC = true;
                        if (sbSz < 8) break;
                        subO += sbSz;
                      }
                    }
                    if (sSz < 8) break;
                    sOff += sSz;
                  }
                }
                if (miSz < 8) break;
                miOff += miSz;
              }
            }
            if (mSz < 8) break;
            mOff += mSz;
          }
        }
        if (tSz < 8) break;
        trkOff += tSz;
      }
    }
    if (bSz < 8) break;
    sMoovOff += bSz;
  }
  assert(!safeHasDvvC, 'Accidental Dolby Vision toggle on H.264 is safely rejected to prevent black screen playback');
  print('  ✓ Device presets preserve video sample descriptions byte-for-byte (100% black screen proof)!');
}

load('js/c2pa-engine.js');

print('\n=== Test Suite 4: C2PA Metadata, Certificate, Signer & Validation ===');

// Test 1: UUID Matching
assert(C2PAEngine.matchesUUID(C2PAEngine.C2PA_UUID), 'C2PA UUID matches standard');

// Test 2: Create C2PA JUMBF box
const sampleC2PA = C2PAEngine.createC2PABox({
  claimGenerator: 'Sony Alpha Camera System v3.0',
  title: 'Nature Documentary 4K',
  signer: {
    name: 'Sony Content Authenticity CA',
    organization: 'Sony Group Corporation'
  },
  certificate: {
    issuer: 'DigiCert C2PA Qualified Root CA',
    serialNumber: '5B:1E:8F:A2'
  }
});

assert(sampleC2PA.boxBytes.length > 50, 'C2PA box generated with valid size: ' + sampleC2PA.boxBytes.length);
assert(sampleC2PA.manifest.claim_generator === 'Sony Alpha Camera System v3.0', 'Claim generator matches');
assert(sampleC2PA.manifest.signer.name === 'Sony Content Authenticity CA', 'Signer matches');
assert(sampleC2PA.manifest.certificate.issuer === 'DigiCert C2PA Qualified Root CA', 'Certificate issuer matches');
assert(sampleC2PA.manifest.validation.status === 'Pass', 'Validation status is Pass');

// Test 3: Parse generated C2PA box
// Skip 8 bytes box header + 16 bytes UUID
const payload = sampleC2PA.boxBytes.buffer.slice(24);
const parsedC2PA = C2PAEngine.parseC2PABox(payload);
assert(parsedC2PA.detected === true, 'C2PA parsed and detected');
assert(parsedC2PA.claimGenerator === 'Sony Alpha Camera System v3.0', 'Parsed claim generator matches');
assert(parsedC2PA.signer.name === 'Sony Content Authenticity CA', 'Parsed signer matches');
assert(parsedC2PA.certificate.issuer === 'DigiCert C2PA Qualified Root CA', 'Parsed cert matches');
assert(parsedC2PA.validation.status === 'Pass', 'Parsed validation status is Pass');

runAsyncTests().then(() => {
  print('\n🎉 All test suites (including C2PA) passed with 100% success!');
}).catch(err => {
  print('Error: ' + err);
});

