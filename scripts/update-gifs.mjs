import fs from 'fs';
import path from 'path';

const gifsDirectory = path.join(process.cwd(), 'public/gifs');
const dataFile = path.join(process.cwd(), 'data/gifs.json');
// Optional credits for clips that came from elsewhere (Giphy, Internet Archive), keyed by file path.
const sourcesFile = path.join(process.cwd(), 'data/sources.json');
const sources = fs.existsSync(sourcesFile) ? JSON.parse(fs.readFileSync(sourcesFile, 'utf8')) : {};

const EXTENSIONS = {
  '.gif': 'gif',
  '.mp4': 'video',
  '.webm': 'video',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
};

function getGifs(dir, basePath = '') {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const gifs = dirents.flatMap((dirent) => {
    const res = path.resolve(dir, dirent.name);
    const relativePath = path.join(basePath, dirent.name);
    const type = EXTENSIONS[path.extname(dirent.name).toLowerCase()];
    if (dirent.isDirectory()) {
      return getGifs(res, relativePath);
    } else if (dirent.isFile() && type) {
      // The top-level folder is the category.
      const category = basePath ? formatCategory(basePath.split(path.sep)[0]) : 'Uncategorized';
      const src = sources[relativePath] || {};
      return {
        title: src.title || formatTitle(dirent.name),
        category: category,
        file: relativePath,
        type: type,
        ...(src.tags ? { tags: src.tags } : {}),
        ...(src.source ? { source: src.source } : {}),
        ...(src.url ? { url: src.url } : {}),
      };
    }
    return [];
  });
  return gifs;
}

function formatTitle(filename) {
  const name = path.basename(filename, path.extname(filename));
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCategory(dirname) {
  return dirname.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

try {
  console.log('Scanning for GIFs...');
  const allGifs = getGifs(gifsDirectory);
  const PINNED_ORDER = [
    'memes/chad-dario.png',
    'memes/donald-trump-looking-at-nicky-minaj.webp',
    'memes/wojak-group-hug.webp',
    'memes/chad-xi-template.jpg',
  ];
  allGifs.sort((a, b) => {
    const aIdx = PINNED_ORDER.indexOf(a.file);
    const bIdx = PINNED_ORDER.indexOf(b.file);
    if (aIdx !== -1 || bIdx !== -1) {
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    }
    const aIsMeme = a.file.startsWith('memes/') ? 0 : 1;
    const bIsMeme = b.file.startsWith('memes/') ? 0 : 1;
    if (aIsMeme !== bIsMeme) return aIsMeme - bIsMeme;
    return 0;
  });

  const gifsWithIds = allGifs.map((gif, index) => ({
    id: index + 1,
    ...gif,
  }));

  fs.writeFileSync(dataFile, JSON.stringify(gifsWithIds, null, 2));
  console.log(`Successfully updated ${dataFile} with ${gifsWithIds.length} GIFs.`);
} catch (error) {
  console.error('Error updating GIFs:', error);
}
