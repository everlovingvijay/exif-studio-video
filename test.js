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
const mdiaBox = createBox('mdia', hdlrBox);

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

