/**
 * Geo Utilities for Video Metadata Editor
 * Handles ISO 6709 geographic coordinate parsing, formatting, and map helpers.
 */

const GeoUtils = {
  /**
   * Parses an ISO 6709 location string (e.g. "+37.7749-122.4194+015.000/" or "+37.7749-122.4194/")
   * Commonly found in QuickTime '©xyz' atoms and smartphone video headers.
   * @param {string} isoString
   * @returns {{latitude: number, longitude: number, altitude: number|null}|null}
   */
  parseISO6709(isoString) {
    if (!isoString || typeof isoString !== 'string') return null;

    // Clean up string: trim, remove trailing slash or spaces
    const clean = isoString.trim().replace(/\/$/, '');

    // ISO 6709 regex pattern:
    // ±DD.DDDD followed by ±DDD.DDDD and optional ±AAA.AAA
    const regex = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)(?:([+-]\d+(?:\.\d+)?))?$/;
    const match = clean.match(regex);

    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      const alt = match[3] !== undefined ? parseFloat(match[3]) : null;

      if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return {
          latitude: lat,
          longitude: lon,
          altitude: alt
        };
      }
    }

    return null;
  },

  /**
   * Formats latitude, longitude, and optional altitude into standard QuickTime ISO 6709 format.
   * Example: "+37.7749-122.4194+015.000/"
   * @param {number} lat - Latitude in degrees (-90 to 90)
   * @param {number} lon - Longitude in degrees (-180 to 180)
   * @param {number|null} [alt=null] - Altitude in meters
   * @returns {string}
   */
  formatISO6709(lat, lon, alt = null) {
    if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) return '';

    const latSign = lat >= 0 ? '+' : '-';
    const lonSign = lon >= 0 ? '+' : '-';

    const latStr = latSign + Math.abs(lat).toFixed(4).padStart(7, '0');
    const lonStr = lonSign + Math.abs(lon).toFixed(4).padStart(8, '0');

    let altStr = '';
    if (alt !== null && alt !== '' && !isNaN(alt)) {
      const altVal = parseFloat(alt);
      const altSign = altVal >= 0 ? '+' : '-';
      altStr = altSign + Math.abs(altVal).toFixed(3).padStart(7, '0');
    }

    return `${latStr}${lonStr}${altStr}/`;
  },

  /**
   * Formats decimal degrees into human-friendly DMS (Degrees, Minutes, Seconds) string.
   */
  toDMS(deg, isLat) {
    if (deg === null || isNaN(deg)) return '--';
    const absolute = Math.abs(deg);
    const degrees = Math.floor(absolute);
    const minutesNotTruncated = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesNotTruncated);
    const seconds = ((minutesNotTruncated - minutes) * 60).toFixed(1);

    const direction = isLat
      ? deg >= 0 ? 'N' : 'S'
      : deg >= 0 ? 'E' : 'W';

    return `${degrees}° ${minutes}' ${seconds}" ${direction}`;
  },

  /**
   * Formats latitude, longitude, and optional altitude into standard XMP/EXIF RDF format.
   * Recognized by social platforms (Instagram, Facebook), Google Photos, Adobe Premiere, and ExifTool.
   * @param {number} lat
   * @param {number} lon
   * @param {number|null} [alt=null]
   * @returns {{latitude: string, longitude: string, latitudeRef: string, longitudeRef: string, altitude: string|null, altitudeRef: string, coordinates: string}|null}
   */
  toXMPGPS(lat, lon, alt = null) {
    if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) return null;

    const latAbs = Math.abs(lat);
    const latDeg = Math.floor(latAbs);
    const latMin = (latAbs - latDeg) * 60;
    const latRef = lat >= 0 ? 'N' : 'S';
    const latXMP = `${String(latDeg).padStart(2, '0')},${latMin.toFixed(6)}${latRef}`;

    const lonAbs = Math.abs(lon);
    const lonDeg = Math.floor(lonAbs);
    const lonMin = (lonAbs - lonDeg) * 60;
    const lonRef = lon >= 0 ? 'E' : 'W';
    const lonXMP = `${String(lonDeg).padStart(3, '0')},${lonMin.toFixed(6)}${lonRef}`;

    let altXMP = null;
    let altRef = '0';
    if (alt !== null && alt !== '' && !isNaN(alt)) {
      const altNum = parseFloat(alt);
      altRef = altNum < 0 ? '1' : '0';
      altXMP = `${Math.round(Math.abs(altNum) * 100)}/100`;
    }

    const coordsXMP = `${latAbs.toFixed(6)} ${latRef}, ${lonAbs.toFixed(6)} ${lonRef}`;

    return {
      latitude: latXMP,
      longitude: lonXMP,
      latitudeRef: latRef,
      longitudeRef: lonRef,
      altitude: altXMP,
      altitudeRef: altRef,
      coordinates: coordsXMP
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeoUtils;
}
