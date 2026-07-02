const { packager } = require('@electron/packager');
const path = require('path');

packager({
  dir: path.join(__dirname, '..'),
  name: 'ToDoMaru',
  platform: 'win32',
  arch: 'x64',
  out: path.join(__dirname, '..', 'dist'),
  overwrite: true,
  icon: path.join(__dirname, 'icon.ico'),
  ignore: [/^\/dist/, /^\/dist-build/, /^\/download/, /^\/release-parts/, /^\/build\/pack-win\.js$/],
  download: {
    checksums: {
      'electron-v31.7.7-win32-x64.zip':
        'e91986dd243d55947e6c5d3fad21795562ec21fa0eec5e95f7e28c830571467f'
    }
  }
})
  .then((paths) => console.log('Packaged:', paths))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
