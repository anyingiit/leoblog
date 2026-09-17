import {defineConfig} from 'astro/config';
import path from 'node:path';
import {resolveProfile} from './src/lib/profile.mjs';
const profile = resolveProfile();
export default defineConfig({output:'static',srcDir:profile==='minimal'?'./src/minimal':'./src',
  vite:profile==='minimal'?{publicDir:false}:undefined,
  site:profile==='minimal'?'https://douseful.eu.org':'https://leoblog.example.invalid',
  outDir:process.env.OUTPUT_DIR?path.resolve(process.env.OUTPUT_DIR):undefined,build:{format:'directory'}});
