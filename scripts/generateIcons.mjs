import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
