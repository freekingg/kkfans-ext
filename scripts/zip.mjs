import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const packageFile = fileURLToPath(new URL('../package.json', import.meta.url));
const wxtCli = fileURLToPath(new URL('../node_modules/wxt/bin/wxt.mjs', import.meta.url));

function nextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`package.json 版本号必须是 x.y.z 格式，当前为：${version}`);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function runWxtZip() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wxtCli, 'zip'], {
      cwd: rootDirectory,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `ZIP 打包被 ${signal} 中断` : `ZIP 打包失败，退出码 ${code}`));
    });
  });
}

const originalText = await readFile(packageFile, 'utf8');
const packageJson = JSON.parse(originalText);
const previousVersion = packageJson.version;
const nextVersion = nextPatchVersion(previousVersion);

packageJson.version = nextVersion;
await writeFile(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
console.log(`扩展版本：${previousVersion} → ${nextVersion}`);

try {
  await runWxtZip();
  console.log(`ZIP 打包完成，版本 ${nextVersion}`);
} catch (error) {
  await writeFile(packageFile, originalText, 'utf8');
  console.error(`打包未完成，版本号已恢复为 ${previousVersion}`);
  throw error;
}
