# 🎬 VidMeta EXIF Studio

> **Fast, 100% Client-Side Video EXIF & Metadata Editor**  
> Edit video timestamps, GPS geotags, camera details, tags, and orientation directly in your browser with **zero uploads** and **zero re-encoding**.

Works everywhere: **macOS, Windows, Linux, iOS (iPhone/iPad), Android, Chromebooks**.

---

## ✨ Features

- **⚡ Instant & Lossless:** Modifies container header atoms (`moov`, `mvhd`, `udta`, `ilst`, `tkhd`) directly in milliseconds. Raw audio/video data (`mdat`) is **never re-encoded**, retaining 100% original quality.
- **🔒 100% Private (Zero Uploads):** Video files never leave your computer or phone. Everything processes locally via HTML5 File APIs. Handles multi-gigabyte (4K/8K) files effortlessly without exhausting memory.
- **📅 Timestamps & Dates:**
  - View and change `CreationDate` and `ModifyDate`.
  - Quick-action buttons: *Current Time*, *+1 Hour*, *-1 Hour*, *+1 Day*, *-1 Day*.
- **📍 Interactive GPS Geotagging:**
  - Interactive OpenStreetMap/Leaflet map: click or drag a marker to set coordinates.
  - Generates standard QuickTime `©xyz` ISO 6709 location tags (recognized by Apple Photos, Google Photos, etc.).
  - One-click **"Use Current Location"** button.
  - One-click **"Strip GPS"** for privacy.
- **📷 Camera & Hardware Information:**
  - Edit or scrub Camera Make, Model, and Software/Firmware.
  - Includes quick presets for *iPhone 15 Pro*, *Sony A7S III*, *GoPro Hero 12*, *DJI Mini 4 Pro*, and *Google Pixel*.
- **🏷️ Content & Media Tags:**
  - Title, Artist/Creator, Album/Project, Comments/Description, Copyright.
- **🔄 Lossless Orientation / Rotation:**
  - Instant rotation flag fix (0°, 90° CW, 180°, 270° CW) without video re-rendering.
- **🛡️ One-Click Privacy Scrubber:**
  - Single button to wipe all GPS, device model, and author information before sharing videos online.

---

## 🚀 How to Run Locally

You can run this application immediately with **zero installations**:

1. **Option A (Instant):**
   Simply open `index.html` in any modern web browser (Google Chrome, Safari, Microsoft Edge, Firefox, Brave).

2. **Option B (Local Web Server):**
   If you have Python or any local web server:
   ```bash
   cd /path/to/video-metadata-editor
   python3 -m http.server 8000
   ```
   Then visit `http://localhost:8000` in your browser.

---

## 🌐 How to Deploy to GitHub Pages (In 60 Seconds)

Because this app is 100% static client-side JavaScript, you can host it for free on GitHub Pages and access it from any phone or computer:

1. **Create a new repository on GitHub:**
   - Go to [GitHub.com/new](https://github.com/new)
   - Name your repository (e.g., `video-metadata-editor`)
   - Keep it Public (or Private with GitHub Pro)

2. **Push your code to GitHub:**
   ```bash
   cd /path/to/video-metadata-editor
   git init
   git add .
   git commit -m "Initial commit: Video EXIF Studio"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/<YOUR-REPO-NAME>.git
   git push -u origin main
   ```

3. **Enable GitHub Pages:**
   - On GitHub, go to your repository **Settings** $\rightarrow$ **Pages** (in the left sidebar).
   - Under **Build and deployment** $\rightarrow$ **Branch**, select `main` branch and `/ (root)` folder.
   - Click **Save**.

That's it! In about 30 seconds, your tool will be live at:
```
https://<YOUR-USERNAME>.github.io/<YOUR-REPO-NAME>/
```

---

## 📁 File Structure

```
video-metadata-editor/
├── index.html          # Main responsive user interface
├── .nojekyll           # Disables Jekyll processing for GitHub Pages
├── css/
│   └── styles.css      # Dark-mode styling, responsive layout
├── js/
│   ├── mp4-parser.js   # Binary MP4/MOV container parser & lossless writer
│   ├── geo-utils.js    # ISO 6709 geolocation parser and DMS formatter
│   └── app.js          # UI controller, Leaflet map binding, and export logic
└── README.md           # Documentation & instructions
```

---

## 🛠️ Supported Formats

- **MP4** (`.mp4`, `.m4v`)
- **QuickTime** (`.mov`)
- Supports containers from Apple iOS, Android, GoPro, Sony, Canon, DJI, Nikon, etc.
