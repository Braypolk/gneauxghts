import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const icons = path.join(root, 'src-tauri/icons');
const catalog = path.join(icons, 'ios/Contents.json');
const temporary = mkdtempSync(path.join(tmpdir(), 'gneauxghts-icons-'));
const tauri = path.join(root, 'node_modules/.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

function generate(source, output, background) {
  run(tauri, ['icon', source, '--output', output, '--ios-color', background]);
}

function generateMacIcon(theme) {
  // Legacy ICNS and AppKit's applicationIconImage use the complete canvas,
  // including its transparent margin. Mobile sources intentionally remain full bleed.
  const dark = theme === 'dark';
  const artwork = readFileSync(path.join(root, `static/logo-${theme}.svg`), 'utf8')
    .replace('width="150" height="150"', 'x="100" y="100" width="824" height="824"')
    .replace(/<rect[^>]+\/>/, `<defs>
      <linearGradient id="mac-face" x1="75" y1="0" x2="75" y2="150" gradientUnits="userSpaceOnUse">
        <stop stop-color="${dark ? '#252525' : '#FFFFFF'}"/>
        <stop offset="1" stop-color="${dark ? '#0A0A0A' : '#ECECEC'}"/>
      </linearGradient>
      <linearGradient id="mac-rim" x1="15" y1="0" x2="120" y2="150" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFFFFF" stop-opacity="${dark ? '0.6' : '0.95'}"/>
        <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="${dark ? '0.22' : '0.55'}"/>
        <stop offset="1" stop-color="${dark ? '#FFFFFF' : '#808080'}" stop-opacity="0.12"/>
      </linearGradient>
    </defs>
    <rect width="150" height="150" rx="35" fill="url(#mac-face)"/>
    <rect x="0.75" y="0.75" width="148.5" height="148.5" rx="34.25" stroke="url(#mac-rim)" stroke-width="1.5"/>`);
  const source = path.join(temporary, `macos-${theme}.svg`);
  const output = path.join(temporary, `macos-${theme}`);
  writeFileSync(source, `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">${artwork}</svg>`);
  generate(source, output, dark ? '#0A0A0A' : '#FFFFFF');
  copyFileSync(path.join(output, 'icon.png'), path.join(icons, `macos-${theme}.png`));
  if (!dark) copyFileSync(path.join(output, 'icon.icns'), path.join(icons, 'icon.icns'));
}

try {
  // ImageMagick flattens the rounded SVG backgrounds for Apple's system mask.
  run('magick', ['-version']);
  // Generate in fresh folders: Tauri preserves existing mobile icon files.
  const lightIcons = path.join(temporary, 'light');
  const darkIcons = path.join(temporary, 'dark');
  generate('static/logo-light.svg', lightIcons, '#FFFFFF');
  generate('static/logo-dark.svg', darkIcons, '#0A0A0A');
  cpSync(lightIcons, icons, { recursive: true });
  copyFileSync(path.join(darkIcons, 'icon.png'), path.join(icons, 'icon-dark.png'));
  generateMacIcon('light');
  generateMacIcon('dark');

  // Xcode derives device sizes from these universal sources and preserves appearances.
  copyFileSync(path.join(darkIcons, 'ios/AppIcon-512@2x.png'), path.join(icons, 'ios/AppIcon-512@2x-dark.png'));
  const contents = {
    images: [
      { filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
      {
        filename: 'AppIcon-512@2x-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024',
        appearances: [{ appearance: 'luminosity', value: 'dark' }]
      }
    ],
    info: { version: 1, author: 'xcode' }
  };
  writeFileSync(catalog, `${JSON.stringify(contents, null, 2)}\n`);

  const appleIcons = path.join(root, 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset');
  for (const entry of readdirSync(path.join(icons, 'ios'))) {
    if (entry.endsWith('.png')) {
      const filename = path.join(icons, 'ios', entry);
      run('magick', [filename, '-background', entry.endsWith('-dark.png') ? '#0A0A0A' : '#FFFFFF',
        '-alpha', 'remove', '-alpha', 'off', '-depth', '8', '-strip', '-define', 'png:color-type=2', filename]);
    }
    if (entry.endsWith('.png') || entry === 'Contents.json') {
      copyFileSync(path.join(icons, 'ios', entry), path.join(appleIcons, entry));
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
