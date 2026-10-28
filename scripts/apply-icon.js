'use strict';

const fs = require('fs');
const path = require('path');
const {
  NtExecutable, NtExecutableResource, Resource, Data
} = require('resedit');

const pkg = require('../package.json');
const appVersion = pkg.version;
const winVersion = appVersion + '.0';
const exePath = process.argv[2];
const icoPath = process.argv[3] || path.join(__dirname, '..', 'assets', 'icon.ico');

if (!exePath || !fs.existsSync(exePath)) {
  console.error('用法: node scripts/apply-icon.js <exe 路径> [ico 路径]');
  process.exit(1);
}
if (!fs.existsSync(icoPath)) {
  console.error('找不到图标文件:', icoPath);
  process.exit(1);
}

const source = fs.readFileSync(exePath);
const exe = NtExecutable.from(source, { ignoreCert: true });
const resources = NtExecutableResource.from(exe);
const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
const iconData = iconFile.icons.map((item) => item.data);

let ids = Resource.IconGroupEntry.fromEntries(resources.entries).map((entry) => entry.id);
if (!ids.length) ids = [1];
for (const id of ids) {
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries, id, 1033, iconData);
}

const versions = Resource.VersionInfo.fromEntries(resources.entries);
if (versions.length) {
  const info = versions[0];
  info.setFileVersion(winVersion, 1033);
  info.setProductVersion(winVersion, 1033);
  info.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: '提瓦特歇息之铃',
    ProductName: '提瓦特歇息之铃',
    CompanyName: 'TGBUG',
    LegalCopyright: 'MIT License',
    OriginalFilename: 'TeyvatSleepReminder.exe',
    InternalName: 'TeyvatSleepReminder',
    FileVersion: winVersion,
    ProductVersion: winVersion
  });
  info.outputToResourceEntries(resources.entries);
}

resources.outputResource(exe);
const output = Buffer.from(exe.generate());
const tempPath = exePath + '.tmp';
fs.writeFileSync(tempPath, output);
fs.renameSync(tempPath, exePath);
console.log('已写入图标与版本信息:', exePath, 'iconGroups=' + ids.join(','), 'versionInfo=' + versions.length);
