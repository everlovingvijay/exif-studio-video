/**
 * MP4 / MOV Binary Box Parser and Lossless Metadata Editor
 * Runs 100% client-side in the browser.
 * Slices file headers so multi-gigabyte videos never exhaust browser RAM.
 */

const MP4Editor = (function () {
  // Mac/QuickTime epoch offset (Jan 1, 1904 to Jan 1, 1970 UTC in seconds)
  const MAC_EPOCH_OFFSET = 2082844800;

  // Standard 3x3 transformation matrices (fixed point 16.16) for rotation
  const ROTATION_MATRICES = {
    0: [
      0x00010000, 0, 0,
      0, 0x00010000, 0,
      0, 0, 0x40000000
    ],
    90: [
      0, 0x00010000, 0,
      -0x00010000, 0, 0,
      0, 0, 0x40000000 // translation updated per track dimensions
    ],
    180: [
      -0x00010000, 0, 0,
      0, -0x00010000, 0,
      0, 0, 0x40000000
    ],
    270: [
      0, -0x00010000, 0,
      0x00010000, 0, 0,
      0, 0, 0x40000000
    ]
  };

  /**
   * Helper: Read Big-Endian integers from DataView
   */
  function readUint32(view, offset) {
    return view.getUint32(offset, false);
  }

  function readUint64(view, offset) {
    const high = view.getUint32(offset, false);
    const low = view.getUint32(offset + 4, false);
    return (BigInt(high) << 32n) + BigInt(low);
  }

  function readASCII(view, offset, length) {
    let str = '';
    for (let i = 0; i < length; i++) {
      str += String.fromCharCode(view.getUint8(offset + i));
    }
    return str;
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, false);
  }

  function writeUint64(view, offset, value) {
    const bigVal = BigInt(value);
    const high = Number(bigVal >> 32n) >>> 0;
    const low = Number(bigVal & 0xffffffffn) >>> 0;
    view.setUint32(offset, high, false);
    view.setUint32(offset + 4, low, false);
  }

  function writeASCII(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Date conversions: Mac Epoch (1904) <-> JS Date (Unix 1970)
   */
  function macSecondsToDate(seconds) {
    if (!seconds || seconds <= 0) return null;
    const unixSeconds = Number(seconds) - MAC_EPOCH_OFFSET;
    return new Date(unixSeconds * 1000);
  }

  function dateToMacSeconds(date) {
    if (!date) return 0;
    const d = (date instanceof Date) ? date : new Date(date);
    const unixSeconds = Math.floor(d.getTime() / 1000);
    return unixSeconds + MAC_EPOCH_OFFSET;
  }

  /**
   * Reads a slice of a File as an ArrayBuffer
   */
  async function readFileSlice(file, start, end) {
    const slice = file.slice(start, end);
    return await slice.arrayBuffer();
  }

  /**
   * Scans top-level boxes of an MP4/MOV file without loading the whole file.
   * Returns metadata about where 'ftyp', 'moov', 'mdat' are located.
   */
  async function scanTopLevelBoxes(file) {
    const boxes = [];
    let offset = 0;
    const fileSize = file.size;

    while (offset < fileSize) {
      // Read 16 bytes: 4 bytes size, 4 bytes type, 8 bytes potential 64-bit size
      const headerLen = Math.min(16, fileSize - offset);
      if (headerLen < 8) break;

      const buf = await readFileSlice(file, offset, offset + headerLen);
      const view = new DataView(buf);
      let size = readUint32(view, 0);
      const type = readASCII(view, 4, 4);
      let headerSize = 8;

      if (size === 1) {
        // 64-bit size
        if (headerLen < 16) break;
        size = Number(readUint64(view, 8));
        headerSize = 16;
      } else if (size === 0) {
        // Box extends to end of file (common for trailing mdat)
        size = fileSize - offset;
      }

      let isC2PA = false;
      if (type === 'c2pa') {
        isC2PA = true;
      } else if (type === 'uuid' && offset + headerSize + 16 <= fileSize) {
        const uuidBuf = await readFileSlice(file, offset + headerSize, offset + headerSize + 16);
        if (typeof C2PAEngine !== 'undefined' && C2PAEngine.matchesUUID(new Uint8Array(uuidBuf))) {
          isC2PA = true;
        }
      }

      boxes.push({
        type,
        offset,
        size,
        headerSize,
        isC2PA
      });

      if (size <= 0) break;
      offset += size;
    }

    return boxes;
  }

  /**
   * Recursively parses an MP4 box tree from an ArrayBuffer
   */
  function parseBoxTree(buffer, startOffset = 0, length = buffer.byteLength) {
    const boxes = [];
    const view = new DataView(buffer);
    let offset = startOffset;
    const end = startOffset + length;

    while (offset + 8 <= end) {
      let size = readUint32(view, offset);
      const type = readASCII(view, offset + 4, 4);
      let headerSize = 8;

      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(readUint64(view, offset + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }

      if (size < headerSize || offset + size > end) {
        // Corrupted or truncated box
        break;
      }

      const payloadOffset = offset + headerSize;
      const payloadSize = size - headerSize;

      boxes.push({
        type,
        offset,
        size,
        headerSize,
        payloadOffset,
        payloadSize
      });

      offset += size;
    }

    return boxes;
  }

  /**
   * Reads metadata fields from the parsed 'moov' buffer
   */
  function extractMoovMetadata(moovBuffer, moovBox) {
    const view = new DataView(moovBuffer);
    const moovPayload = moovBuffer.slice(moovBox.headerSize);
    const children = parseBoxTree(moovBuffer, moovBox.headerSize, moovBox.size - moovBox.headerSize);

    const result = {
      creationDate: null,
      modifyDate: null,
      duration: 0,
      timescale: 1000,
      rotation: 0,
      width: 0,
      height: 0,
      location: null,
      tags: {
        title: '',
        artist: '',
        album: '',
        year: '',
        comment: '',
        copyright: '',
        make: '',
        model: '',
        software: ''
      },
      tracks: []
    };

    // 1. Check 'mvhd' (Movie Header)
    const mvhdBox = children.find(b => b.type === 'mvhd');
    if (mvhdBox) {
      const v = view.getUint8(mvhdBox.payloadOffset);
      let cTime, mTime, tScale, dur;
      if (v === 1) {
        cTime = Number(readUint64(view, mvhdBox.payloadOffset + 4));
        mTime = Number(readUint64(view, mvhdBox.payloadOffset + 12));
        tScale = readUint32(view, mvhdBox.payloadOffset + 20);
        dur = Number(readUint64(view, mvhdBox.payloadOffset + 24));
      } else {
        cTime = readUint32(view, mvhdBox.payloadOffset + 4);
        mTime = readUint32(view, mvhdBox.payloadOffset + 8);
        tScale = readUint32(view, mvhdBox.payloadOffset + 12);
        dur = readUint32(view, mvhdBox.payloadOffset + 16);
      }
      result.creationDate = macSecondsToDate(cTime);
      result.modifyDate = macSecondsToDate(mTime);
      result.timescale = tScale || 1000;
      result.duration = tScale ? (dur / tScale) : 0;
    }

    // 2. Check 'trak' boxes for video dimensions and rotation
    const trakBoxes = children.filter(b => b.type === 'trak');
    for (const trak of trakBoxes) {
      const trakChildren = parseBoxTree(moovBuffer, trak.payloadOffset, trak.payloadSize);
      const tkhd = trakChildren.find(b => b.type === 'tkhd');
      if (tkhd) {
        const v = view.getUint8(tkhd.payloadOffset);
        const matrixOffset = tkhd.payloadOffset + (v === 1 ? 52 : 40);
        const a = view.getInt32(matrixOffset, false);
        const b = view.getInt32(matrixOffset + 4, false);
        const c = view.getInt32(matrixOffset + 12, false);
        const d = view.getInt32(matrixOffset + 16, false);

        // Detect rotation from matrix
        let rot = 0;
        if (a === 0 && b === 0x10000 && c === -0x10000 && d === 0) rot = 90;
        else if (a === -0x10000 && b === 0 && c === 0 && d === -0x10000) rot = 180;
        else if (a === 0 && b === -0x10000 && c === 0x10000 && d === 0) rot = 270;

        const wOffset = tkhd.payloadOffset + (v === 1 ? 88 : 76);
        const hOffset = tkhd.payloadOffset + (v === 1 ? 92 : 80);
        const rawW = (view.getUint32(wOffset, false) >> 16);
        const rawH = (view.getUint32(hOffset, false) >> 16);

        // Check if track is a video track via mdia -> hdlr
        let isVideo = (rawW > 0 && rawH > 0);
        const mdia = trakChildren.find(b => b.type === 'mdia');
        if (mdia) {
          const mdiaChildren = parseBoxTree(moovBuffer, mdia.payloadOffset, mdia.payloadSize);
          const hdlr = mdiaChildren.find(b => b.type === 'hdlr');
          if (hdlr && hdlr.payloadSize >= 12) {
            const hType = readASCII(view, hdlr.payloadOffset + 8, 4);
            if (hType === 'vide') isVideo = true;
            else if (hType === 'soun' || hType === 'hint' || hType === 'meta') isVideo = false;
          }
        }

        if (isVideo && result.width === 0 && rawW > 0 && rawH > 0) {
          result.width = (rot === 90 || rot === 270) ? rawH : rawW;
          result.height = (rot === 90 || rot === 270) ? rawW : rawH;
          result.rawWidth = rawW;
          result.rawHeight = rawH;
          result.rotation = rot;
        }

        result.tracks.push({
          tkhdOffset: tkhd.payloadOffset,
          width: rawW,
          height: rawH,
          rotation: rot,
          isVideo
        });
      }
    }

    // 3. Check 'udta' (User Data) for GPS and iTunes/QuickTime tags
    const udtaBox = children.find(b => b.type === 'udta');
    if (udtaBox) {
      const udtaChildren = parseBoxTree(moovBuffer, udtaBox.payloadOffset, udtaBox.payloadSize);

      // Check '©xyz' for GPS coordinates
      const xyzBox = udtaChildren.find(b => b.type === '©xyz');
      if (xyzBox) {
        // QuickTime format: 2-byte language code followed by ISO 6709 string
        const strOffset = xyzBox.payloadOffset + 2;
        const strLen = xyzBox.payloadSize - 2;
        if (strLen > 0) {
          const rawLocation = readASCII(view, strOffset, strLen);
          result.locationRaw = rawLocation;
          if (typeof GeoUtils !== 'undefined') {
            result.location = GeoUtils.parseISO6709(rawLocation);
          }
        }
      }

      // Check 'meta' -> 'ilst' for media and device tags
      const metaBox = udtaChildren.find(b => b.type === 'meta');
      if (metaBox) {
        // meta box might have 4 bytes version/flags (FullBox) or standard box
        const metaPayloadOffset = metaBox.payloadOffset + 4;
        const metaPayloadSize = metaBox.payloadSize - 4;
        const metaChildren = parseBoxTree(moovBuffer, metaPayloadOffset, metaPayloadSize);
        const ilstBox = metaChildren.find(b => b.type === 'ilst');

        if (ilstBox) {
          const itemBoxes = parseBoxTree(moovBuffer, ilstBox.payloadOffset, ilstBox.payloadSize);
          for (const item of itemBoxes) {
            const dataBoxes = parseBoxTree(moovBuffer, item.payloadOffset, item.payloadSize);
            const dataBox = dataBoxes.find(b => b.type === 'data');
            if (dataBox && dataBox.payloadSize > 8) {
              // data box payload: 1 byte version, 3 bytes type flags, 4 bytes locale, then value
              const valOffset = dataBox.payloadOffset + 8;
              const valLen = dataBox.payloadSize - 8;
              const val = readASCII(view, valOffset, valLen);

              switch (item.type) {
                case '©nam': result.tags.title = val; break;
                case '©ART': result.tags.artist = val; break;
                case '©alb': result.tags.album = val; break;
                case '©day': result.tags.year = val; break;
                case '©cmt': result.tags.comment = val; break;
                case '©des':
                case 'desc': result.tags.comment = result.tags.comment || val; break;
                case 'cprt': result.tags.copyright = val; break;
                case '©mak':
                case 'make': result.tags.make = val; break;
                case '©mod':
                case 'model': result.tags.model = val; break;
                case '©swr':
                case 'soft': result.tags.software = val; break;
              }
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Helper: Builds an MP4 Box Uint8Array from type and payload
   */
  function createBox(type, payloadUint8) {
    const size = 8 + payloadUint8.length;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    writeUint32(view, 0, size);
    writeASCII(view, 4, type);
    out.set(payloadUint8, 8);
    return out;
  }

  /**
   * Helper: UTF-8 encoder with fallback for environments where TextEncoder is not global
   */
  function encodeUTF8(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    const utf8 = [];
    for (let i = 0; i < str.length; i++) {
      let charcode = str.charCodeAt(i);
      if (charcode < 0x80) {
        utf8.push(charcode);
      } else if (charcode < 0x800) {
        utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
      } else if (charcode < 0xd800 || charcode >= 0xe000) {
        utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
      } else {
        i++;
        charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        utf8.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
      }
    }
    return new Uint8Array(utf8);
  }

  /**
   * Helper: Builds an ilst tag box with an inner 'data' box (UTF-8 string)
   */
  function createIlstStringTag(tagType, str) {
    const strBytes = encodeUTF8(str);
    const dataSize = 16 + strBytes.length;
    const dataBox = new Uint8Array(dataSize);
    const dv = new DataView(dataBox.buffer);
    writeUint32(dv, 0, dataSize);
    writeASCII(dv, 4, 'data');
    dv.setUint8(8, 0); // version
    dv.setUint8(9, 0); // flags type: 1 = UTF-8 text
    dv.setUint8(10, 0);
    dv.setUint8(11, 1);
    writeUint32(dv, 12, 0); // locale
    dataBox.set(strBytes, 16);

    return createBox(tagType, dataBox);
  }

  /**
   * Creates a 'udta' (User Data) box containing GPS ('©xyz') and 'meta.ilst' tags.
   */
  function buildUdtaBox(tags, locationString) {
    const parts = [];

    // 1. Add GPS '©xyz' box if location exists
    if (locationString) {
      const locBytes = encodeUTF8(locationString);
      const xyzPayload = new Uint8Array(2 + locBytes.length);
      const dv = new DataView(xyzPayload.buffer);
      dv.setUint16(0, 0x15c7); // QuickTime language code English
      xyzPayload.set(locBytes, 2);
      parts.push(createBox('©xyz', xyzPayload));
    }

    // 2. Build 'meta.ilst' tags
    const ilstParts = [];
    if (tags.title) ilstParts.push(createIlstStringTag('©nam', tags.title));
    if (tags.artist) ilstParts.push(createIlstStringTag('©ART', tags.artist));
    if (tags.album) ilstParts.push(createIlstStringTag('©alb', tags.album));
    if (tags.year) ilstParts.push(createIlstStringTag('©day', tags.year));
    if (tags.comment) ilstParts.push(createIlstStringTag('©cmt', tags.comment));
    if (tags.copyright) ilstParts.push(createIlstStringTag('cprt', tags.copyright));
    if (tags.make) ilstParts.push(createIlstStringTag('©mak', tags.make));
    if (tags.model) ilstParts.push(createIlstStringTag('©mod', tags.model));
    if (tags.software) ilstParts.push(createIlstStringTag('©swr', tags.software));

    if (ilstParts.length > 0) {
      // Concatenate ilst tags
      const ilstTotalSize = ilstParts.reduce((acc, p) => acc + p.length, 0);
      const ilstPayload = new Uint8Array(ilstTotalSize);
      let offset = 0;
      for (const p of ilstParts) {
        ilstPayload.set(p, offset);
        offset += p.length;
      }
      const ilstBox = createBox('ilst', ilstPayload);

      // Handler box 'hdlr' for metadata
      const hdlrPayload = new Uint8Array(25);
      const hdlrView = new DataView(hdlrPayload.buffer);
      writeUint32(hdlrView, 0, 0); // version & flags
      writeUint32(hdlrView, 4, 0); // pre-defined
      writeASCII(hdlrView, 8, 'mdir'); // handler type
      writeASCII(hdlrView, 12, 'appl'); // manufacturer
      writeUint32(hdlrView, 16, 0); // component flags
      writeUint32(hdlrView, 20, 0); // component flags mask
      hdlrPayload[24] = 0; // component name (empty Pascal string)
      const hdlrBox = createBox('hdlr', hdlrPayload);

      // Meta box: 4 bytes version/flags (0) followed by hdlr and ilst
      const metaPayload = new Uint8Array(4 + hdlrBox.length + ilstBox.length);
      metaPayload.set(hdlrBox, 4);
      metaPayload.set(ilstBox, 4 + hdlrBox.length);
      const metaBox = createBox('meta', metaPayload);

      parts.push(metaBox);
    }

    if (parts.length === 0) return null;

    const totalUdtaSize = parts.reduce((acc, p) => acc + p.length, 0);
    const udtaPayload = new Uint8Array(totalUdtaSize);
    let off = 0;
    for (const p of parts) {
      udtaPayload.set(p, off);
      off += p.length;
    }
    return createBox('udta', udtaPayload);
  }

  /**
   * Rewrites timestamp boxes in-place inside a moov buffer.
   */
  function updateTimestamps(moovBytes, cTimeSec, mTimeSec) {
    const view = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    const children = parseBoxTree(moovBytes.buffer, moovBytes.byteOffset + 8, moovBytes.byteLength - 8);

    // 1. Update 'mvhd'
    const mvhd = children.find(b => b.type === 'mvhd');
    if (mvhd) {
      const v = view.getUint8(mvhd.payloadOffset);
      if (v === 1) {
        if (cTimeSec) writeUint64(view, mvhd.payloadOffset + 4, cTimeSec);
        if (mTimeSec) writeUint64(view, mvhd.payloadOffset + 12, mTimeSec);
      } else {
        if (cTimeSec) writeUint32(view, mvhd.payloadOffset + 4, cTimeSec);
        if (mTimeSec) writeUint32(view, mvhd.payloadOffset + 8, mTimeSec);
      }
    }

    // 2. Update each 'trak'
    const traks = children.filter(b => b.type === 'trak');
    for (const trak of traks) {
      const trakChildren = parseBoxTree(moovBytes.buffer, trak.payloadOffset, trak.payloadSize);
      const tkhd = trakChildren.find(b => b.type === 'tkhd');
      if (tkhd) {
        const v = view.getUint8(tkhd.payloadOffset);
        if (v === 1) {
          if (cTimeSec) writeUint64(view, tkhd.payloadOffset + 4, cTimeSec);
          if (mTimeSec) writeUint64(view, tkhd.payloadOffset + 12, mTimeSec);
        } else {
          if (cTimeSec) writeUint32(view, tkhd.payloadOffset + 4, cTimeSec);
          if (mTimeSec) writeUint32(view, tkhd.payloadOffset + 8, mTimeSec);
        }
      }

      // Update 'mdia' -> 'mdhd'
      const mdia = trakChildren.find(b => b.type === 'mdia');
      if (mdia) {
        const mdiaChildren = parseBoxTree(moovBytes.buffer, mdia.payloadOffset, mdia.payloadSize);
        const mdhd = mdiaChildren.find(b => b.type === 'mdhd');
        if (mdhd) {
          const v = view.getUint8(mdhd.payloadOffset);
          if (v === 1) {
            if (cTimeSec) writeUint64(view, mdhd.payloadOffset + 4, cTimeSec);
            if (mTimeSec) writeUint64(view, mdhd.payloadOffset + 12, mTimeSec);
          } else {
            if (cTimeSec) writeUint32(view, mdhd.payloadOffset + 4, cTimeSec);
            if (mTimeSec) writeUint32(view, mdhd.payloadOffset + 8, mTimeSec);
          }
        }
      }
    }
  }

  /**
   * Updates rotation matrix in the video track's 'tkhd' box.
   * Modifies ONLY the 36-byte matrix, leaving track volume, reserved bytes,
   * width, and height 100% intact.
   */
  function updateRotationMatrix(moovBytes, rotationDeg) {
    const view = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    const children = parseBoxTree(moovBytes.buffer, moovBytes.byteOffset + 8, moovBytes.byteLength - 8);
    const traks = children.filter(b => b.type === 'trak');

    for (const trak of traks) {
      const trakChildren = parseBoxTree(moovBytes.buffer, trak.payloadOffset, trak.payloadSize);
      const tkhd = trakChildren.find(b => b.type === 'tkhd');
      if (!tkhd) continue;

      const v = view.getUint8(tkhd.payloadOffset);
      const wOffset = tkhd.payloadOffset + (v === 1 ? 88 : 76);
      const hOffset = tkhd.payloadOffset + (v === 1 ? 92 : 80);
      const rawWFixed = view.getUint32(wOffset, false);
      const rawHFixed = view.getUint32(hOffset, false);

      // Check if this track is video
      let isVideo = (rawWFixed > 0 && rawHFixed > 0);
      const mdia = trakChildren.find(b => b.type === 'mdia');
      if (mdia) {
        const mdiaChildren = parseBoxTree(moovBytes.buffer, mdia.payloadOffset, mdia.payloadSize);
        const hdlr = mdiaChildren.find(b => b.type === 'hdlr');
        if (hdlr && hdlr.payloadSize >= 12) {
          const hType = readASCII(view, hdlr.payloadOffset + 8, 4);
          if (hType === 'vide') isVideo = true;
          else if (hType === 'soun' || hType === 'hint' || hType === 'meta') isVideo = false;
        }
      }

      if (!isVideo) continue;

      // ISOBMFF TrackHeaderBox: matrix begins at byte 40 for v0, byte 52 for v1
      const matrixOffset = tkhd.payloadOffset + (v === 1 ? 52 : 40);

      // Standard fixed-point matrix:
      // [ a  b  u ]
      // [ c  d  v ]
      // [ x  y  w ]
      // a, b, c, d, x, y are 16.16 fixed point.
      // u, v, w are 2.30 fixed point (u=0, v=0, w=1.0 = 0x40000000).
      let a = 0x00010000, b = 0, c = 0, d = 0x00010000, x = 0, y = 0;

      if (rotationDeg === 90) {
        a = 0;
        b = 0x00010000;
        c = -0x00010000;
        d = 0;
        x = rawHFixed;
        y = 0;
      } else if (rotationDeg === 180) {
        a = -0x00010000;
        b = 0;
        c = 0;
        d = -0x00010000;
        x = rawWFixed;
        y = rawHFixed;
      } else if (rotationDeg === 270) {
        a = 0;
        b = -0x00010000;
        c = 0x00010000;
        d = 0;
        x = 0;
        y = rawWFixed;
      } else {
        // 0 degrees / identity
        a = 0x00010000;
        b = 0;
        c = 0;
        d = 0x00010000;
        x = 0;
        y = 0;
      }

      view.setInt32(matrixOffset, a, false);
      view.setInt32(matrixOffset + 4, b, false);
      view.setInt32(matrixOffset + 8, 0, false);       // u = 0
      view.setInt32(matrixOffset + 12, c, false);
      view.setInt32(matrixOffset + 16, d, false);
      view.setInt32(matrixOffset + 20, 0, false);      // v = 0
      view.setInt32(matrixOffset + 24, x, false);
      view.setInt32(matrixOffset + 28, y, false);
      view.setInt32(matrixOffset + 32, 0x40000000, false); // w = 1.0 (0x40000000)

      break; // Only rotate video track
    }
  }

  /**
   * Adjusts 'stco' and 'co64' chunk offsets when moov shifts relative to mdat.
   */
  function adjustChunkOffsets(moovBytes, deltaOffset) {
    if (deltaOffset === 0) return;

    const view = new DataView(moovBytes.buffer, moovBytes.byteOffset, moovBytes.byteLength);
    const children = parseBoxTree(moovBytes.buffer, moovBytes.byteOffset + 8, moovBytes.byteLength - 8);
    const traks = children.filter(b => b.type === 'trak');

    for (const trak of traks) {
      const trakChildren = parseBoxTree(moovBytes.buffer, trak.payloadOffset, trak.payloadSize);
      const mdia = trakChildren.find(b => b.type === 'mdia');
      if (!mdia) continue;

      const mdiaChildren = parseBoxTree(moovBytes.buffer, mdia.payloadOffset, mdia.payloadSize);
      const minf = mdiaChildren.find(b => b.type === 'minf');
      if (!minf) continue;

      const minfChildren = parseBoxTree(moovBytes.buffer, minf.payloadOffset, minf.payloadSize);
      const stbl = minfChildren.find(b => b.type === 'stbl');
      if (!stbl) continue;

      const stblChildren = parseBoxTree(moovBytes.buffer, stbl.payloadOffset, stbl.payloadSize);

      // 32-bit chunk offsets (stco)
      const stco = stblChildren.find(b => b.type === 'stco');
      if (stco) {
        const count = view.getUint32(stco.payloadOffset + 4, false);
        let entryOffset = stco.payloadOffset + 8;
        for (let i = 0; i < count; i++) {
          const currentOffset = view.getUint32(entryOffset, false);
          view.setUint32(entryOffset, (currentOffset + deltaOffset) >>> 0, false);
          entryOffset += 4;
        }
      }

      // 64-bit chunk offsets (co64)
      const co64 = stblChildren.find(b => b.type === 'co64');
      if (co64) {
        const count = view.getUint32(co64.payloadOffset + 4, false);
        let entryOffset = co64.payloadOffset + 8;
        for (let i = 0; i < count; i++) {
          const currentOffset = readUint64(view, entryOffset);
          writeUint64(view, entryOffset, BigInt(currentOffset) + BigInt(deltaOffset));
          entryOffset += 8;
        }
      }
    }
  }

  // Public API
  return {
    scanTopLevelBoxes,
    readFileSlice,
    extractMoovMetadata,

    /**
     * Primary parsing function: Reads video metadata from a File or Blob.
     */
    async readMetadata(file) {
      const topBoxes = await scanTopLevelBoxes(file);
      const moovBox = topBoxes.find(b => b.type === 'moov');

      if (!moovBox) {
        throw new Error("Invalid video: 'moov' metadata box not found. The file may be corrupt or an unsupported container.");
      }

      // Read only the moov box
      const moovBuffer = await readFileSlice(file, moovBox.offset, moovBox.offset + moovBox.size);
      const metadata = extractMoovMetadata(moovBuffer, moovBox);

      // Check for C2PA box
      const c2paBox = topBoxes.find(b => b.isC2PA);
      if (c2paBox) {
        const c2paBuf = await readFileSlice(file, c2paBox.offset + c2paBox.headerSize + 16, c2paBox.offset + c2paBox.size);
        if (typeof C2PAEngine !== 'undefined') {
          metadata.c2pa = C2PAEngine.parseC2PABox(c2paBuf);
        }
      } else {
        metadata.c2pa = null;
      }

      return {
        metadata,
        topBoxes,
        moovBox,
        fileSize: file.size
      };
    },

    /**
     * Primary writing function: Generates updated lossless video file Blob.
     */
    async writeMetadata(file, scanResult, updates) {
      const { topBoxes, moovBox } = scanResult;

      // 1. Read fresh copy of moov buffer
      const moovBuffer = await readFileSlice(file, moovBox.offset, moovBox.offset + moovBox.size);
      const view = new DataView(moovBuffer);
      const children = parseBoxTree(moovBuffer, 8, moovBox.size - 8);

      // 2. Separate existing non-udta children from udta
      const nonUdtaChildren = children.filter(b => b.type !== 'udta');
      const existingUdta = children.find(b => b.type === 'udta');

      // 3. Build new udta box
      let locationString = '';
      if (!updates.scrubAll && updates.location) {
        if (typeof GeoUtils !== 'undefined') {
          locationString = GeoUtils.formatISO6709(
            updates.location.latitude,
            updates.location.longitude,
            updates.location.altitude
          );
        }
      }

      const tags = updates.scrubAll ? {} : (updates.tags || {});
      const newUdta = buildUdtaBox(tags, locationString);

      // 4. Calculate new moov size and construct new moov payload
      let nonUdtaTotalSize = 0;
      for (const c of nonUdtaChildren) {
        nonUdtaTotalSize += c.size;
      }
      const newUdtaSize = newUdta ? newUdta.length : 0;
      const newMoovSize = 8 + nonUdtaTotalSize + newUdtaSize;

      const newMoov = new Uint8Array(newMoovSize);
      const newMoovView = new DataView(newMoov.buffer);
      writeUint32(newMoovView, 0, newMoovSize);
      writeASCII(newMoovView, 4, 'moov');

      // Copy non-udta children
      let copyOffset = 8;
      for (const c of nonUdtaChildren) {
        const chunk = new Uint8Array(moovBuffer, c.offset, c.size);
        newMoov.set(chunk, copyOffset);
        copyOffset += c.size;
      }

      // Append new udta
      if (newUdta) {
        newMoov.set(newUdta, copyOffset);
      }

      // 5. Update timestamps in newMoov
      const cTimeSec = updates.creationDate ? dateToMacSeconds(updates.creationDate) : null;
      const mTimeSec = updates.modifyDate ? dateToMacSeconds(updates.modifyDate) : null;
      updateTimestamps(newMoov, cTimeSec, mTimeSec);

      // 6. Update rotation in newMoov only if explicitly requested
      if (typeof updates.rotation === 'number') {
        updateRotationMatrix(newMoov, updates.rotation);
      }

      // 7. C2PA box preparation
      let newC2PABox = null;
      if (!updates.stripC2PA && updates.c2pa && typeof C2PAEngine !== 'undefined') {
        newC2PABox = C2PAEngine.createC2PABox(updates.c2pa).boxBytes;
      }

      const existingC2PABox = topBoxes.find(b => b.isC2PA);
      const oldC2PASize = existingC2PABox ? existingC2PABox.size : 0;
      const newC2PASize = newC2PABox ? newC2PABox.length : 0;

      // 8. Handle chunk offset shifting (stco/co64)
      const mdatBox = topBoxes.find(b => b.type === 'mdat');
      const isMoovBeforeMdat = mdatBox && moovBox.offset < mdatBox.offset;

      const delta = (newMoovSize - moovBox.size) + (newC2PASize - oldC2PASize);
      if (isMoovBeforeMdat && delta !== 0) {
        adjustChunkOffsets(newMoov, delta);
      }

      // 9. Assemble final file slices as a Blob (Instant, lossless, 0 extra RAM)
      const slices = [];
      if (moovBox.offset > 0) {
        if (existingC2PABox && existingC2PABox.offset < moovBox.offset) {
          slices.push(file.slice(0, existingC2PABox.offset));
          if (newC2PABox) slices.push(newC2PABox);
          slices.push(file.slice(existingC2PABox.offset + existingC2PABox.size, moovBox.offset));
        } else {
          slices.push(file.slice(0, moovBox.offset));
          if (newC2PABox && !existingC2PABox) slices.push(newC2PABox);
        }
      } else {
        if (newC2PABox && !existingC2PABox) slices.push(newC2PABox);
      }

      slices.push(newMoov);

      const afterMoovOffset = moovBox.offset + moovBox.size;
      if (afterMoovOffset < file.size) {
        if (existingC2PABox && existingC2PABox.offset >= afterMoovOffset) {
          slices.push(file.slice(afterMoovOffset, existingC2PABox.offset));
          if (newC2PABox) slices.push(newC2PABox);
          slices.push(file.slice(existingC2PABox.offset + existingC2PABox.size));
        } else {
          slices.push(file.slice(afterMoovOffset));
        }
      }

      return new Blob(slices, { type: file.type || 'video/mp4' });
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MP4Editor;
}
