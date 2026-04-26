// Converts build/icon.png → build/icon.ico (Windows) and build/icon.icns (Mac).
// Run via: npm run build-icons
// Requires: png-to-ico, sharp (devDependencies)
const path = require('path');
const fs = require('fs');

const src = path.join(__dirname, '..', 'build', 'icon.png');

if (!fs.existsSync(src)) {
  console.error('ERROR: build/icon.png not found. Save your icon image there first.');
  process.exit(1);
}

async function run() {
  // --- Windows ICO ---
  try {
    const pngToIco = require('png-to-ico');
    const icoBuffer = await pngToIco(src);
    fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), icoBuffer);
    console.log('✓ build/icon.ico generated');
  } catch (e) {
    console.error('ICO generation failed:', e.message);
    process.exit(1);
  }

  // --- macOS ICNS (only needed on a Mac build machine; skip silently on Windows) ---
  if (process.platform === 'darwin') {
    try {
      const sharp = require('sharp');
      const icns = require('icns-lib');
      const sizes = [16, 32, 64, 128, 256, 512, 1024];
      const images = {};
      for (const size of sizes) {
        images[`ic${String(size).padStart(2, '0')}`] = await sharp(src).resize(size, size).toBuffer();
      }
      fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.icns'), icns.encode(images));
      console.log('✓ build/icon.icns generated');
    } catch (e) {
      // icns generation is optional on non-Mac machines
      console.warn('ICNS generation skipped (not on macOS or icns-lib unavailable):', e.message);
    }
  } else {
    console.log('ℹ  build/icon.icns skipped (only generated on macOS build machines)');
  }
}

run();
