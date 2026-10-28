import fs from 'fs';
import path from 'path';

const gifsDirectory = path.join(process.cwd(), 'public/gifs');
const dataFile = path.join(process.cwd(), 'data/gifs.json');
const seedFile = path.join(process.cwd(), 'data/gifs-seed.json');
const publicCatalogFile = path.join(process.cwd(), 'public/catalog.json');
const memelordFullFile = path.join(process.cwd(), 'data/memelord_full.json');
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
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
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
      const slug = src.slug || cleanBaseSlug || toSlug(`${folder}-${baseName}`);
      return {
        slug,
        title: src.title || formatTitle(dirent.name),
        category,
        file: relativePath,
        type,
        url: `${SITE_ORIGIN}/gifs/${relativePath}`,
        ...(src.tags ? { tags: src.tags.slice(0, 12) } : {}),
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
  console.log('Scanning local GIFs...');
  const localGifs = getGifs(gifsDirectory);

  const PINNED_ORDER = [
    'memes/chad-dario.png',
    'memes/donald-trump-looking-at-nicki-minaj.webp',
    'memes/wojak-group-hug.webp',
    'memes/chad-xi-template.jpg',
  ];
  localGifs.sort((a, b) => {
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

  // Track existing titles/slugs from local memes so we don't duplicate the 51 already downloaded
  const existingLocalMemeSlugs = new Set(
    localGifs.filter((g) => g.file.startsWith('memes/')).map((g) => g.slug)
  );

  // Load all 9,191 Memelord items if present
  const memelordItems = [];
  if (fs.existsSync(memelordFullFile)) {
    const rawMemelord = JSON.parse(fs.readFileSync(memelordFullFile, 'utf8'));
    const seenMemelordUrls = new Set();
    for (const m of rawMemelord) {
      const mainUrl = m.url || m.preview_url;
      if (!mainUrl || seenMemelordUrls.has(mainUrl)) continue;
      seenMemelordUrls.add(mainUrl);

      const title = (m.name || 'Memelord Asset').trim();
      const baseSlug = toSlug(title) || `memelord-${(m.id || '').slice(0, 8)}`;
      if (existingLocalMemeSlugs.has(baseSlug)) continue;

      const isVideo = m.type === 'video' || mainUrl.toLowerCase().endsWith('.mp4');
      const isSticker = m.type === 'sticker';
      const category = isVideo ? 'Video Memes' : isSticker ? 'Stickers' : 'Memes';
      const itemType = isVideo ? 'video' : 'image';

      const cleanTags = Array.from(
        new Set(
          (m.tags || [])
            .map((t) => String(t).trim().toLowerCase())
            .filter((t) => t.length > 1 && t.length < 36)
        )
      ).slice(0, 10);

      memelordItems.push({
        slug: baseSlug,
        title,
        category,
        file: '',
        type: itemType,
        url: mainUrl,
        ...(m.preview_url && m.preview_url !== mainUrl ? { previewUrl: m.preview_url } : {}),
        ...(cleanTags.length > 0 ? { tags: cleanTags } : {}),
        source: 'Memelord',
        sourceUrl: 'https://www.memelord.com/dashboard',
      });
    }
    console.log(`Loaded ${memelordItems.length} additional Memelord assets.`);
  }

  // Place pinned/local memes first, then all 9,100+ Memelord assets, then the rest of local GIFs
  const localMemes = localGifs.filter((g) => g.file.startsWith('memes/'));
  const otherLocalGifs = localGifs.filter((g) => !g.file.startsWith('memes/'));
  const combined = [...localMemes, ...memelordItems, ...otherLocalGifs];

  // Ensure globally unique slugs
  const seenSlugs = new Map();
  const gifsWithIds = combined.map((gif, index) => {
    let base = gif.slug || `item-${index + 1}`;
    const count = seenSlugs.get(base) || 0;
    seenSlugs.set(base, count + 1);
    const uniqueSlug = count === 0 ? base : `${base}-${count + 1}`;
    return {
      id: index + 1,
      ...gif,
      slug: uniqueSlug,
    };
  });

  // Build seed with first 120 items + at least 5 items per category so all category pills render at t=0ms
  const seedItems = [];
  const seedIds = new Set();
  for (const item of gifsWithIds.slice(0, 120)) {
    seedItems.push(item);
    seedIds.add(item.id);
  }
  const byCatCount = new Map();
  for (const item of gifsWithIds) {
    const c = byCatCount.get(item.category) || 0;
    if (c < 6 && !seedIds.has(item.id)) {
      seedItems.push(item);
      seedIds.add(item.id);
      byCatCount.set(item.category, c + 1);
    }
  }

  fs.writeFileSync(dataFile, JSON.stringify(gifsWithIds));
  fs.writeFileSync(seedFile, JSON.stringify(seedItems, null, 2));
  fs.writeFileSync(
    publicCatalogFile,
    JSON.stringify({
      schema: 'gifbox-catalog-v1',
      site: SITE_ORIGIN,
      updatedAt: new Date().toISOString(),
      total: gifsWithIds.length,
      items: gifsWithIds,
    })
  );
  console.log(
    `Successfully updated ${dataFile}, ${seedFile}, and ${publicCatalogFile} with ${gifsWithIds.length} total items.`
  );
} catch (error) {
  console.error('Error updating GIFs:', error);
}
