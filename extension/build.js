import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

mkdirSync('dist', { recursive: true });
cpSync('manifest.json', 'dist/manifest.json');
cpSync('src/popup.html', 'dist/popup.html');
cpSync('src/popup.css', 'dist/popup.css');
cpSync('src/permission.html', 'dist/permission.html');

const buildOptions = {
  entryPoints: ['src/popup.js', 'src/background.js', 'src/permission.js'],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome110',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('esbuild watching for changes...');
} else {
  await esbuild.build(buildOptions);
}
