
import fs from 'fs';
import path from 'path';

const gifsDirectory = path.join(process.cwd(), 'public/gifs');
const dataFile = path.join(process.cwd(), 'data/gifs.json');

function getGifs(dir, basePath = '') {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  const gifs = dirents.flatMap((dirent) => {
    const res = path.resolve(dir, dirent.name);
    const relativePath = path.join(basePath, dirent.name);
    if (dirent.isDirectory()) {
      return getGifs(res, relativePath);
    } else if (dirent.isFile() && path.extname(dirent.name).toLowerCase() === '.gif') {
      const category = basePath ? formatCategory(basePath) : 'Uncategorized';
      return {
        title: formatTitle(dirent.name),
        category: category,
        file: relativePath,
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

  const gifsWithIds = allGifs.map((gif, index) => ({
    id: index + 1,
    ...gif,
  }));

  fs.writeFileSync(dataFile, JSON.stringify(gifsWithIds, null, 2));
  console.log(`Successfully updated ${dataFile} with ${gifsWithIds.length} GIFs.`);
} catch (error) {
  console.error('Error updating GIFs:', error);
}
