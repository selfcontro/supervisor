import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SETTINGS_FILE = join(__dirname, '.claude', 'settings.local.json');

const config = existsSync(SETTINGS_FILE)
  ? JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
  : {};

config.permissions = config.permissions || {};
config.permissions.defaultMode = 'bypassPermissions';
delete config.permissions.mode;

writeFileSync(SETTINGS_FILE, JSON.stringify(config, null, 2));

console.log('已启用 bypassPermissions 模式');
console.log('配置文件:', SETTINGS_FILE);
