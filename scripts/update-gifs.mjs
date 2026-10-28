import fs from 'fs';
import path from 'path';

const gifsDirectory = path.join(process.cwd(), 'public/gifs');
const dataFile = path.join(process.cwd(), 'data/gifs.json');
const publicCatalogFile = path.join(process.cwd(), 'public/catalog.json');
// Optional credits for clips that came from elsewhere (Giphy, Internet Archive, Memelord, Reddit), keyed by file path.
const sourcesFile = path.join(process.cwd(), 'data/sources.json');
const sources = fs.existsSync(sourcesFile) ? JSON.parse(fs.readFileSync(sourcesFile, 'utf8')) : {};

const SITE_ORIGIN = 'https://gifbox.netlify.app';

const EXTENSIONS = {
  '.gif': 'gif',
  '.mp4': 'video',
  '.webm': 'video',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
};

function toSlug(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getGifs(dir, basePath = '') {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const gifs = dirents.flatMap((dirent) => {
    const res = path.resolve(dir, dirent.name);
    const relativePath = path.join(basePath, dirent.name).split(path.sep).join('/');
    const type = EXTENSIONS[path.extname(dirent.name).toLowerCase()];
    if (dirent.isDirectory()) {
      return getGifs(res, relativePath);
    } else if (dirent.isFile() && type) {
      const folder = basePath ? basePath.split(path.sep)[0] : 'uncategorized';
      const category = basePath ? formatCategory(folder) : 'Uncategorized';
      const src = sources[relativePath] || {};
      const baseName = path.basename(dirent.name, path.extname(dirent.name));
      const cleanBaseSlug = toSlug(baseName);
      // Permanent slug ID: clean basename for memes/top-level or folder-prefixed if generic
      const slug = src.slug || cleanBaseSlug || toSlug(`${folder}-${baseName}`);
      return {
        slug,
        title: src.title || formatTitle(dirent.name),
        category,
        file: relativePath,
        type,
        url: `${SITE_ORIGIN}/gifs/${relativePath}`,
        ...(src.tags ? { tags: src.tags } : {}),
        ...(src.source ? { source: src.source } : {}),
        ...(src.url ? { sourceUrl: src.url } : {}),
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

  // Deduplicate slugs if any collision occurs across folders
  const seenSlugs = new Set();
  const gifsWithIds = allGifs.map((gif, index) => {
    let uniqueSlug = gif.slug;
    if (seenSlugs.has(uniqueSlug)) {
      const folderPrefix = toSlug(gif.category);
      uniqueSlug = `${folderPrefix}-${uniqueSlug}`;
    }
    seenSlugs.add(uniqueSlug);
    return {
      id: index + 1,
      ...gif,
      slug: uniqueSlug,
    };
  });

  fs.writeFileSync(dataFile, JSON.stringify(gifsWithIds, null, 2));
  fs.writeFileSync(
    publicCatalogFile,
    JSON.stringify(
      {
        schema: 'gifbox-catalog-v1',
        site: SITE_ORIGIN,
        updatedAt: new Date().toISOString(),
        total: gifsWithIds.length,
        items: gifsWithIds,
      },
      null,
      2
    )
  );
  console.log(`Successfully updated ${dataFile} and ${publicCatalogFile} with ${gifsWithIds.length} items.`);
} catch (error) {
  console.error('Error updating GIFs:', error);
}
